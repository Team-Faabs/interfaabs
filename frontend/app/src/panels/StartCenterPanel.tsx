// Start Center — the empty-state launcher a host with no arguments opens into.
// It creates sessions; it never invents a world to display.

import { useMemo, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import type { MatchConfiguration, SessionKind } from '../protocol/types'
import { useMeta, useStore } from '../store/hooks'
import { useOpenPanel } from '../shells/useShellActions'
import { Button, Field, Segmented, Select, TextInput, Toggle } from '../ui/primitives'
import { relativeTime } from '../util/format'
import './start-center.css'

const KINDS: Array<{ value: SessionKind; label: string; hint: string }> = [
  { value: 'simulation', label: 'Match', hint: 'Two controllers, one simulated match' },
  { value: 'test', label: 'Test', hint: 'Run the test suite across worlds' },
  { value: 'batch', label: 'Batch', hint: 'Repeat with a seed progression' },
  { value: 'replay', label: 'Replay', hint: 'Open a recording for analysis' },
]

function defaultConfiguration(): MatchConfiguration {
  return {
    blue_controller: '',
    yellow_controller: '',
    blue_robots: 6,
    yellow_robots: 6,
    division: 'B',
    seed: Math.floor(Math.random() * 100_000),
    duration_ns: null,
    batch_count: 1,
    precompute: false,
    development: false,
    record: true,
    parameters: {},
  }
}

export function StartCenterPanel() {
  const store = useStore()
  const meta = useMeta()
  const { config, update, setActiveWorkspace } = useConfig()
  const openPanel = useOpenPanel()

  const [kind, setKind] = useState<SessionKind>('simulation')
  const [label, setLabel] = useState('')
  const [configuration, setConfiguration] = useState<MatchConfiguration>(defaultConfiguration)
  const [durationSeconds, setDurationSeconds] = useState('')

  // The host advertises controllers as capabilities; anything it does not name
  // can still be typed, because the backend remains authoritative on validity.
  const controllers = useMemo(
    () =>
      meta.capabilities
        .filter((capability) => capability.startsWith('controller.'))
        .map((capability) => capability.slice('controller.'.length)),
    [meta.capabilities],
  )

  const patch = (next: Partial<MatchConfiguration>) =>
    setConfiguration((current) => ({ ...current, ...next }))

  const savePreset = () => {
    const name = window.prompt('Preset name', label.trim() || `${kind} preset`)
    if (!name) return
    update({
      presets: [
        ...config.presets,
        {
          // The seed is deliberately excluded: a preset is a setup, and reusing
          // one seed for every run of it would hide variance.
          id: `preset-${Date.now().toString(36)}`,
          label: name,
          kind,
          configuration: { ...configuration, seed: 0 },
        },
      ],
    })
  }

  const applyPreset = (presetId: string) => {
    const preset = config.presets.find((entry) => entry.id === presetId)
    if (!preset) return
    setKind(preset.kind as SessionKind)
    setConfiguration({
      ...defaultConfiguration(),
      ...(preset.configuration as Partial<MatchConfiguration>),
      seed: Math.floor(Math.random() * 100_000),
    })
    setLabel(preset.label)
  }

  const create = () => {
    const duration = Number(durationSeconds)
    store.send(
      'start-center',
      {
        type: 'create_session',
        data: {
          label: label.trim() || `${kind} ${new Date().toLocaleTimeString()}`,
          kind,
          controller:
            kind === 'replay'
              ? null
              : {
                  ...configuration,
                  duration_ns:
                    durationSeconds.trim() === '' || !Number.isFinite(duration)
                      ? null
                      : Math.round(duration * 1e9),
                },
        },
      },
      `create ${kind}`,
    )
    setActiveWorkspace(configuration.precompute ? 'replay-analysis' : 'live-ops')
  }

  const connected = meta.connection.phase === 'open'

  return (
    <div className="sc">
      <header className="sc-head">
        <h1>Start Center</h1>
        <p>
          The host is running with no session. Nothing is simulated, no world exists and no
          match has started — create one below, or open a recording.
        </p>
      </header>

      <div className="sc-columns">
        <section className="sc-panel">
          <h2>New session</h2>

          <Segmented
            value={kind}
            onChange={setKind}
            options={KINDS.map((entry) => ({
              value: entry.value,
              label: entry.label,
              title: entry.hint,
            }))}
          />
          <p className="sc-hint">{KINDS.find((entry) => entry.value === kind)?.hint}</p>

          <div className="sc-form">
            <Field label="Label" wide>
              <TextInput
                value={label}
                placeholder="Optional"
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </Field>

            {kind !== 'replay' && (
              <>
                <Field label="Blue controller">
                  <ControllerInput
                    value={configuration.blue_controller}
                    options={controllers}
                    onChange={(blue_controller) => patch({ blue_controller })}
                  />
                </Field>
                <Field label="Yellow controller">
                  <ControllerInput
                    value={configuration.yellow_controller}
                    options={controllers}
                    onChange={(yellow_controller) => patch({ yellow_controller })}
                  />
                </Field>
                <Field label="Blue robots">
                  <TextInput
                    type="number"
                    min={0}
                    max={11}
                    value={configuration.blue_robots}
                    onChange={(event) =>
                      patch({ blue_robots: Number(event.currentTarget.value) || 0 })
                    }
                  />
                </Field>
                <Field label="Yellow robots">
                  <TextInput
                    type="number"
                    min={0}
                    max={11}
                    value={configuration.yellow_robots}
                    onChange={(event) =>
                      patch({ yellow_robots: Number(event.currentTarget.value) || 0 })
                    }
                  />
                </Field>
                <Field label="Division">
                  <Select
                    value={configuration.division}
                    onChange={(event) => patch({ division: event.currentTarget.value })}
                  >
                    <option value="A">Division A</option>
                    <option value="B">Division B</option>
                  </Select>
                </Field>
                <Field label="Seed">
                  <div className="ui-row">
                    <TextInput
                      type="number"
                      value={configuration.seed}
                      onChange={(event) =>
                        patch({ seed: Number(event.currentTarget.value) || 0 })
                      }
                    />
                    <Button
                      size="sm"
                      title="Randomise"
                      onClick={() => patch({ seed: Math.floor(Math.random() * 100_000) })}
                    >
                      ⟳
                    </Button>
                  </div>
                </Field>
                <Field label="Duration (s)" hint="Empty means unlimited development mode">
                  <TextInput
                    type="number"
                    placeholder="unlimited"
                    value={durationSeconds}
                    onChange={(event) => setDurationSeconds(event.currentTarget.value)}
                  />
                </Field>
                {kind === 'batch' && (
                  <Field label="Batch count">
                    <TextInput
                      type="number"
                      min={1}
                      value={configuration.batch_count}
                      onChange={(event) =>
                        patch({ batch_count: Number(event.currentTarget.value) || 1 })
                      }
                    />
                  </Field>
                )}
              </>
            )}
          </div>

          {kind !== 'replay' && (
            <div className="sc-toggles">
              <Toggle
                checked={configuration.record}
                onChange={(record) => patch({ record })}
                label="Record to recordings/"
              />
              <Toggle
                checked={configuration.precompute}
                onChange={(precompute) => patch({ precompute })}
                label="Precompute"
                hint="Withholds field state until completion, then opens Replay Analysis at frame zero"
              />
              <Toggle
                checked={configuration.development}
                onChange={(development) => patch({ development })}
                label="Development mode"
              />
            </div>
          )}

          <div className="sc-actions">
            <Button tone="accent" size="lg" onClick={create} disabled={!connected}>
              Create session
            </Button>
            {kind !== 'replay' && (
              <Button onClick={savePreset} disabled={!connected}>
                Save as preset
              </Button>
            )}
            {!connected && (
              <span className="sc-warn">
                Not connected to a host — {meta.connection.phase}.
              </span>
            )}
            <span className="ui-dim sc-note">
              The host validates this configuration; anything it rejects comes back as a
              command error in the feed.
            </span>
          </div>
        </section>

        <section className="sc-panel">
          <h2>Presets</h2>
          {config.presets.length === 0 ? (
            <p className="sc-hint">
              None saved. Configure a session above and choose “Save as preset” to reuse it.
            </p>
          ) : (
            <div className="sc-list">
              {config.presets.map((preset) => (
                <div className="sc-preset" key={preset.id}>
                  <button className="sc-item" onClick={() => applyPreset(preset.id)}>
                    <b>{preset.label}</b>
                    <i>{preset.kind}</i>
                  </button>
                  <button
                    className="sc-preset-del"
                    title="Delete preset"
                    onClick={() =>
                      update({
                        presets: config.presets.filter((entry) => entry.id !== preset.id),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <h2>Sessions</h2>
          {meta.sessions.length === 0 ? (
            <p className="sc-hint">None yet.</p>
          ) : (
            <div className="sc-list">
              {meta.sessions.map((session) => (
                <div className="sc-preset" key={session.id}>
                  <button
                    className="sc-item"
                    onClick={() => {
                      store.setActiveSession(session.id)
                      setActiveWorkspace(
                        session.kind === 'replay' ? 'replay-analysis' : 'live-ops',
                      )
                    }}
                  >
                    <b>{session.label}</b>
                    <i>
                      {session.kind} · {session.lifecycle} ·{' '}
                      {relativeTime(session.created_at_ns / 1e6)}
                    </i>
                  </button>
                  <button
                    className="sc-preset-del"
                    title="Duplicate this session with a fresh seed"
                    onClick={() =>
                      store.send(
                        'start-center',
                        {
                          type: 'create_session',
                          data: {
                            label: `${session.label} copy`,
                            kind: session.kind,
                            // The host does not republish a session's original
                            // configuration, so a duplicate re-uses whatever is
                            // currently in the form, with a fresh seed.
                            controller:
                              session.kind === 'replay'
                                ? null
                                : {
                                    ...configuration,
                                    seed: Math.floor(Math.random() * 100_000),
                                  },
                          },
                        },
                        `duplicate ${session.label}`,
                      )
                    }
                  >
                    ⧉
                  </button>
                </div>
              ))}
            </div>
          )}

          <h2>Controllers</h2>
          {controllers.length === 0 ? (
            <p className="sc-hint">
              The host advertises no <code>controller.*</code> capabilities, so controller
              names are free text and validated server-side.
            </p>
          ) : (
            <div className="sc-chips">
              {controllers.map((controller) => (
                <span className="sc-chip" key={controller}>
                  {controller}
                </span>
              ))}
            </div>
          )}

          <h2>Systems</h2>
          {meta.systems.length === 0 ? (
            <p className="sc-hint">No systems registered.</p>
          ) : (
            <div className="sc-chips">
              {meta.systems.map((system) => (
                <span className="sc-chip" key={system.id} title={system.kind}>
                  {system.label}
                </span>
              ))}
            </div>
          )}

          <div className="sc-links">
            <Button size="sm" onClick={() => openPanel('diagnostics')}>
              Protocol diagnostics
            </Button>
            <Button size="sm" onClick={() => openPanel('settings')}>
              Settings
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}

function ControllerInput({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const listId = `controllers-${options.length}`
  return (
    <>
      <TextInput
        list={listId}
        value={value}
        placeholder="e.g. bangka"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  )
}
