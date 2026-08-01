// Navigator panels: systems, sessions, recordings, debug layers and protocol
// diagnostics.

import { useEffect, useMemo, useRef, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import type { DebugLayer, ExportFormat } from '../protocol/types'
import { PROTOCOL_VERSION } from '../protocol/types'
import { useMeta, useStore } from '../store/hooks'
import {
  Button,
  Empty,
  IconButton,
  SectionTitle,
  StatusDot,
  TextInput,
  Toggle,
  useCopy,
} from '../ui/primitives'
import { canMutate } from '../util/systems'
import { formatClock, formatNs, relativeTime } from '../util/format'
import './nav.css'

export function SystemsPanel() {
  const store = useStore()
  const meta = useMeta()

  if (meta.systems.length === 0) {
    return (
      <Empty
        title="No systems registered"
        hint="Systems appear as their host registers them. An empty host advertises none."
      />
    )
  }

  return (
    <div className="ui-scroll">
      {meta.systems.map((system) => {
        const health = meta.health[system.id]
        return (
          <div className="nav-card" key={system.id}>
            <div className="nav-card-head">
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
                title={health?.level ?? 'unknown'}
              />
              <b>{system.label}</b>
              <span className="ui-dim ui-mono">gen {system.generation}</span>
            </div>
            {health && <div className="nav-card-note">{health.message}</div>}
            <div className="nav-caps">
              {system.capabilities.length === 0 && (
                <span className="ui-dim">No advertised capabilities.</span>
              )}
              {system.capabilities.map((capability) => (
                <span
                  key={capability.id}
                  className={`nav-cap ${capability.mutable ? 'is-mutable' : ''}`}
                  title={capability.description}
                >
                  {capability.id}
                </span>
              ))}
            </div>
            {(meta.generations[system.id]?.length ?? 0) > 1 && (
              <div className="nav-gens">
                {meta.generations[system.id].slice(-6).map((entry) => (
                  <span key={entry.generation} title={new Date(entry.at).toLocaleString()}>
                    gen {entry.generation} · {relativeTime(entry.at)}
                  </span>
                ))}
              </div>
            )}
            {system.kind === 'crash_pilot' && (
              <div className="nav-card-actions">
                <Button
                  size="sm"
                  onClick={() =>
                    store.send('systems', {
                      type: 'system',
                      data: {
                        system_id: system.id,
                        command: { type: 'crash_pilot', data: { type: 'reconnect' } },
                      },
                    })
                  }
                >
                  Reconnect
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SessionsPanel() {
  const store = useStore()
  const meta = useMeta()

  if (meta.sessions.length === 0) {
    return (
      <Empty
        title="No sessions"
        hint="Start a match, test or replay from Start Center. A host launched without arguments deliberately creates none."
      />
    )
  }

  return (
    <div className="ui-scroll">
      {meta.sessions.map((session) => (
        <button
          key={session.id}
          className={`nav-row ${session.id === meta.activeSessionId ? 'is-active' : ''}`}
          onClick={() => store.setActiveSession(session.id)}
        >
          <span className={`nav-life nav-life--${session.lifecycle}`}>{session.lifecycle}</span>
          <span className="nav-row-main">
            <b>{session.label}</b>
            <i>
              {session.kind} · {session.world_count} world
              {session.world_count === 1 ? '' : 's'}
              {session.live_frame !== null && ` · frame ${session.live_frame.toLocaleString()}`}
            </i>
          </span>
          {!session.mutable && <span className="nav-badge">read-only</span>}
          {session.terminal_error && (
            <span className="nav-badge nav-badge--error" title={session.terminal_error}>
              error
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'faabs_recording', label: 'Native .faabsrec' },
  { id: 'ssl_log', label: 'SSL log' },
  { id: 'json', label: 'JSON report' },
  { id: 'csv_events', label: 'CSV events' },
]

export function RecordingsPanel() {
  const store = useStore()
  const meta = useMeta()
  const mutable = canMutate(meta)
  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId) ?? null
  const [dragging, setDragging] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // The library arrives unprompted after connect, but a rescan is cheap and
  // the operator may have dropped a file in from a terminal.
  useEffect(() => {
    if (meta.connection.phase === 'open') {
      store.send('recordings', { type: 'refresh_recordings' }, 'refresh recordings')
    }
  }, [store, meta.connection.phase])

  const upload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setImporting(true)
    setImportError(null)
    try {
      const url = new URL('api/v1/recordings/import', document.baseURI)
      url.searchParams.set('filename', file.name)
      const response = await fetch(url, { method: 'POST', body: file })
      if (!response.ok) {
        throw new Error(`${response.status}: ${(await response.text()).slice(0, 200)}`)
      }
      store.send('recordings', { type: 'refresh_recordings' }, 'refresh recordings')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      className={`nav-recordings ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void upload(event.dataTransfer.files)
      }}
    >
      <div className="nav-layers-bar">
        <Button
          size="sm"
          onClick={() =>
            store.send('recordings', { type: 'refresh_recordings' }, 'refresh recordings')
          }
        >
          Refresh
        </Button>
        <Button size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? 'Importing…' : 'Import…'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".faabsrec,.shreplay,.log,.gz"
          onChange={(event) => {
            void upload(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
      </div>

      {importError && <div className="nav-note nav-note--error">{importError}</div>}

      <div className="ui-scroll">
        <SectionTitle aside={`${meta.recordings.length}`}>Library</SectionTitle>
        {meta.recordings.length === 0 ? (
          <div className="nav-note">
            Nothing in the recordings directory yet. Drop a <code>.faabsrec</code>,{' '}
            <code>.shreplay</code> or SSL log here to import one.
          </div>
        ) : (
          meta.recordings.map((recording) => (
            <div className="nav-recording" key={recording.id}>
              <div className="nav-recording-head">
                <b>{recording.label}</b>
                {recording.partial && <span className="nav-badge">partial</span>}
                <span className="nav-badge">{recording.format}</span>
              </div>
              <div className="nav-recording-meta ui-mono">
                {formatBytes(recording.size_bytes)}
                {recording.frame_count !== null && ` · ${recording.frame_count.toLocaleString()} frames`}
                {recording.duration_ns !== null && ` · ${formatNs(recording.duration_ns)}`}
                {` · ${formatClock(recording.modified_at_ns / 1e6)}`}
              </div>
              {recording.error && (
                <div className="nav-note nav-note--error">{recording.error}</div>
              )}
              <div className="nav-card-actions">
                <Button
                  size="sm"
                  disabled={recording.error !== null}
                  onClick={() =>
                    store.send(
                      'recordings',
                      { type: 'open_recording', data: { recording_id: recording.id } },
                      `open ${recording.label}`,
                    )
                  }
                >
                  Open
                </Button>
              </div>
            </div>
          ))
        )}

        <SectionTitle>Recording</SectionTitle>
        {!session ? (
          <div className="nav-note">No active session to record.</div>
        ) : (
          <>
            <div className="nav-card">
              <div className="nav-card-head">
                <b>{session.label}</b>
                <span className="ui-dim ui-mono">
                  {meta.recordingSessions.includes(session.id) ? 'recording' : 'idle'}
                </span>
              </div>
              <div className="nav-card-actions">
                <Button
                  size="sm"
                  disabled={!mutable || meta.recordingSessions.includes(session.id)}
                  onClick={() =>
                    store.send('recordings', {
                      type: 'start_recording',
                      data: { session_id: session.id },
                    })
                  }
                >
                  Start
                </Button>
                <Button
                  size="sm"
                  disabled={!mutable || !meta.recordingSessions.includes(session.id)}
                  onClick={() =>
                    store.send('recordings', {
                      type: 'stop_recording',
                      data: { session_id: session.id },
                    })
                  }
                >
                  Stop
                </Button>
              </div>
            </div>

            <SectionTitle>Export</SectionTitle>
            <div className="nav-card">
              <div className="nav-card-note">
                Exporting while recording flushes at a consistent chunk boundary, so the written
                file is openable even though the session is still live.
              </div>
              <div className="nav-card-actions nav-card-actions--wrap">
                {EXPORT_FORMATS.map((format) => (
                  <Button
                    key={format.id}
                    size="sm"
                    onClick={() =>
                      store.send(
                        'recordings',
                        {
                          type: 'export',
                          data: {
                            session_id: session.id,
                            format: format.id,
                            destination: null,
                          },
                        },
                        `export ${format.label}`,
                      )
                    }
                  >
                    {format.label}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

export function LayersPanel() {
  const meta = useMeta()
  const { config, updateField } = useConfig()
  const settings = config.field
  const [search, setSearch] = useState('')

  const tree = useMemo(() => buildTree(meta.debugLayers), [meta.debugLayers])
  const needle = search.trim().toLowerCase()

  if (meta.debugLayers.length === 0) {
    return (
      <Empty
        title="No debug layers"
        hint="Layers are published by the AI and debug systems. None have been advertised for this session."
      />
    )
  }

  const setHidden = (id: string, hidden: boolean) => {
    const next = new Set(settings.hiddenLayerIds)
    if (hidden) next.add(id)
    else next.delete(id)
    updateField({ hiddenLayerIds: [...next] })
  }

  return (
    <div className="nav-layers">
      <div className="nav-layers-bar">
        <TextInput
          placeholder="Search layers…"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <IconButton
          title="Hide all"
          onClick={() =>
            updateField({ hiddenLayerIds: meta.debugLayers.map((layer) => layer.id) })
          }
        >
          ⊘
        </IconButton>
        <IconButton
          title="Show all"
          onClick={() => updateField({ hiddenLayerIds: [], soloLayerId: null })}
        >
          ⊙
        </IconButton>
      </div>

      <div className="ui-scroll">
        {tree
          .filter((node) => !needle || node.label.toLowerCase().includes(needle))
          .map((node) => (
            <LayerRow
              key={node.id}
              node={node}
              depth={0}
              hidden={settings.hiddenLayerIds}
              solo={settings.soloLayerId}
              onToggle={setHidden}
              onSolo={(id) =>
                updateField({ soloLayerId: settings.soloLayerId === id ? null : id })
              }
              search={needle}
            />
          ))}
      </div>

      <div className="nav-layers-foot">
        <label className="nav-opacity">
          <span>Opacity</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.layerOpacity}
            onChange={(event) =>
              updateField({ layerOpacity: Number(event.currentTarget.value) })
            }
          />
          <b className="ui-mono">{Math.round(settings.layerOpacity * 100)}%</b>
        </label>
        <Toggle
          checked={settings.showDebugOverlays}
          onChange={(showDebugOverlays) => updateField({ showDebugOverlays })}
          label="Draw debug layers"
        />
      </div>
    </div>
  )
}

interface LayerNode extends DebugLayer {
  children: LayerNode[]
}

function buildTree(layers: DebugLayer[]): LayerNode[] {
  const nodes = new Map<string, LayerNode>(
    layers.map((layer) => [layer.id, { ...layer, children: [] }]),
  )
  const roots: LayerNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

function LayerRow({
  node,
  depth,
  hidden,
  solo,
  onToggle,
  onSolo,
  search,
}: {
  node: LayerNode
  depth: number
  hidden: string[]
  solo: string | null
  onToggle: (id: string, hidden: boolean) => void
  onSolo: (id: string) => void
  search: string
}) {
  const isHidden = hidden.includes(node.id)
  const matches = !search || node.label.toLowerCase().includes(search)
  const visibleChildren = node.children.filter(
    (child) => !search || child.label.toLowerCase().includes(search),
  )
  if (!matches && visibleChildren.length === 0) return null

  return (
    <>
      <div className="nav-layer" style={{ paddingLeft: 8 + depth * 14 }}>
        <input
          type="checkbox"
          checked={!isHidden}
          onChange={(event) => onToggle(node.id, !event.currentTarget.checked)}
        />
        <span className="nav-layer-label">{node.label}</span>
        <button
          className={`nav-solo ${solo === node.id ? 'is-on' : ''}`}
          title="Solo this layer"
          onClick={() => onSolo(node.id)}
        >
          S
        </button>
      </div>
      {node.children.map((child) => (
        <LayerRow
          key={child.id}
          node={child}
          depth={depth + 1}
          hidden={hidden}
          solo={solo}
          onToggle={onToggle}
          onSolo={onSolo}
          search={search}
        />
      ))}
    </>
  )
}

export function DiagnosticsPanel() {
  const meta = useMeta()
  const [copied, copy] = useCopy()
  const connection = meta.connection

  const token = [
    connection.serverBuildFingerprint ?? 'unknown-build',
    meta.activeSessionId ?? 'no-session',
    `proto v${PROTOCOL_VERSION}`,
    connection.assetBuildFingerprint ?? 'unknown-assets',
  ].join(' · ')

  return (
    <div className="ui-scroll">
      <SectionTitle>Connection</SectionTitle>
      <div className="ui-kv">
        <div>
          <span>Phase</span>
          <b>{connection.phase}</b>
        </div>
        <div>
          <span>Protocol</span>
          <b>v{PROTOCOL_VERSION}</b>
        </div>
        <div>
          <span>Server build</span>
          <b>{connection.serverBuildFingerprint ?? '—'}</b>
        </div>
        <div>
          <span>Asset build</span>
          <b>{connection.assetBuildFingerprint ?? '—'}</b>
        </div>
        <div>
          <span>Connected browsers</span>
          <b>{connection.connectedBrowsers}</b>
        </div>
        <div>
          <span>Latency</span>
          <b>{connection.latencyMs === null ? '—' : `${connection.latencyMs} ms`}</b>
        </div>
        <div>
          <span>Reconnect attempts</span>
          <b>{connection.attempt}</b>
        </div>
        <div>
          <span>Since</span>
          <b>{connection.since ? relativeTime(connection.since) : '—'}</b>
        </div>
      </div>
      {connection.lastError && <div className="nav-note nav-note--error">{connection.lastError}</div>}

      <SectionTitle>Host capabilities</SectionTitle>
      <div className="nav-caps nav-caps--padded">
        {meta.capabilities.length === 0 && <span className="ui-dim">None advertised.</span>}
        {meta.capabilities.map((capability) => (
          <span className="nav-cap" key={capability}>
            {capability}
          </span>
        ))}
      </div>

      <SectionTitle>Debug token</SectionTitle>
      <div className="nav-token">
        <code className="ui-mono">{token}</code>
        <Button size="sm" onClick={() => copy(token)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}
