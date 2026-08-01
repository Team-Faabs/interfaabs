// Worlds and session control: explicit world selection, lifecycle transitions
// and cancellation.
//
// `SimharkCommand::LaunchMatch` is deliberately not offered here. The simhark
// adapter rejects it with "match launch is handled by match-runner", so a
// button for it would always fail; Start Center's `CreateSession` is the path
// that works.

import { useConfig } from '../config/ConfigContext'
import type { SessionLifecycle } from '../protocol/types'
import { useLiveTick, useMeta, useStore, useWorlds } from '../store/hooks'
import { Button, Empty, SectionTitle, Toggle } from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import { formatNs } from '../util/format'
import './worlds.css'

const TRANSITIONS: Array<{ to: SessionLifecycle; label: string; tone?: 'warn' | 'danger' }> = [
  { to: 'running', label: 'Run' },
  { to: 'paused', label: 'Pause' },
  { to: 'completed', label: 'Complete' },
  { to: 'cancelled', label: 'Cancel', tone: 'danger' },
]

export function WorldsPanel() {
  const store = useStore()
  const meta = useMeta()
  const worlds = useWorlds()
  const { config, updateField } = useConfig()
  useLiveTick()

  const mutable = canMutate(meta)
  const simharkId = systemIdOfKind(meta, 'simhark')
  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId) ?? null

  const selected = meta.cursor?.world_ids ?? []

  const applySelection = (worldIds: number[]) => {
    if (!simharkId) return
    store.send(
      'worlds',
      {
        type: 'system',
        data: {
          system_id: simharkId,
          command: { type: 'simhark', data: { type: 'select_worlds', data: { world_ids: worldIds } } },
        },
      },
      `select worlds ${worldIds.join(', ') || 'none'}`,
    )
    if (meta.cursor) store.setCursor({ ...meta.cursor, world_ids: worldIds })
  }

  return (
    <div className="ui-scroll">
      <SectionTitle>Session</SectionTitle>
      {!session ? (
        <div className="wl-note">No active session.</div>
      ) : (
        <>
          <div className="ui-kv">
            <div>
              <span>Label</span>
              <b>{session.label}</b>
            </div>
            <div>
              <span>Kind</span>
              <b>{session.kind}</b>
            </div>
            <div>
              <span>Lifecycle</span>
              <b>{session.lifecycle}</b>
            </div>
            <div>
              <span>Worlds</span>
              <b>{session.world_count}</b>
            </div>
            <div>
              <span>Live frame</span>
              <b>{session.live_frame?.toLocaleString() ?? '—'}</b>
            </div>
          </div>
          {session.terminal_error && (
            <div className="wl-note wl-note--error">{session.terminal_error}</div>
          )}
          <div className="wl-actions">
            {TRANSITIONS.map((transition) => (
              <Button
                key={transition.to}
                size="sm"
                tone={transition.tone}
                disabled={!mutable || session.lifecycle === transition.to}
                onClick={() =>
                  store.send(
                    'worlds',
                    {
                      type: 'set_session_lifecycle',
                      data: { session_id: session.id, lifecycle: transition.to },
                    },
                    `session → ${transition.to}`,
                  )
                }
              >
                {transition.label}
              </Button>
            ))}
            {simharkId && (
              <Button
                size="sm"
                tone="danger"
                disabled={!mutable}
                onClick={() =>
                  store.send(
                    'worlds',
                    {
                      type: 'system',
                      data: {
                        system_id: simharkId,
                        command: { type: 'simhark', data: { type: 'cancel_session' } },
                      },
                    },
                    'cancel simulation',
                  )
                }
              >
                Cancel simulation
              </Button>
            )}
          </div>
        </>
      )}

      <SectionTitle aside={`${worlds.length}`}>Worlds</SectionTitle>
      {worlds.length === 0 ? (
        <Empty title="No worlds" hint="Nothing is being simulated or tracked." />
      ) : (
        <>
          <div className="wl-list">
            {worlds.map((frame) => {
              const worldId = frame.world.world_id
              const isFocused =
                config.field.multiWorld === 'focus' &&
                (config.field.focusWorldId === worldId ||
                  (config.field.focusWorldId === null && worlds[0].world.world_id === worldId))
              return (
                <div className={`wl-row ${isFocused ? 'is-focused' : ''}`} key={worldId}>
                  <Toggle
                    checked={selected.length === 0 || selected.includes(worldId)}
                    onChange={(checked) =>
                      applySelection(
                        checked
                          ? [...new Set([...selected, worldId])]
                          : selected.filter((id) => id !== worldId),
                      )
                    }
                    label={`World ${worldId}`}
                    hint="Publishing selection, sent to the simulator"
                  />
                  <span className="wl-meta ui-mono">
                    f{frame.world.frame.toLocaleString()} ·{' '}
                    {formatNs(frame.world.simulation_time_ns)} · {frame.world.robots.length} robots
                  </span>
                  <button
                    className="wl-focus"
                    title="Focus this world"
                    onClick={() => updateField({ multiWorld: 'focus', focusWorldId: worldId })}
                  >
                    ⤢
                  </button>
                  <button
                    className={`wl-focus ${
                      config.field.compareWorldIds.includes(worldId) ? 'is-on' : ''
                    }`}
                    title="Include in compare"
                    onClick={() =>
                      updateField({
                        compareWorldIds: config.field.compareWorldIds.includes(worldId)
                          ? config.field.compareWorldIds.filter((id) => id !== worldId)
                          : [...config.field.compareWorldIds, worldId],
                      })
                    }
                  >
                    ⊕
                  </button>
                </div>
              )
            })}
          </div>
          {!simharkId && (
            <div className="wl-note">
              No simhark system, so the selection above is local to this browser.
            </div>
          )}
        </>
      )}
    </div>
  )
}
