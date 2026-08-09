// The two shells.
//
// A shell owns only the chrome: the top bar and whatever sits above and below
// the dock. Both host the identical dock tree and the identical panel registry,
// so switching shells never loses a layout, and the theme decides how either
// one looks.

import { useMemo, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import { DockView } from '../docking/Dock'
import { availablePanels } from '../panels/registry'
import { useLiveTick, useMeta, usePrimaryWorld, useStore } from '../store/hooks'
import { PROTOCOL_VERSION } from '../protocol/types'
import { useCopy } from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import { formatNs, relativeTime } from '../util/format'
import { CommandPalette } from './CommandPalette'
import { TopBar } from './TopBar'
import { useOpenPanel } from './useShellActions'
import { useShortcuts } from './useShortcuts'
import './shell.css'

export function Shell() {
  const { config, workspace, setLayout, setActiveWorkspace, updateField } = useConfig()
  const store = useStore()
  const meta = useMeta()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPanel = useOpenPanel()

  const shortcutHandlers = useMemo(() => {
    const simharkId = systemIdOfKind(meta, 'simhark')
    const crashPilotId = systemIdOfKind(meta, 'crash_pilot')
    const mutable = canMutate(meta)
    const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)

    const simhark = (data: { type: 'start' } | { type: 'pause' } | { type: 'step'; data: { frames: number } }) => {
      if (!simharkId || !mutable) return
      store.send('shortcut', {
        type: 'system',
        data: { system_id: simharkId, command: { type: 'simhark', data } },
      })
    }
    const emergency = (type: 'halt_all' | 'stop_all') => {
      if (!crashPilotId) return
      store.send(
        'shortcut',
        {
          type: 'system',
          data: { system_id: crashPilotId, command: { type: 'crash_pilot', data: { type } } },
        },
        type === 'halt_all' ? 'HALT ALL' : 'STOP ALL',
      )
    }
    const workspaceAt = (index: number) => () => {
      const target = config.workspaces[index]
      if (target) setActiveWorkspace(target.id)
    }

    return {
      'command-palette': () => setPaletteOpen((open) => !open),
      'halt-all': () => emergency('halt_all'),
      'stop-all': () => emergency('stop_all'),
      'toggle-live': () => store.setLive('shortcut', meta.cursor ? !meta.cursor.live : false),
      'transport-toggle': () =>
        simhark({ type: session?.lifecycle === 'running' ? 'pause' : 'start' }),
      'step-back': () => simhark({ type: 'step', data: { frames: -1 } }),
      'step-forward': () => simhark({ type: 'step', data: { frames: 1 } }),
      'fit-field': () => window.dispatchEvent(new CustomEvent('interfaabs:fit-field')),
      'mirror-x': () => updateField({ mirrorX: !config.field.mirrorX }),
      'mirror-y': () => updateField({ mirrorY: !config.field.mirrorY }),
      'toggle-debug-layers': () =>
        updateField({ showDebugOverlays: !config.field.showDebugOverlays }),
      'workspace-1': workspaceAt(0),
      'workspace-2': workspaceAt(1),
      'workspace-3': workspaceAt(2),
      'open-settings': () => openPanel('settings'),
    }
  }, [config, meta, openPanel, setActiveWorkspace, store, updateField])

  useShortcuts(shortcutHandlers)

  const registry = useMemo(() => availablePanels(meta), [meta])
  const review = meta.cursor ? !meta.cursor.live : false
  const dock = (
    <DockView
      layout={workspace.layout}
      onChange={setLayout}
      registry={registry}
      themeKey={`${config.theme}:${config.density}`}
    />
  )

  return (
    <div className={`shell shell--${config.shell} ${review ? 'is-review' : 'is-live'}`}>
      <TopBar
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenBarSettings={() => openPanel('settings')}
      />

      {config.shell === 'brief' && <SubHead />}

      <div className="shell-body">{dock}</div>

      {config.shell === 'evolved' ? <StatusBar /> : <BriefFooter />}

      <ConnectionBanner />
      {config.showAlertToasts && <AlertToasts />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}

function SubHead() {
  const { workspace } = useConfig()
  const meta = useMeta()
  const world = usePrimaryWorld()
  useLiveTick()

  const note = meta.cursor && !meta.cursor.live
    ? `reviewing frame ${meta.cursor.frame ?? 0}`
    : world
      ? `${world.robots.length} tracked · world ${world.world_id}`
      : 'no world'

  return (
    <div className="shell-subhead">
      <b>{workspace.label}</b>
      <span>{describeWorkspace(workspace.kind)}</span>
      <div className="shell-grow" />
      {meta.alerts.length > 0 && (
        <span className="shell-subnote shell-subnote--warn">
          {meta.alerts.length} alert{meta.alerts.length === 1 ? '' : 's'}
        </span>
      )}
      <span className="shell-subnote ui-mono">{note}</span>
    </div>
  )
}

function describeWorkspace(kind: string): string {
  switch (kind) {
    case 'start':
      return 'create a session'
    case 'live':
      return 'command the squad'
    case 'replay':
      return 'scrub the recording'
    default:
      return 'custom workspace'
  }
}

function StatusBar() {
  const meta = useMeta()
  const world = usePrimaryWorld()
  const [copied, copy] = useCopy()
  useLiveTick()

  const token = [
    meta.connection.serverBuildFingerprint ?? 'unknown-build',
    meta.activeSessionId?.slice(0, 8) ?? 'no-session',
    world ? `f${world.frame}` : 'f—',
    world ? formatNs(world.simulation_time_ns) : '—',
    world ? `w${world.world_id}` : 'w—',
  ].join(' · ')

  return (
    <footer className="shell-status">
      <span className={`shell-mode ${meta.cursor && !meta.cursor.live ? 'is-review' : ''}`}>
        {meta.cursor && !meta.cursor.live ? 'REVIEW' : 'LIVE'}
      </span>
      <span>
        frame <b className="ui-mono">{world ? world.frame.toLocaleString() : '—'}</b>
      </span>
      <span>
        sim <b className="ui-mono">{world ? formatNs(world.simulation_time_ns) : '—'}</b>
      </span>
      <span>
        worlds <b className="ui-mono">{meta.worldIds.length}</b>
      </span>
      <div className="shell-grow" />
      <span>
        {meta.connection.connectedBrowsers} client
        {meta.connection.connectedBrowsers === 1 ? '' : 's'}
      </span>
      <span>protocol v{PROTOCOL_VERSION}</span>
      <button className="shell-token ui-mono" onClick={() => copy(token)} title="Copy debug token">
        ⧉ {copied ? 'copied' : token}
      </button>
    </footer>
  )
}

function BriefFooter() {
  const store = useStore()
  const meta = useMeta()
  const world = usePrimaryWorld()
  const [copied, copy] = useCopy()
  useLiveTick()

  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)
  const liveFrame = session?.live_frame ?? world?.frame ?? 0
  const cursorFrame = meta.cursor?.live === false ? (meta.cursor.frame ?? 0) : liveFrame
  const progress = liveFrame > 0 ? cursorFrame / liveFrame : 0

  const token = [
    meta.connection.serverBuildFingerprint ?? 'unknown-build',
    world ? `f${world.frame}` : 'f—',
    world ? formatNs(world.simulation_time_ns) : '—',
  ].join(' · ')

  return (
    <footer className="shell-brieffoot">
      <span className="ui-mono shell-foot-time">
        {cursorFrame.toLocaleString()}
      </span>
      <div
        className="shell-track"
        onPointerDown={(event) => {
          if (!session) return
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
          store.setLive('shell-timeline', false, Math.round(ratio * liveFrame))
        }}
      >
        <div className="shell-track-fill" style={{ width: `${progress * 100}%` }} />
        <div className="shell-track-head" style={{ left: `${progress * 100}%` }} />
      </div>
      <span className="ui-mono shell-foot-time">
        {world ? formatNs(world.simulation_time_ns) : '—'}
      </span>
      <button className="shell-token ui-mono" onClick={() => copy(token)} title="Copy debug token">
        {copied ? 'copied' : token}
      </button>
    </footer>
  )
}

/**
 * The one piece of chrome neither shell may hide: when the host is unreachable
 * or refuses this bundle, nothing else on screen is trustworthy.
 */
function ConnectionBanner() {
  const meta = useMeta()
  const { phase, blockedReason, lastError, attempt } = meta.connection

  if (phase === 'open') return null

  if (phase === 'blocked') {
    return (
      <div className="shell-banner shell-banner--error">
        <b>This page cannot talk to the host</b>
        <span>{blockedReason}</span>
        <button onClick={() => window.location.reload()}>Reload anyway</button>
      </div>
    )
  }

  return (
    <div className="shell-banner">
      <b>
        {phase === 'reconnecting'
          ? `Reconnecting (attempt ${attempt})`
          : phase === 'bootstrapping'
            ? 'Contacting host'
            : phase === 'handshaking'
              ? 'Handshaking'
              : 'Connecting'}
      </b>
      {lastError && <span>{lastError}</span>}
    </div>
  )
}

function AlertToasts() {
  const store = useStore()
  const meta = useMeta()
  const recent = meta.alerts.slice(-3)
  if (recent.length === 0) return null

  return (
    <div className="shell-toasts">
      {recent.map((alert) => (
        <div key={alert.id} className={`shell-toast shell-toast--${alert.level}`}>
          <div>
            <b>{alert.title}</b>
            <span>{alert.body}</span>
            <i>{relativeTime(alert.at)}</i>
          </div>
          <button onClick={() => store.dismissAlert(alert.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
