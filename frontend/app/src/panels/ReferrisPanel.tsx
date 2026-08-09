// Referris. Capability-gated in three ways, per the plan:
//
//   * If the host advertises no Referris system, the panel says so and offers
//     nothing — the top-level UI hides it entirely (see `registry.tsx`).
//   * Mutation is offered only when the Referris capability is advertised as
//     mutable, which is how a live match stays read-only unless the host
//     explicitly enables Referris control.
//   * The host rejects forbidden mutations anyway; this only avoids presenting
//     controls that would certainly fail.

import { useMemo, useState } from 'react'

import { useLiveTick, useMeta, usePrimaryWorld, useStore } from '../store/hooks'
import { Button, Empty, SectionTitle, StatusDot, TextInput } from '../ui/primitives'
import { canMutate } from '../util/systems'
import { formatNs, relativeTime } from '../util/format'
import './referris.css'

export function ReferrisPanel() {
  const store = useStore()
  const meta = useMeta()
  const world = usePrimaryWorld()
  useLiveTick()
  const [configuration, setConfiguration] = useState('')
  const [configError, setConfigError] = useState<string | null>(null)

  const system = meta.systems.find((entry) => entry.kind === 'referris')

  const controllable = useMemo(() => {
    if (!system) return false
    const explicit = system.capabilities.find((capability) =>
      capability.id.startsWith('referris'),
    )
    return (explicit?.mutable ?? false) && canMutate(meta)
  }, [system, meta])

  if (!system) {
    return (
      <Empty
        title="Referris is not available"
        hint="The host advertises no Referris system, so there is nothing to show or control. Referris is optional and capability-gated."
      />
    )
  }

  const health = meta.health[system.id]
  const referee = world?.referee
  const properties = store.getSnapshotProperties()
  const rules = asArray(properties['referris.rules'])
  const detectors = asArray(properties['referris.detectors'])
  const pending = asArray(properties['referris.pending_events'])

  const send = (
    command:
      | { type: 'start' }
      | { type: 'stop' }
      | { type: 'reset' }
      | { type: 'set_configuration'; data: unknown },
    summary: string,
  ) => {
    store.send(
      'referris',
      {
        type: 'system',
        data: { system_id: system.id, command: { type: 'referris', data: command } },
      },
      summary,
    )
  }

  return (
    <div className="ui-scroll">
      <div className="rf-head">
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
        <div>
          <b>{system.label}</b>
          <i>{health?.message ?? 'no health reported'}</i>
        </div>
        <span className="ui-dim ui-mono">gen {system.generation}</span>
      </div>

      {!controllable && (
        <div className="rf-readonly">
          Read-only. The host has not advertised Referris control as mutable
          {meta.cursor && !meta.cursor.live ? ', and the viewer is detached from live' : ''}.
        </div>
      )}

      <SectionTitle>Lifecycle</SectionTitle>
      <div className="rf-actions">
        <Button size="sm" disabled={!controllable} onClick={() => send({ type: 'start' }, 'referris start')}>
          Start
        </Button>
        <Button size="sm" disabled={!controllable} onClick={() => send({ type: 'stop' }, 'referris stop')}>
          Stop
        </Button>
        <Button
          size="sm"
          tone="warn"
          disabled={!controllable}
          onClick={() => send({ type: 'reset' }, 'referris reset')}
        >
          Reset
        </Button>
      </div>

      <SectionTitle>State</SectionTitle>
      {referee ? (
        <div className="ui-kv">
          <div>
            <span>Stage</span>
            <b>{referee.stage ?? '—'}</b>
          </div>
          <div>
            <span>Command</span>
            <b>{referee.command}</b>
          </div>
          <div>
            <span>Score</span>
            <b>
              {referee.score.blue} — {referee.score.yellow}
            </b>
          </div>
          <div>
            <span>Stage time left</span>
            <b>{formatNs(referee.stage_time_left_ns)}</b>
          </div>
          <div>
            <span>Action time</span>
            <b>{formatNs(referee.action_time_remaining_ns)}</b>
          </div>
        </div>
      ) : (
        <div className="rf-note">No referee state published yet.</div>
      )}

      <SectionTitle aside={`${pending.length}`}>Pending events</SectionTitle>
      {pending.length === 0 ? (
        <div className="rf-note">None pending.</div>
      ) : (
        <div className="rf-list">
          {pending.map((entry, index) => (
            <code key={index} className="ui-mono">
              {JSON.stringify(entry)}
            </code>
          ))}
        </div>
      )}

      <SectionTitle aside={`${meta.events.length}`}>Emitted events</SectionTitle>
      <div className="rf-list">
        {meta.events.slice(-12).reverse().map((event) => (
          <div className="rf-event" key={event.id}>
            <span className="ui-mono">{formatNs(event.at_ns)}</span>
            <b>{event.kind}</b>
            <i>{event.label}</i>
          </div>
        ))}
        {meta.events.length === 0 && <div className="rf-note">Nothing emitted yet.</div>}
      </div>

      <SectionTitle aside={`${rules.length}`}>Rules</SectionTitle>
      <Chips values={rules} empty="The host publishes no rule list." />

      <SectionTitle aside={`${detectors.length}`}>Detectors</SectionTitle>
      <Chips values={detectors} empty="The host publishes no detector list." />

      <SectionTitle>Configuration</SectionTitle>
      <div className="rf-config">
        <TextInput
          placeholder='JSON, e.g. {"double_touch": true}'
          value={configuration}
          disabled={!controllable}
          onChange={(event) => {
            setConfiguration(event.currentTarget.value)
            setConfigError(null)
          }}
        />
        <Button
          size="sm"
          disabled={!controllable || configuration.trim() === ''}
          onClick={() => {
            try {
              const parsed: unknown = JSON.parse(configuration)
              send({ type: 'set_configuration', data: parsed }, 'referris configuration')
              setConfiguration('')
            } catch (error) {
              setConfigError(error instanceof Error ? error.message : String(error))
            }
          }}
        >
          Apply
        </Button>
      </div>
      {configError && <div className="rf-note rf-note--error">{configError}</div>}
      <div className="rf-note">
        Last updated {health ? relativeTime(health.updated_at_ns / 1e6) : 'never'}.
      </div>
    </div>
  )
}

function Chips({ values, empty }: { values: unknown[]; empty: string }) {
  if (values.length === 0) return <div className="rf-note">{empty}</div>
  return (
    <div className="rf-chips">
      {values.map((value, index) => (
        <span key={index}>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
      ))}
    </div>
  )
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
