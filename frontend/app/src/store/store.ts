// The browser-side external store.
//
// Two tiers, deliberately:
//
//   * **Meta** — systems, sessions, health, events, command feed, selection.
//     Changes rarely; every change notifies React immediately.
//   * **Frames** — world snapshots and debug items. Arrive at simulation rate.
//     Stored in plain mutable maps that React never subscribes to directly.
//     Consumers either read them inside a rAF loop (the canvas renderer) or
//     subscribe through a rate-limited notifier (panels showing live numbers).
//
// This is what keeps React off the simulation frame clock, which is a Phase 3.5
// gate condition.

import { InterfaceClient, clearReloadMark, type ConnectionState } from '../protocol/client'
import { randomUuid } from '../protocol/codec'
import type {
  Bootstrap,
  BrowserCommand,
  CommandAcknowledgement,
  CommandAction,
  CommandOrigin,
  CursorId,
  DebugItem,
  DebugLayer,
  DurableEvent,
  MatchEvent,
  ServerMessage,
  SessionDescriptor,
  RecordingSummary,
  SessionId,
  StateEnvelope,
  SystemDescriptor,
  SystemHealth,
  SystemId,
  TeamColor,
  ViewerCursor,
  WorldState,
} from '../protocol/types'

const EVENT_CAPACITY = 1000
const FEED_CAPACITY = 500

export interface EntitySelection {
  kind: 'robot' | 'ball'
  worldId: number
  team?: TeamColor
  robotId?: number
}

export interface FeedEntry {
  commandId: string
  at: number
  panelId: string
  summary: string
  detail: string
  origin: CommandOrigin
  status: 'pending' | 'accepted' | 'applied' | 'rejected' | 'failed'
  message: string
  rttMs: number | null
  /**
   * The entity this command acted on, when the action names one. Lets the feed
   * take part in the shared selection instead of being a dead log.
   */
  target: EntitySelection | null
}

/** The entity a command acts on, for feed-to-field selection. */
export function selectionOfAction(action: CommandAction): EntitySelection | null {
  if (action.type !== 'system') return null
  const command = action.data.command
  if (command.type !== 'simhark') return null
  const inner = command.data
  switch (inner.type) {
    case 'move_robot':
    case 'rotate_robot':
    case 'set_robot_present':
      return {
        kind: 'robot',
        worldId: inner.data.world_id,
        team: inner.data.team,
        robotId: inner.data.id,
      }
    case 'move_ball':
      return { kind: 'ball', worldId: inner.data.world_id }
    default:
      return null
  }
}

export interface TimelineEntry {
  id: string
  at_ns: number
  kind: string
  label: string
  worldId: number | null
  severity: 'info' | 'warn' | 'error'
}

export interface Alert {
  id: string
  level: 'warn' | 'error'
  title: string
  body: string
  at: number
}

export interface GenerationEntry {
  generation: number
  at: number
}

export interface MetaState {
  connection: ConnectionState
  bootstrap: Bootstrap | null
  systems: SystemDescriptor[]
  health: Record<SystemId, SystemHealth>
  sessions: SessionDescriptor[]
  activeSessionId: SessionId | null
  cursor: ViewerCursor | null
  worldIds: number[]
  debugLayers: DebugLayer[]
  events: TimelineEntry[]
  feed: FeedEntry[]
  alerts: Alert[]
  lastCommandOrigin: CommandOrigin | null
  selection: EntitySelection | null
  capabilities: string[]
  /**
   * Sessions the host has acknowledged as recording. Derived from accepted
   * commands — including the echoes of other browsers' commands — because the
   * protocol carries no recording flag on `SessionDescriptor`.
   */
  recordingSessions: SessionId[]
  /** Bumped whenever a system republishes different snapshot properties. */
  propertiesVersion: number
  /** Reload history per system, for the generation diagnostics. */
  generations: Record<SystemId, GenerationEntry[]>
  /** The host's recording library, refreshed on demand and after an import. */
  recordings: RecordingSummary[]
}

const EMPTY_META: MetaState = {
  connection: {
    phase: 'idle',
    blockedReason: null,
    lastError: null,
    attempt: 0,
    serverBuildFingerprint: null,
    assetBuildFingerprint: null,
    connectedBrowsers: 0,
    latencyMs: null,
    since: 0,
  },
  bootstrap: null,
  systems: [],
  health: {},
  sessions: [],
  activeSessionId: null,
  cursor: null,
  worldIds: [],
  debugLayers: [],
  events: [],
  feed: [],
  alerts: [],
  lastCommandOrigin: null,
  selection: null,
  capabilities: [],
  recordingSessions: [],
  propertiesVersion: 0,
  generations: {},
  recordings: [],
}

/**
 * Coalescing notifier: fires at most `intervalMs`, with a trailing call so the
 * last value is never dropped. `version` only advances when subscribers are
 * actually told, which is what makes it safe as a `useSyncExternalStore`
 * snapshot.
 */
class RateLimited {
  private listeners = new Set<() => void>()
  private timer: number | null = null
  private lastFiredAt = 0
  private dirty = false
  version = 0

  constructor(private readonly intervalMs: number) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getVersion = (): number => this.version

  mark(): void {
    this.dirty = true
    const now = performance.now()
    const elapsed = now - this.lastFiredAt
    if (elapsed >= this.intervalMs) {
      this.fire()
      return
    }
    if (this.timer === null) {
      this.timer = window.setTimeout(() => {
        this.timer = null
        if (this.dirty) this.fire()
      }, this.intervalMs - elapsed)
    }
  }

  private fire(): void {
    this.dirty = false
    this.lastFiredAt = performance.now()
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

export interface WorldFrame {
  world: WorldState
  systemId: SystemId
  receivedAt: number
}

export class InterfaceStore {
  readonly client = new InterfaceClient()

  private meta: MetaState = EMPTY_META
  private metaListeners = new Set<() => void>()

  /** Fast tier. Mutated in place; never referenced from React state. */
  private worlds = new Map<number, WorldFrame>()
  private debugItemsByWorld = new Map<number, DebugItem[]>()
  private snapshots = new Map<SystemId, StateEnvelope>()

  /** Seek results, keyed by viewer cursor. Kept apart from the live world. */
  private historyWorlds = new Map<CursorId, Map<number, WorldFrame>>()
  private historyDebugItems = new Map<CursorId, DebugItem[]>()

  /** Raw per-envelope callbacks, for the renderer's own rAF pacing. */
  private frameListeners = new Set<() => void>()
  frameVersion = 0

  /** ~10 Hz React channel for panels that show live numbers. */
  readonly liveTick = new RateLimited(100)

  private clientSequence = 0
  private commandPanel = new Map<
    string,
    { panelId: string; sentAt: number; action: CommandAction }
  >()

  /** Recent scalar debug values, keyed by item id, for the time-series display. */
  private debugSeries = new Map<string, Array<[number, number]>>()
  private propertiesSignature = ''

  workstationLabel: string | null = null

  // ── lifecycle ──────────────────────────────────────────────────────────

  connect(): void {
    this.client.on('connection', (connection) => {
      if (connection.phase === 'open') clearReloadMark()
      this.patchMeta({ connection })
    })
    this.client.on('bootstrap', (bootstrap) => this.applyBootstrap(bootstrap))
    this.client.on('message', (message) => this.applyMessage(message))
    void this.client.start()
  }

  disconnect(): void {
    this.client.stop()
  }

  // ── meta tier ──────────────────────────────────────────────────────────

  subscribeMeta = (listener: () => void): (() => void) => {
    this.metaListeners.add(listener)
    return () => {
      this.metaListeners.delete(listener)
    }
  }

  getMeta = (): MetaState => this.meta

  private patchMeta(patch: Partial<MetaState>): void {
    this.meta = { ...this.meta, ...patch }
    for (const listener of this.metaListeners) listener()
  }

  // ── frame tier ─────────────────────────────────────────────────────────

  subscribeFrames = (listener: () => void): (() => void) => {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  getWorld(worldId: number): WorldFrame | undefined {
    return this.worlds.get(worldId)
  }

  getWorlds(): WorldFrame[] {
    return [...this.worlds.values()].sort((a, b) => a.world.world_id - b.world.world_id)
  }

  getDebugItems(worldId: number): DebugItem[] {
    return this.debugItemsByWorld.get(worldId) ?? []
  }

  /** Seeked state for a cursor, or `undefined` if the host has not answered. */
  getHistoryWorld(cursorId: CursorId, worldId: number): WorldFrame | undefined {
    return this.historyWorlds.get(cursorId)?.get(worldId)
  }

  getHistoryWorlds(cursorId: CursorId): WorldFrame[] {
    return [...(this.historyWorlds.get(cursorId)?.values() ?? [])].sort(
      (a, b) => a.world.world_id - b.world.world_id,
    )
  }

  getHistoryDebugItems(cursorId: CursorId, worldId: number): DebugItem[] {
    return (this.historyDebugItems.get(cursorId) ?? []).filter(
      (item) => item.world_id === null || item.world_id === worldId,
    )
  }

  getSnapshotProperties(): Record<string, unknown> {
    const merged: Record<string, unknown> = {}
    for (const envelope of this.snapshots.values()) {
      Object.assign(merged, envelope.snapshot.properties)
    }
    return merged
  }

  getDebugSeries(itemId: string): Array<[number, number]> {
    return this.debugSeries.get(itemId) ?? []
  }

  /** Simulation time of the newest world, used to stamp and place events. */
  nowSimNs(): number {
    let newest = 0
    for (const frame of this.worlds.values()) {
      if (frame.world.simulation_time_ns > newest) newest = frame.world.simulation_time_ns
    }
    return newest
  }

  // ── inbound ────────────────────────────────────────────────────────────

  private applyBootstrap(bootstrap: Bootstrap): void {
    this.patchMeta({
      bootstrap,
      systems: bootstrap.systems,
      sessions: bootstrap.sessions,
      capabilities: bootstrap.capabilities,
      lastCommandOrigin: bootstrap.last_accepted_command_origin,
      ...rebindSession(bootstrap.sessions, this.meta.activeSessionId, this.meta.cursor),
    })
  }

  private applyMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'initial_state': {
        this.worlds.clear()
        this.debugItemsByWorld.clear()
        this.snapshots.clear()
        for (const envelope of message.data.snapshots) this.ingestState(envelope)
        this.patchMeta({
          systems: message.data.systems,
          sessions: message.data.sessions,
          ...rebindSession(message.data.sessions, this.meta.activeSessionId, this.meta.cursor),
          worldIds: this.currentWorldIds(),
          debugLayers: this.currentDebugLayers(),
          // The snapshots were just replaced wholesale, so what the panels are
          // showing is no longer what the host published.
          ...(this.propertiesChanged()
            ? { propertiesVersion: this.meta.propertiesVersion + 1 }
            : {}),
        })
        this.notifyFrame()
        break
      }

      case 'state': {
        const worldsBefore = this.worlds.size
        const layersBefore = this.meta.debugLayers.length
        this.ingestState(message.data)
        this.notifyFrame()
        // Only touch React when the *shape* changed, not on every frame.
        const layers = this.currentDebugLayers()
        const patch: Partial<MetaState> = {}
        if (this.worlds.size !== worldsBefore || layers.length !== layersBefore) {
          patch.worldIds = this.currentWorldIds()
          patch.debugLayers = layers
        }
        if (this.propertiesChanged()) {
          patch.propertiesVersion = this.meta.propertiesVersion + 1
        }
        if (Object.keys(patch).length > 0) this.patchMeta(patch)
        break
      }

      case 'system': {
        const systems = this.meta.systems.filter((s) => s.id !== message.data.id)
        systems.push(message.data)
        systems.sort((a, b) => a.id.localeCompare(b.id))
        this.patchMeta({
          systems,
          generations: this.recordGeneration(message.data),
        })
        break
      }

      case 'system_health':
        this.patchMeta({
          health: { ...this.meta.health, [message.data.system_id]: message.data.health },
          alerts: this.foldHealthAlert(message.data.system_id, message.data.health),
        })
        break

      case 'session': {
        const sessions = this.meta.sessions.filter((s) => s.id !== message.data.id)
        sessions.push(message.data)
        sessions.sort((a, b) => a.created_at_ns - b.created_at_ns)
        this.patchMeta({
          sessions,
          activeSessionId: this.meta.activeSessionId ?? message.data.id,
        })
        break
      }

      case 'command_acknowledgement':
        this.applyAcknowledgement(message.data)
        break

      case 'event':
        this.applyEvent(message.data.event, message.data.session_id)
        break

      case 'recordings':
        this.patchMeta({ recordings: message.data.recordings })
        break

      case 'pong':
        this.client.notePong(message.data.nonce)
        break
    }
  }

  private ingestState(envelope: StateEnvelope): void {
    const receivedAt = performance.now()

    // A cursor-scoped envelope answers one panel's seek. It must not touch the
    // live world, the live debug items or the merged properties, or scrubbing
    // would drag every other panel back in time with it.
    if (envelope.cursor_id) {
      let byWorld = this.historyWorlds.get(envelope.cursor_id)
      if (!byWorld) {
        byWorld = new Map()
        this.historyWorlds.set(envelope.cursor_id, byWorld)
      }
      for (const world of envelope.snapshot.worlds) {
        byWorld.set(world.world_id, { world, systemId: envelope.system_id, receivedAt })
      }
      this.historyDebugItems.set(envelope.cursor_id, envelope.snapshot.debug_items)
      return
    }

    this.snapshots.set(envelope.system_id, envelope)

    for (const world of envelope.snapshot.worlds) {
      this.worlds.set(world.world_id, {
        world,
        systemId: envelope.system_id,
        receivedAt,
      })
    }

    const grouped = new Map<number, DebugItem[]>()
    for (const item of envelope.snapshot.debug_items) {
      // A debug item without a world belongs to every world in the snapshot.
      const targets =
        item.world_id !== null
          ? [item.world_id]
          : envelope.snapshot.worlds.map((world) => world.world_id)
      for (const worldId of targets) {
        const bucket = grouped.get(worldId)
        if (bucket) bucket.push(item)
        else grouped.set(worldId, [item])
      }
    }
    for (const [worldId, items] of grouped) this.debugItemsByWorld.set(worldId, items)
    for (const world of envelope.snapshot.worlds) {
      if (!grouped.has(world.world_id)) this.debugItemsByWorld.set(world.world_id, [])
    }

    const at = this.nowSimNs()
    for (const item of envelope.snapshot.debug_items) {
      if (item.scalar === null) continue
      let series = this.debugSeries.get(item.id)
      if (!series) {
        series = []
        this.debugSeries.set(item.id, series)
      }
      series.push([at, item.scalar])
      if (series.length > 300) series.splice(0, series.length - 300)
    }
  }

  /**
   * Cheap identity of the merged properties. Comparing this rather than the
   * values keeps property-driven panels off the frame clock while still letting
   * them notice a genuine change.
   */
  private propertiesChanged(): boolean {
    let signature = ''
    for (const envelope of this.snapshots.values()) {
      for (const [key, value] of Object.entries(envelope.snapshot.properties)) {
        signature += `${key}=${JSON.stringify(value)};`
      }
    }
    if (signature === this.propertiesSignature) return false
    this.propertiesSignature = signature
    return true
  }

  private notifyFrame(): void {
    this.frameVersion += 1
    for (const listener of this.frameListeners) listener()
    this.liveTick.mark()
  }

  private currentWorldIds(): number[] {
    return [...this.worlds.keys()].sort((a, b) => a - b)
  }

  private currentDebugLayers(): DebugLayer[] {
    const byId = new Map<string, DebugLayer>()
    for (const envelope of this.snapshots.values()) {
      for (const layer of envelope.snapshot.debug_layers) byId.set(layer.id, layer)
    }
    return [...byId.values()]
  }

  private recordGeneration(system: SystemDescriptor): Record<SystemId, GenerationEntry[]> {
    return appendGeneration(this.meta.generations, system, Date.now())
  }

  private foldRecording(action: CommandAction): SessionId[] | null {
    return foldRecordingSessions(this.meta.recordingSessions, action)
  }

  private applyAcknowledgement(ack: CommandAcknowledgement): void {
    const sent = this.commandPanel.get(ack.command_id)
    const rttMs = sent ? Math.round(performance.now() - sent.sentAt) : null
    const feed = this.meta.feed.map((entry) =>
      entry.commandId === ack.command_id
        ? { ...entry, status: ack.status, message: ack.message, rttMs }
        : entry,
    )
    const alerts =
      ack.status === 'rejected' || ack.status === 'failed'
        ? capAlerts([
            ...this.meta.alerts,
            {
              id: ack.command_id,
              level: 'error' as const,
              title: `Command ${ack.status}`,
              body: ack.message || 'no message',
              at: Date.now(),
            },
          ])
        : this.meta.alerts

    const patch: Partial<MetaState> = { feed, alerts }
    if (sent && (ack.status === 'accepted' || ack.status === 'applied')) {
      const recording = this.foldRecording(sent.action)
      if (recording) patch.recordingSessions = recording
      if (sent.action.type === 'export') {
        // The host reports the written path in its acknowledgement message;
        // surfacing it is the only way the operator learns where it landed.
        patch.alerts = capAlerts([
          ...alerts,
          {
            id: ack.command_id,
            level: 'warn',
            title: 'Export written',
            body: ack.message || 'the host reported no destination',
            at: Date.now(),
          },
        ])
      }
    }
    this.patchMeta(patch)
  }

  private applyEvent(event: DurableEvent, sessionId: SessionId): void {
    switch (event.type) {
      case 'match':
        this.pushTimeline(matchEntry(event.data))
        break

      case 'lifecycle': {
        this.pushTimeline({
          id: randomUuid(),
          at_ns: this.nowSimNs(),
          kind: `lifecycle:${event.data.lifecycle}`,
          label: event.data.message ?? `Session ${event.data.lifecycle}`,
          worldId: null,
          severity:
            event.data.lifecycle === 'failed'
              ? 'error'
              : event.data.lifecycle === 'cancelled'
                ? 'warn'
                : 'info',
        })
        const sessions = this.meta.sessions.map((session) =>
          session.id === sessionId ? { ...session, lifecycle: event.data.lifecycle } : session,
        )
        this.patchMeta({ sessions })
        break
      }

      case 'command': {
        // Echo of an accepted command — records the authoritative origin, which
        // is how a second browser learns what this one did.
        const patch: Partial<MetaState> = { lastCommandOrigin: event.data.origin }
        const recording = this.foldRecording(event.data.action)
        if (recording) patch.recordingSessions = recording
        this.patchMeta(patch)
        if (!this.commandPanel.has(event.data.id)) {
          this.pushFeed(foreignFeedEntry(event.data))
        }
        break
      }

      case 'command_acknowledgement':
        this.applyAcknowledgement(event.data)
        break

      case 'data_loss':
        this.pushTimeline({
          id: randomUuid(),
          at_ns: this.nowSimNs(),
          kind: 'data_loss',
          label: `Data loss · ${event.data.producer} dropped ${event.data.dropped}`,
          worldId: null,
          severity: 'error',
        })
        this.pushAlert({
          id: randomUuid(),
          level: 'error',
          title: 'Data loss',
          body: `${event.data.producer} dropped ${event.data.dropped} message(s)`,
          at: Date.now(),
        })
        break

      case 'recording_error':
        this.pushAlert({
          id: randomUuid(),
          level: 'warn',
          title: 'Recording error',
          body: event.data.message,
          at: Date.now(),
        })
        break

      case 'bookmark':
        this.pushTimeline({
          id: randomUuid(),
          at_ns: this.nowSimNs(),
          kind: 'bookmark',
          label: `Bookmark · ${event.data.label}`,
          worldId: null,
          severity: 'info',
        })
        break

      case 'annotation':
        this.pushTimeline({
          id: randomUuid(),
          at_ns: this.nowSimNs(),
          kind: 'annotation',
          label: `Annotation · ${event.data.text}`,
          worldId: null,
          severity: 'info',
        })
        break

      case 'custom':
        this.pushTimeline({
          id: randomUuid(),
          at_ns: this.nowSimNs(),
          kind: event.data.kind,
          label: event.data.kind,
          worldId: null,
          severity: 'info',
        })
        break
    }
  }

  private pushTimeline(entry: TimelineEntry): void {
    const events = [...this.meta.events, entry]
    if (events.length > EVENT_CAPACITY) events.splice(0, events.length - EVENT_CAPACITY)
    this.patchMeta({ events })
  }

  private pushFeed(entry: FeedEntry): void {
    const feed = [entry, ...this.meta.feed]
    if (feed.length > FEED_CAPACITY) feed.length = FEED_CAPACITY
    this.patchMeta({ feed })
  }

  private pushAlert(alert: Alert): void {
    this.patchMeta({ alerts: capAlerts([...this.meta.alerts, alert]) })
  }

  private foldHealthAlert(systemId: SystemId, health: SystemHealth): Alert[] {
    const others = this.meta.alerts.filter((alert) => alert.id !== `health:${systemId}`)
    if (health.level === 'healthy') return others
    return capAlerts([
      ...others,
      {
        id: `health:${systemId}`,
        level: health.level === 'degraded' ? 'warn' : 'error',
        title: `${systemId} ${health.level}`,
        body: health.message,
        at: Date.now(),
      },
    ])
  }

  dismissAlert(id: string): void {
    this.patchMeta({ alerts: this.meta.alerts.filter((alert) => alert.id !== id) })
  }

  // ── outbound ───────────────────────────────────────────────────────────

  /**
   * Every command carries its origin: browser instance, originating panel,
   * session and cursor context, and a monotonic client sequence. This is
   * operational observability — the host does not treat it as ownership.
   */
  send(panelId: string, action: CommandAction, summary?: string): string | null {
    this.clientSequence += 1
    const origin: CommandOrigin = {
      browser_instance_id: this.client.browserInstanceId,
      panel_id: panelId,
      session_id: this.meta.activeSessionId,
      viewer_cursor_id: this.meta.cursor?.id ?? null,
      client_sequence: this.clientSequence,
      workstation_label: this.workstationLabel,
    }
    const command: BrowserCommand = { id: randomUuid(), origin, action }

    const entry: FeedEntry = {
      commandId: command.id,
      at: Date.now(),
      panelId,
      summary: summary ?? describeAction(action),
      detail: JSON.stringify(action.type === 'system' ? action.data.command : action),
      origin,
      status: 'pending',
      message: '',
      rttMs: null,
      target: selectionOfAction(action),
    }

    if (!this.client.sendCommand(command)) {
      this.pushFeed({ ...entry, status: 'failed', message: 'not connected' })
      return null
    }
    this.commandPanel.set(command.id, { panelId, sentAt: performance.now(), action })
    this.pushFeed(entry)
    return command.id
  }

  setActiveSession(sessionId: SessionId | null): void {
    this.patchMeta({ activeSessionId: sessionId })
  }

  setSelection(selection: EntitySelection | null): void {
    this.patchMeta({ selection })
  }

  setCursor(cursor: ViewerCursor | null): void {
    this.patchMeta({ cursor })
  }

  /** Detach the viewer from the live head, or return it. */
  setLive(panelId: string, live: boolean, frame?: number): void {
    const sessionId = this.meta.activeSessionId
    if (!sessionId) return
    const cursor: ViewerCursor = {
      id: this.meta.cursor?.id ?? randomUuid(),
      session_id: sessionId,
      live,
      frame: live ? null : (frame ?? this.meta.cursor?.frame ?? 0),
      world_ids: this.meta.cursor?.world_ids ?? [],
    }
    this.setCursor(cursor)
    this.send(panelId, { type: 'set_viewer_cursor', data: cursor }, live ? 'Return to live' : 'Detach viewer')
  }
}

/**
 * Recording state is inferred from accepted commands rather than read from the
 * session, because `SessionDescriptor` carries no recording flag. Returns
 * `null` when nothing changed, so callers can skip a pointless notification.
 */
export function foldRecordingSessions(
  current: SessionId[],
  action: CommandAction,
): SessionId[] | null {
  if (action.type === 'start_recording') {
    const sessionId = action.data.session_id
    return current.includes(sessionId) ? null : [...current, sessionId]
  }
  if (action.type === 'stop_recording') {
    const sessionId = action.data.session_id
    return current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : null
  }
  return null
}

/**
 * Re-points the active session and the viewer cursor at a freshly published
 * session list.
 *
 * A host restart hands out new session ids, so the ones a long-lived tab is
 * holding name sessions that no longer exist. Left alone they resolve to no
 * active session at all, which `canMutate` reads as "not mutable" — so every
 * command in the interface stays disabled until the operator reloads the page.
 */
export function rebindSession(
  sessions: SessionDescriptor[],
  activeSessionId: SessionId | null,
  cursor: ViewerCursor | null,
): Pick<MetaState, 'activeSessionId' | 'cursor'> {
  const known = (id: SessionId | null | undefined): boolean =>
    id != null && sessions.some((session) => session.id === id)
  return {
    activeSessionId: known(activeSessionId)
      ? activeSessionId
      : (preferredSession(sessions)?.id ?? null),
    // A cursor is scoped to one session. When that session is gone, a detached
    // one would hold the interface in review over nothing.
    cursor: known(cursor?.session_id) ? cursor : null,
  }
}

/** Appends to a system's reload history when its generation advances. */
export function appendGeneration(
  history: Record<SystemId, GenerationEntry[]>,
  system: SystemDescriptor,
  at: number,
): Record<SystemId, GenerationEntry[]> {
  const existing = history[system.id] ?? []
  if (existing[existing.length - 1]?.generation === system.generation) return history
  return {
    ...history,
    [system.id]: [...existing, { generation: system.generation, at }].slice(-20),
  }
}

function capAlerts(alerts: Alert[]): Alert[] {
  return alerts.length > 20 ? alerts.slice(alerts.length - 20) : alerts
}

function matchEntry(event: MatchEvent): TimelineEntry {
  const kind = event.kind.toLowerCase()
  return {
    id: event.id,
    at_ns: event.at_ns,
    kind,
    label: event.message || event.kind,
    worldId: event.world_id,
    severity: kind.includes('foul') || kind.includes('card') ? 'warn' : 'info',
  }
}

function foreignFeedEntry(command: BrowserCommand): FeedEntry {
  return {
    commandId: command.id,
    at: Date.now(),
    panelId: command.origin.panel_id,
    summary: describeAction(command.action),
    detail: JSON.stringify(command.action),
    origin: command.origin,
    status: 'accepted',
    message: 'from another client',
    rttMs: null,
    target: selectionOfAction(command.action),
  }
}

export function describeAction(action: CommandAction): string {
  switch (action.type) {
    case 'system': {
      const command = action.data.command
      const inner = command.data as { type?: string } | undefined
      return `${action.data.system_id} · ${command.type}${inner?.type ? ` · ${inner.type}` : ''}`
    }
    case 'create_session':
      return `create ${action.data.kind} · ${action.data.label}`
    case 'set_session_lifecycle':
      return `session → ${action.data.lifecycle}`
    case 'set_viewer_cursor':
      return action.data.live ? 'cursor → live' : `cursor → frame ${action.data.frame}`
    case 'add_bookmark':
      return `bookmark @${action.data.frame}`
    case 'add_annotation':
      return `annotation @${action.data.frame}`
    case 'refresh_recordings':
      return 'refresh recordings'
    case 'open_recording':
      return `open recording ${action.data.recording_id}`
    case 'start_recording':
      return 'start recording'
    case 'stop_recording':
      return 'stop recording'
    case 'export':
      return `export ${action.data.format}`
  }
}

function preferredSession(sessions: SessionDescriptor[]): SessionDescriptor | undefined {
  return (
    sessions.find((session) => session.lifecycle === 'running') ??
    sessions.find((session) => session.lifecycle !== 'empty') ??
    sessions[0]
  )
}
