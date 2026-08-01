// Development AI switching, stalled-ball recovery, and schema/direct-drive
// activation — the `DeveloperCommand` half of the protocol.
//
// The host names its targets and available AIs through snapshot properties. No
// list is invented here: when the host publishes nothing, the fields stay free
// text and the backend remains authoritative on what is valid.

import { useMemo, useState } from 'react'

import { useMeta, useStore } from '../store/hooks'
import { Button, Disclosure, Empty, Field, Select, TextInput, Toggle } from '../ui/primitives'
import { canMutate } from '../util/systems'
import './developer.css'

export function DeveloperPanel() {
  const store = useStore()
  const meta = useMeta()
  const mutable = canMutate(meta)

  const properties = store.getSnapshotProperties()
  const targets = stringList(properties['developer.targets'])
  const ais = stringList(properties['developer.ais'])

  // Any system may accept developer commands; prefer simhark, then anything
  // that advertises a developer capability.
  const systemId = useMemo(() => {
    const advertised = meta.systems.find((system) =>
      system.capabilities.some((capability) => capability.id.startsWith('developer')),
    )
    return advertised?.id ?? meta.systems.find((s) => s.kind === 'simhark')?.id ?? null
  }, [meta.systems])

  const [target, setTarget] = useState('')
  const [ai, setAi] = useState('')
  const [recovery, setRecovery] = useState(true)
  const [entry, setEntry] = useState('')
  const [kind, setKind] = useState('schema')
  const [configText, setConfigText] = useState('')
  const [paramsText, setParamsText] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!systemId) {
    return (
      <Empty
        title="No system accepts developer commands"
        hint="AI switching, stalled-ball recovery and schema activation need a registered system. None is present."
      />
    )
  }

  const chosenTarget = target || targets[0] || ''

  const send = (
    command:
      | { type: 'switch_ai'; data: { target: string; ai: string } }
      | { type: 'set_ball_recovery'; data: { target: string; enabled: boolean } }
      | { type: 'disable'; data: { target: string } }
      | {
          type: 'activate'
          data: { target: string; kind: string; entry: string; config: unknown; params: unknown }
        },
    summary: string,
  ) => {
    store.send(
      'developer',
      {
        type: 'system',
        data: { system_id: systemId, command: { type: 'developer', data: command } },
      },
      summary,
    )
  }

  return (
    <div className="ui-scroll">
      <div className="dv-target">
        <Field label="Target" wide hint="The AI slot or subsystem the commands apply to">
          {targets.length > 0 ? (
            <Select value={chosenTarget} onChange={(event) => setTarget(event.currentTarget.value)}>
              {targets.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          ) : (
            <TextInput
              value={target}
              placeholder="e.g. blue"
              onChange={(event) => setTarget(event.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <Disclosure title="Development AI">
        <div className="dv-form">
          <Field label="AI" wide>
            {ais.length > 0 ? (
              <Select value={ai || ais[0]} onChange={(event) => setAi(event.currentTarget.value)}>
                {ais.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </Select>
            ) : (
              <TextInput
                value={ai}
                placeholder="e.g. bangka"
                onChange={(event) => setAi(event.currentTarget.value)}
              />
            )}
          </Field>
        </div>
        <div className="dv-actions">
          <Button
            tone="accent"
            size="sm"
            disabled={!mutable || chosenTarget === '' || (ai || ais[0] || '') === ''}
            onClick={() =>
              send(
                { type: 'switch_ai', data: { target: chosenTarget, ai: ai || ais[0] } },
                `switch ${chosenTarget} → ${ai || ais[0]}`,
              )
            }
          >
            Switch AI
          </Button>
          <Button
            size="sm"
            tone="danger"
            disabled={!mutable || chosenTarget === ''}
            onClick={() =>
              send({ type: 'disable', data: { target: chosenTarget } }, `disable ${chosenTarget}`)
            }
          >
            Disable
          </Button>
        </div>
      </Disclosure>

      <Disclosure title="Stalled-ball recovery">
        <div className="dv-actions dv-actions--stack">
          <Toggle
            checked={recovery}
            disabled={!mutable}
            onChange={(enabled) => {
              setRecovery(enabled)
              send(
                { type: 'set_ball_recovery', data: { target: chosenTarget, enabled } },
                `ball recovery ${enabled ? 'on' : 'off'}`,
              )
            }}
            label="Recover from a stalled ball"
            hint="Applies to the selected target"
          />
        </div>
      </Disclosure>

      <Disclosure title="Activate schema or direct drive" defaultOpen={false}>
        <div className="dv-form">
          <Field label="Kind">
            <Select value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
              <option value="schema">schema</option>
              <option value="direct-drive">direct-drive</option>
              <option value="play">play</option>
            </Select>
          </Field>
          <Field label="Entry">
            <TextInput
              value={entry}
              placeholder="entry point"
              onChange={(event) => setEntry(event.currentTarget.value)}
            />
          </Field>
          <Field label="Config (JSON)" wide>
            <TextInput
              value={configText}
              placeholder="{}"
              onChange={(event) => {
                setConfigText(event.currentTarget.value)
                setError(null)
              }}
            />
          </Field>
          <Field label="Params (JSON)" wide>
            <TextInput
              value={paramsText}
              placeholder="{}"
              onChange={(event) => {
                setParamsText(event.currentTarget.value)
                setError(null)
              }}
            />
          </Field>
        </div>
        <div className="dv-actions">
          <Button
            tone="accent"
            size="sm"
            disabled={!mutable || chosenTarget === '' || entry === ''}
            onClick={() => {
              try {
                send(
                  {
                    type: 'activate',
                    data: {
                      target: chosenTarget,
                      kind,
                      entry,
                      config: parseJson(configText),
                      params: parseJson(paramsText),
                    },
                  },
                  `activate ${kind} ${entry}`,
                )
                setError(null)
              } catch (parseError) {
                setError(parseError instanceof Error ? parseError.message : String(parseError))
              }
            }}
          >
            Activate
          </Button>
        </div>
        {error && <div className="dv-error">{error}</div>}
      </Disclosure>

      {!mutable && (
        <div className="dv-note">
          The viewer is detached from the live head, so the host will reject these commands.
        </div>
      )}
    </div>
  )
}

function parseJson(text: string): unknown {
  return text.trim() === '' ? {} : JSON.parse(text)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
