// The configurable top bar.
//
// Both shells render the same item registry; the workspace decides which items
// appear and in what order, and the theme decides how they look. Adding or
// removing an item is a configuration change, not a code change.

import { useRef, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import type { TopBarItemId } from '../config/types'
import type { ExportFormat } from '../protocol/types'
import { useLiveTick, useMeta, usePrimaryWorld, useStore } from '../store/hooks'
import { Button, IconButton, Popover, Segmented, StatusDot, useCopy } from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import { formatNs } from '../util/format'
import { useOpenPanel } from './useShellActions'
import './topbar.css'

export function TopBar({
  onOpenPalette,
  onOpenBarSettings,
}: {
  onOpenPalette: () => void
  onOpenBarSettings: () => void
}) {
  const { workspace } = useConfig()

  return (
    <header
      className="tb"
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenBarSettings()
      }}
      title="Right-click to customise this bar"
    >
      {workspace.topBar
        .filter((item) => item.visible)
        .map((item, index) => (
          <TopBarItem key={`${item.id}-${index}`} id={item.id} onOpenPalette={onOpenPalette} />
        ))}
    </header>
  )
}

function TopBarItem({
  id,
  onOpenPalette,
}: {
  id: TopBarItemId
  onOpenPalette: () => void
}) {
  switch (id) {
    case 'spacer':
      return <div className="tb-spacer" />
    case 'brand':
      return <Brand />
    case 'session':
      return <SessionChip />
    case 'workspace-switcher':
      return <WorkspaceSwitcher />
    case 'transport':
      return <Transport />
    case 'speed':
      return <Speed />
    case 'live-toggle':
      return <LiveToggle />
    case 'return-to-live':
      return <ReturnToLive />
    case 'field-mode':
      return <FieldMode />
    case 'recording':
      return <Recording />
    case 'export':
      return <Export />
    case 'health':
      return <Health />
    case 'alerts':
      return <Alerts />
    case 'clients':
      return <Clients />
    case 'latency':
      return <Latency />
    case 'frame':
      return <Frame />
    case 'sim-time':
      return <SimTime />
    case 'debug-token':
      return <DebugToken />
    case 'command-palette':
      return (
        <IconButton title="Command palette (Ctrl+K)" onClick={onOpenPalette}>
          ⌘
        </IconButton>
      )
    case 'settings':
      return <SettingsButton />
    case 'emergency':
      return <Emergency />
  }
}

function Brand() {
  const meta = useMeta()
  const phase = meta.connection.phase
  return (
    <div className="tb-brand" title={`Connection: ${phase}`}>
      <StatusDot
        tone={
          phase === 'open'
            ? 'ok'
            : phase === 'blocked'
              ? 'error'
              : phase === 'reconnecting'
                ? 'warn'
                : 'idle'
        }
      />
      <span>interfaabs</span>
    </div>
  )
}

function SessionChip() {
  const meta = useMeta()
  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)
  if (!session) return <span className="tb-chip tb-chip--muted">no session</span>
  return (
    <span className="tb-chip" title={`${session.kind} · ${session.lifecycle}`}>
      <b>{session.label}</b>
      <i>{session.lifecycle}</i>
    </span>
  )
}

function WorkspaceSwitcher() {
  const { config, setActiveWorkspace } = useConfig()
  return (
    <Segmented
      size="sm"
      value={config.activeWorkspaceId}
      onChange={setActiveWorkspace}
      options={config.workspaces.map((workspace) => ({
        value: workspace.id,
        label: workspace.label,
      }))}
    />
  )
}

function Transport() {
  const store = useStore()
  const meta = useMeta()
  const simharkId = systemIdOfKind(meta, 'simhark')
  const mutable = canMutate(meta)
  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)
  // The simulator's own pause flag, not the session lifecycle: a paused
  // simhark keeps its session `running`, so reading the lifecycle here showed
  // "playing" while the world stood still.
  const published = store.getSnapshotProperties()['control.running']
  const running =
    typeof published === 'boolean' ? published : session?.lifecycle === 'running'

  const send = (command: 'start' | 'pause' | 'stop' | 'restart') => {
    if (!simharkId) return
    store.send('topbar', {
      type: 'system',
      data: {
        system_id: simharkId,
        command: { type: 'simhark', data: { type: command } },
      },
    })
  }

  const step = (frames: number) => {
    if (!simharkId) return
    store.send('topbar', {
      type: 'system',
      data: {
        system_id: simharkId,
        command: { type: 'simhark', data: { type: 'step', data: { frames } } },
      },
    })
  }

  const disabled = !simharkId || !mutable

  return (
    <div className="tb-transport">
      <IconButton title="Step back one frame" disabled={disabled} onClick={() => step(-1)}>
        ⏮
      </IconButton>
      <IconButton
        title={running ? 'Pause' : 'Start'}
        className={running ? 'on' : ''}
        disabled={disabled}
        onClick={() => send(running ? 'pause' : 'start')}
      >
        {running ? '⏸' : '▶'}
      </IconButton>
      <IconButton title="Step forward one frame" disabled={disabled} onClick={() => step(1)}>
        ⏭
      </IconButton>
      <IconButton title="Restart" disabled={disabled} onClick={() => send('restart')}>
        ⟲
      </IconButton>
    </div>
  )
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]

function Speed() {
  const store = useStore()
  const meta = useMeta()
  const simharkId = systemIdOfKind(meta, 'simhark')
  // The host clamps and rounds what it was asked for, and another browser may
  // have changed it, so the published speed wins over any local echo.
  const published = store.getSnapshotProperties()['control.speed']
  const multiplier = typeof published === 'number' && published > 0 ? published : 1

  return (
    <select
      className="tb-speed"
      value={nearestSpeed(multiplier)}
      disabled={!simharkId || !canMutate(meta)}
      title={`Simulation speed (host reports ${multiplier}×)`}
      onChange={(event) => {
        const next = Number(event.currentTarget.value)
        if (simharkId) {
          store.send('topbar', {
            type: 'system',
            data: {
              system_id: simharkId,
              command: {
                type: 'simhark',
                data: { type: 'set_speed', data: { multiplier: next } },
              },
            },
          })
        }
      }}
    >
      {SPEEDS.map((speed) => (
        <option key={speed} value={speed}>
          {speed}×
        </option>
      ))}
    </select>
  )
}

/**
 * The preset closest to what the host reports. simhark stores speed as a
 * percentage and clamps it, so a requested 8× comes back as 4× and the select
 * has to show something that exists in its own option list.
 */
function nearestSpeed(multiplier: number): number {
  return SPEEDS.reduce((best, speed) =>
    Math.abs(speed - multiplier) < Math.abs(best - multiplier) ? speed : best,
  )
}

function LiveToggle() {
  const store = useStore()
  const meta = useMeta()
  const review = meta.cursor ? !meta.cursor.live : false
  return (
    <button
      className={`tb-live ${review ? 'is-review' : ''}`}
      onClick={() => store.setLive('topbar', review)}
      title={
        review
          ? 'Detached from the live head — the host rejects mutations'
          : 'Following the live head'
      }
    >
      <span className="tb-live-dot" />
      {review ? 'REVIEWING' : 'LIVE'}
    </button>
  )
}

function ReturnToLive() {
  const store = useStore()
  const meta = useMeta()
  if (!meta.cursor || meta.cursor.live) return null
  return (
    <Button tone="warn" size="sm" onClick={() => store.setLive('topbar', true)}>
      Return to live
    </Button>
  )
}

function FieldMode() {
  const { config, updateField } = useConfig()
  return (
    <Segmented
      size="sm"
      value={config.field.multiWorld}
      onChange={(multiWorld) => updateField({ multiWorld })}
      options={[
        { value: 'focus', label: 'Focus' },
        { value: 'grid', label: 'Grid' },
        { value: 'compare', label: 'Compare' },
      ]}
    />
  )
}

function Recording() {
  const store = useStore()
  const meta = useMeta()
  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)
  if (!session) return null

  // Derived from host-accepted commands rather than local state, so a reload
  // and a second browser both show the true recording state.
  const recording = meta.recordingSessions.includes(session.id)

  return (
    <button
      className={`tb-chip tb-rec ${recording ? 'is-on' : ''}`}
      disabled={!canMutate(meta)}
      title={recording ? 'Stop recording' : 'Start recording'}
      onClick={() =>
        store.send('topbar', {
          type: recording ? 'stop_recording' : 'start_recording',
          data: { session_id: session.id },
        })
      }
    >
      <span className="tb-rec-dot" />
      {recording ? 'REC' : 'Record'}
    </button>
  )
}

const EXPORTS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'faabs_recording', label: 'Native .faabsrec' },
  { id: 'ssl_log', label: 'SSL log' },
  { id: 'json', label: 'JSON report' },
  { id: 'csv_events', label: 'CSV events' },
]

function Export() {
  const store = useStore()
  const meta = useMeta()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)
  if (!session) return null

  return (
    <>
      <Button size="sm" ref={ref} onClick={() => setOpen((value) => !value)}>
        Export
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} width={220}>
        <div className="tb-menu">
          {EXPORTS.map((format) => (
            <button
              key={format.id}
              onClick={() => {
                store.send(
                  'topbar',
                  {
                    type: 'export',
                    data: { session_id: session.id, format: format.id, destination: null },
                  },
                  `export ${format.label}`,
                )
                setOpen(false)
              }}
            >
              {format.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}

function Health() {
  const meta = useMeta()
  const entries = meta.systems.slice(0, 4)
  if (entries.length === 0) {
    return <span className="tb-health-empty ui-dim">no systems</span>
  }
  return (
    <div className="tb-health">
      {entries.map((system) => {
        const health = meta.health[system.id]
        return (
          <span key={system.id} title={health?.message ?? 'no health reported'}>
            <StatusDot
              tone={
                !health
                  ? 'idle'
                  : health.level === 'healthy'
                    ? 'ok'
                    : health.level === 'degraded'
                      ? 'warn'
                      : 'error'
              }
            />
            {system.label}
          </span>
        )
      })}
    </div>
  )
}

function Alerts() {
  const meta = useMeta()
  const openPanel = useOpenPanel()
  if (meta.alerts.length === 0) return null
  const worst = meta.alerts.some((alert) => alert.level === 'error') ? 'error' : 'warn'
  return (
    <button
      className={`tb-alerts tb-alerts--${worst}`}
      onClick={() => openPanel('alerts')}
      title="Open alerts"
    >
      ▲ {meta.alerts.length}
    </button>
  )
}

function Clients() {
  const meta = useMeta()
  return (
    <span className="tb-meta ui-mono" title="Connected browsers">
      {meta.connection.connectedBrowsers} client
      {meta.connection.connectedBrowsers === 1 ? '' : 's'}
    </span>
  )
}

function Latency() {
  const meta = useMeta()
  return (
    <span className="tb-meta ui-mono" title="Keepalive round trip">
      {meta.connection.latencyMs === null ? '— ms' : `${meta.connection.latencyMs} ms`}
    </span>
  )
}

function Frame() {
  const world = usePrimaryWorld()
  useLiveTick()
  return (
    <span className="tb-meta ui-mono">
      frame {world ? world.frame.toLocaleString() : '—'}
    </span>
  )
}

function SimTime() {
  const world = usePrimaryWorld()
  useLiveTick()
  return (
    <span className="tb-meta ui-mono">
      {world ? formatNs(world.simulation_time_ns) : '—'}
    </span>
  )
}

function DebugToken() {
  const meta = useMeta()
  const world = usePrimaryWorld()
  const [copied, copy] = useCopy()
  const token = [
    meta.connection.serverBuildFingerprint ?? 'unknown-build',
    meta.activeSessionId?.slice(0, 8) ?? 'no-session',
    world ? `f${world.frame}` : 'f—',
    world ? formatNs(world.simulation_time_ns) : '—',
    world ? `w${world.world_id}` : 'w—',
  ].join(' · ')

  return (
    <button className="tb-token ui-mono" onClick={() => copy(token)} title="Copy debug token">
      ⧉ {copied ? 'copied' : token}
    </button>
  )
}

function SettingsButton() {
  const openPanel = useOpenPanel()
  return (
    <IconButton title="Settings" onClick={() => openPanel('settings')}>
      ⚙
    </IconButton>
  )
}

function Emergency() {
  const store = useStore()
  const meta = useMeta()
  const { config } = useConfig()
  const crashPilotId = systemIdOfKind(meta, 'crash_pilot')

  const fire = (kind: 'halt_all' | 'stop_all') => {
    if (!crashPilotId) return
    if (
      config.confirmEmergency &&
      !window.confirm(kind === 'halt_all' ? 'Halt all robots?' : 'Stop all robots?')
    ) {
      return
    }
    store.send(
      'topbar',
      {
        type: 'system',
        data: {
          system_id: crashPilotId,
          command: { type: 'crash_pilot', data: { type: kind } },
        },
      },
      kind === 'halt_all' ? 'HALT ALL' : 'STOP ALL',
    )
  }

  return (
    <div className="tb-emergency">
      <button className="tb-halt" disabled={!crashPilotId} onClick={() => fire('halt_all')}>
        Halt All
      </button>
      <button className="tb-stop" disabled={!crashPilotId} onClick={() => fire('stop_all')}>
        Stop All
      </button>
    </div>
  )
}
