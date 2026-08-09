// Same-origin transport client: bootstrap, stable JSON handshake, then
// named-MessagePack traffic, with reconnect and stale-bundle reload handling.

import { decodeServerMessage, encodeClientMessage, randomUuid } from './codec'
import {
  PROTOCOL_VERSION,
  type Bootstrap,
  type BrowserCommand,
  type ClientHello,
  type ServerControl,
  type ServerMessage,
  type Uuid,
} from './types'

export type ConnectionPhase =
  | 'idle'
  | 'bootstrapping'
  | 'connecting'
  | 'handshaking'
  | 'open'
  | 'reconnecting'
  | 'blocked'

export interface ConnectionState {
  phase: ConnectionPhase
  /** Non-null only in `blocked`: a mismatch we refuse to reload for again. */
  blockedReason: string | null
  lastError: string | null
  attempt: number
  serverBuildFingerprint: string | null
  assetBuildFingerprint: string | null
  connectedBrowsers: number
  /** Round-trip of the most recent keepalive ping, in milliseconds. */
  latencyMs: number | null
  since: number
}

export interface ClientEvents {
  bootstrap: (bootstrap: Bootstrap) => void
  message: (message: ServerMessage) => void
  connection: (state: ConnectionState) => void
}

const RELOAD_MARK_KEY = 'interfaabs.reload-fingerprint'
const PING_INTERVAL_MS = 5_000
const MIN_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 10_000

function bootstrapUrl(): string {
  return new URL('api/v1/bootstrap', document.baseURI).toString()
}

function socketUrl(): string {
  const url = new URL('api/v1/ws', document.baseURI)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export class InterfaceClient {
  /**
   * Identifies this browser tab for command-origin auditing. Regenerated on
   * reload, which is what the plan asks for: it is observability, not identity.
   */
  readonly browserInstanceId: Uuid = randomUuid()

  private socket: WebSocket | null = null
  private handshakeDone = false
  private closedByUs = false
  private reconnectTimer: number | null = null
  private pingTimer: number | null = null
  private pingNonce = 0
  private pendingPing: { nonce: number; sentAt: number } | null = null
  private listeners: { [K in keyof ClientEvents]: Set<ClientEvents[K]> } = {
    bootstrap: new Set(),
    message: new Set(),
    connection: new Set(),
  }

  /**
   * The asset generation this page was served from. Captured once, at first
   * bootstrap, and deliberately never refreshed: if the host rebuilds its
   * assets underneath a running tab, resending the original fingerprint is
   * what makes the host recognise the tab as stale.
   */
  private bootAssetFingerprint: string | null = null

  private state: ConnectionState = {
    phase: 'idle',
    blockedReason: null,
    lastError: null,
    attempt: 0,
    serverBuildFingerprint: null,
    assetBuildFingerprint: null,
    connectedBrowsers: 0,
    latencyMs: null,
    since: Date.now(),
  }

  on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): () => void {
    this.listeners[event].add(listener)
    return () => {
      this.listeners[event].delete(listener)
    }
  }

  getConnectionState(): ConnectionState {
    return this.state
  }

  private emit<K extends keyof ClientEvents>(
    event: K,
    ...args: Parameters<ClientEvents[K]>
  ): void {
    for (const listener of this.listeners[event]) {
      ;(listener as (...a: unknown[]) => void)(...args)
    }
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch, since: Date.now() }
    this.emit('connection', this.state)
  }

  async start(): Promise<void> {
    this.closedByUs = false
    await this.connect()
  }

  stop(): void {
    this.closedByUs = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.setState({ phase: 'idle' })
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private async connect(): Promise<void> {
    if (this.state.phase === 'blocked') return

    this.setState({ phase: 'bootstrapping' })
    let bootstrap: Bootstrap
    try {
      const response = await fetch(bootstrapUrl(), { cache: 'no-store' })
      if (!response.ok) throw new Error(`bootstrap returned ${response.status}`)
      bootstrap = (await response.json()) as Bootstrap
    } catch (error) {
      this.scheduleReconnect(describe(error))
      return
    }

    if (this.bootAssetFingerprint === null) {
      this.bootAssetFingerprint = bootstrap.asset_build_fingerprint
    }
    this.setState({
      assetBuildFingerprint: this.bootAssetFingerprint,
      serverBuildFingerprint: bootstrap.server_build_fingerprint,
      connectedBrowsers: bootstrap.connected_browsers,
    })
    this.emit('bootstrap', bootstrap)

    this.openSocket()
  }

  private openSocket(): void {
    this.setState({ phase: 'connecting' })
    this.handshakeDone = false

    let socket: WebSocket
    try {
      socket = new WebSocket(socketUrl())
    } catch (error) {
      this.scheduleReconnect(describe(error))
      return
    }
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.onopen = () => {
      const hello: ClientHello = {
        protocol_version: PROTOCOL_VERSION,
        asset_build_fingerprint: this.bootAssetFingerprint ?? '',
        browser_instance_id: this.browserInstanceId,
      }
      socket.send(JSON.stringify(hello))
      this.setState({ phase: 'handshaking' })
    }

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleControl(event.data)
        return
      }
      try {
        this.emit('message', decodeServerMessage(event.data as ArrayBuffer))
      } catch (error) {
        this.setState({ lastError: `undecodable frame: ${describe(error)}` })
      }
    }

    socket.onerror = () => {
      this.setState({ lastError: 'websocket error' })
    }

    socket.onclose = () => {
      this.socket = null
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      if (this.closedByUs || this.state.phase === 'blocked') return
      this.scheduleReconnect(
        this.handshakeDone ? 'connection lost' : this.state.lastError ?? 'handshake failed',
      )
    }
  }

  private handleControl(text: string): void {
    let control: ServerControl
    try {
      control = JSON.parse(text) as ServerControl
    } catch (error) {
      this.setState({ lastError: `unparseable control frame: ${describe(error)}` })
      return
    }

    switch (control.type) {
      case 'hello_accepted':
        this.handshakeDone = true
        this.setState({
          phase: 'open',
          attempt: 0,
          lastError: null,
          serverBuildFingerprint: control.data.server_build_fingerprint,
          connectedBrowsers: control.data.connected_browsers,
        })
        this.startPinging()
        break

      case 'reload_required':
        this.handleReloadRequired(control.data)
        break

      case 'protocol_error':
        this.setState({ lastError: control.data.message })
        break
    }
  }

  private handleReloadRequired(data: {
    expected_protocol_version: number
    expected_build_fingerprint: string
    reason: string
  }): void {
    const expected = data.expected_build_fingerprint

    if (data.expected_protocol_version !== PROTOCOL_VERSION) {
      // A reload cannot fix a bundle that speaks a different protocol version
      // than the host was compiled with; reloading would loop forever.
      this.block(
        `Host speaks protocol v${data.expected_protocol_version}, this bundle speaks v${PROTOCOL_VERSION}. ${data.reason}`,
      )
      return
    }

    // Reload at most once per expected fingerprint. If we already reloaded for
    // this exact build and the host still rejects us, reloading again would
    // loop, so show a blocking diagnostic instead.
    if (sessionStorage.getItem(RELOAD_MARK_KEY) === expected) {
      this.block(
        `Reloaded for build ${expected} already and the host still rejects this bundle. ${data.reason}`,
      )
      return
    }

    this.closedByUs = true
    sessionStorage.setItem(RELOAD_MARK_KEY, expected)
    const url = new URL('/', document.baseURI)
    url.searchParams.set('build', expected)
    window.location.replace(url.toString())
  }

  private block(reason: string): void {
    this.closedByUs = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.setState({ phase: 'blocked', blockedReason: reason, lastError: reason })
  }

  private startPinging(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
    this.pingTimer = window.setInterval(() => {
      this.pingNonce += 1
      this.pendingPing = { nonce: this.pingNonce, sentAt: performance.now() }
      this.send({ type: 'ping', data: { nonce: this.pingNonce } })
    }, PING_INTERVAL_MS)
  }

  /** Called by the store when a `pong` arrives, to close the latency sample. */
  notePong(nonce: number): void {
    if (this.pendingPing?.nonce !== nonce) return
    const latency = Math.round(performance.now() - this.pendingPing.sentAt)
    this.pendingPing = null
    this.setState({ latencyMs: latency })
  }

  private scheduleReconnect(reason: string): void {
    if (this.closedByUs || this.state.phase === 'blocked') return
    const attempt = this.state.attempt + 1
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
    this.setState({ phase: 'reconnecting', attempt, lastError: reason })
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private send(message: Parameters<typeof encodeClientMessage>[0]): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeDone) {
      return false
    }
    try {
      this.socket.send(encodeClientMessage(message))
      return true
    } catch (error) {
      this.setState({ lastError: describe(error) })
      return false
    }
  }

  sendCommand(command: BrowserCommand): boolean {
    return this.send({ type: 'command', data: command })
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Clears the one-shot reload guard once a connection has been accepted. */
export function clearReloadMark(): void {
  sessionStorage.removeItem(RELOAD_MARK_KEY)
}
