// The AI Lab: browse a host-published registry of skills and plays, configure
// one, and run it against the live simulation.
//
// Loading and starting are deliberately separate. A registry entry keeps state
// once it is instantiated — an async skill parks on a condition and resumes on
// the next tick — so editing a parameter must never silently restart it. The
// panel therefore sends nothing while the operator types: `Load` arms a
// configuration, `Start` instantiates it exactly once, and the host reports
// what actually happened through `developer.runs`.

import { useMemo, useState } from 'react'
import { SchemaRenderer, type RendererSchema, type RendererValues } from '@faabs/schema-renderer'

import type { DeveloperCommand, DeveloperRun, DeveloperRunState, WorldState } from '../protocol/types'
import { useMeta, usePrimaryWorld, useStore } from '../store/hooks'
import { Button, Disclosure, Empty, Field, Select, StatusDot, Toggle } from '../ui/primitives'
import { canMutate } from '../util/systems'
import {
  findSelection,
  firstSelection,
  registrySchema,
  robotOptions,
  runActions,
  sectionValues,
  singular,
  type LabSchema,
  type MatchControls,
  type Selection,
} from './aiLab'
import './ai-lab.css'

interface DeveloperResult {
  target: string
  entry: string | null
  ok: boolean
  message: string
}

/** What the host publishes under `properties.developer`. */
interface DeveloperProperty {
  schema?: LabSchema
  results?: Record<string, DeveloperResult>
  runs?: Record<string, DeveloperRun>
}

export function AiLabPanel() {
  const store = useStore()
  const meta = useMeta()
  const world = usePrimaryWorld()
  const mutable = canMutate(meta)

  const developer = store.getSnapshotProperties()['developer'] as DeveloperProperty | null
  const schema = developer?.schema ?? null
  const controls = schema?.matchControls

  const systemId = useMemo(() => {
    const advertised = meta.systems.find((system) =>
      system.capabilities.some((capability) => capability.id.startsWith('simhark.developer')),
    )
    return advertised?.id ?? meta.systems.find((system) => system.kind === 'simhark')?.id ?? null
  }, [meta.systems])

  const send = (command: DeveloperCommand, summary: string) => {
    if (!systemId) return
    store.send(
      'ai-lab',
      {
        type: 'system',
        data: { system_id: systemId, command: { type: 'developer', data: command } },
      },
      summary,
    )
  }

  if (!systemId || !schema) {
    return (
      <Empty
        title="No AI Lab available"
        hint="The host publishes its registry once a controller that exposes one is running."
      />
    )
  }

  const labSchema = registrySchema(schema)

  return (
    <div className="ui-scroll lab">
      {controls && (
        <Disclosure title="Dev match" defaultOpen={!labSchema}>
          <MatchControlsForm controls={controls} mutable={mutable} send={send} />
        </Disclosure>
      )}

      {labSchema ? (
        <Registry
          schema={labSchema}
          runs={developer?.runs ?? {}}
          results={developer?.results ?? {}}
          world={world}
          mutable={mutable}
          send={send}
        />
      ) : (
        <Empty
          title="No registry on this target"
          hint="Select a controller that exposes one — Dehumanized in Dev match — then come back."
        />
      )}

      {!mutable && (
        <div className="lab-note">
          The viewer is detached from the live head, so the host will reject these commands.
        </div>
      )}
    </div>
  )
}

function Registry({
  schema,
  runs,
  results,
  world,
  mutable,
  send,
}: {
  schema: RendererSchema
  runs: Record<string, DeveloperRun>
  results: Record<string, DeveloperResult>
  world: WorldState | null
  mutable: boolean
  send: (command: DeveloperCommand, summary: string) => void
}) {
  const [modeId, setModeId] = useState(schema.initialModeId ?? schema.modes?.[0]?.id ?? '')
  const [tabId, setTabId] = useState(schema.initialTabId ?? schema.tabs[0]?.id ?? '')
  const [values, setValues] = useState<RendererValues>({})
  const [selection, setSelection] = useState<Selection | null>(() => firstSelection(schema, tabId))

  const robots = useMemo(() => robotOptions(world, modeId), [world, modeId])
  const run = runs[modeId] ?? null
  const state: DeveloperRunState = run?.state ?? 'idle'
  const running = state === 'running'

  // Only what the host actually holds may be started, so the buttons follow
  // the published run rather than the form.
  const loadedEntry = run?.entry ?? null
  const selectedEntry = selection?.entry.id ?? null
  const stale = loadedEntry !== null && selectedEntry !== null && loadedEntry !== selectedEntry
  const actions = runActions({ state, hasSelection: selection !== null, stale, mutable })

  const load = () => {
    if (!selection || !modeId) return
    send(
      {
        type: 'load',
        data: {
          target: modeId,
          kind: singular(selection.kind),
          entry: selection.entry.id,
          config: sectionValues(selection.form, 'config', values),
          params: sectionValues(selection.form, 'params', values),
        },
      },
      `load ${selection.entry.id} on ${modeId}`,
    )
  }

  return (
    <div className="lab-registry">
      <SchemaRenderer
        schema={schema}
        values={values}
        onValuesChange={setValues}
        modeId={modeId}
        onModeChange={setModeId}
        tabId={tabId}
        onTabChange={(nextTab) => {
          setTabId(nextTab)
          setSelection(firstSelection(schema, nextTab))
        }}
        onRegistryEntryChange={(registryId, entryId) =>
          setSelection(findSelection(schema, registryId, entryId))
        }
        robots={robots}
        density="compact"
        theme="simhark"
        // A run owns its configuration: the fields are frozen until it ends so
        // the form cannot drift away from what is actually executing.
        disabled={running || !mutable}
        className="lab-schema"
        classNames={{ footer: 'lab-footer-slot' }}
        renderFooter={() => (
          <div className="lab-footer">
            <RunStatus
              run={run}
              result={results[modeId] ?? null}
              state={state}
              stale={stale}
            />
            <div className="lab-actions">
              <Button
                size="sm"
                disabled={!actions.load}
                onClick={load}
                title="Validate this configuration on the host without running it"
              >
                Load
              </Button>
              <Button
                tone="accent"
                size="sm"
                disabled={!actions.start}
                onClick={() => send({ type: 'start', data: { target: modeId } }, `start ${modeId}`)}
                title={
                  state === 'idle'
                    ? 'Load an entry before starting it'
                    : 'Instantiate the loaded entry once and run it'
                }
              >
                Start
              </Button>
              <Button
                tone="warn"
                size="sm"
                disabled={!actions.stop}
                onClick={() => send({ type: 'stop', data: { target: modeId } }, `stop ${modeId}`)}
              >
                Stop
              </Button>
              <Button
                tone="danger"
                size="sm"
                disabled={!actions.release}
                onClick={() =>
                  send({ type: 'disable', data: { target: modeId } }, `release ${modeId}`)
                }
                title="Forget the entry and hand the side back to its match AI"
              >
                Release
              </Button>
            </div>
          </div>
        )}
      />
    </div>
  )
}

function RunStatus({
  run,
  result,
  state,
  stale,
}: {
  run: DeveloperRun | null
  result: DeveloperResult | null
  state: DeveloperRunState
  stale: boolean
}) {
  // A command is acknowledged as soon as the simulator has queued it, so the
  // acknowledgement in the command feed says nothing about whether the entry
  // was accepted. The host's own result does, and a rejection has to be shown
  // here rather than only in the feed.
  const rejected = result?.ok === false
  const tone = rejected
    ? 'error'
    : state === 'running'
      ? 'ok'
      : state === 'failed'
        ? 'error'
        : state === 'idle'
          ? 'idle'
          : 'warn'
  const frames =
    run?.started_frame != null
      ? `frame ${run.started_frame}${run.finished_frame != null ? `–${run.finished_frame}` : '+'}`
      : null

  const message = rejected
    ? result.message
    : stale
      ? 'The selected entry differs from the loaded one — load it again.'
      : run?.message

  return (
    <div className={`lab-status lab-status--${rejected ? 'failed' : state}`}>
      <StatusDot tone={tone} />
      <span className="lab-status-state">{STATE_LABEL[state]}</span>
      <span className="lab-status-message" title={message}>
        {message}
      </span>
      {frames && <span className="ui-mono lab-status-frames">{frames}</span>}
    </div>
  )
}

const STATE_LABEL: Record<DeveloperRunState, string> = {
  idle: 'Idle',
  loaded: 'Loaded',
  running: 'Running',
  finished: 'Finished',
  stopped: 'Stopped',
  failed: 'Failed',
}

function MatchControlsForm({
  controls,
  mutable,
  send,
}: {
  controls: MatchControls
  mutable: boolean
  send: (command: DeveloperCommand, summary: string) => void
}) {
  const choices = controls.availableAis ?? []
  return (
    <div className="lab-match">
      {(['blue', 'yellow'] as const).map((team) => {
        const current = team === 'blue' ? controls.blueAi : controls.yellowAi
        return (
          <Field key={team} label={`${team} AI`} wide>
            <Select
              value={current ?? ''}
              disabled={!mutable || !current || choices.length === 0}
              onChange={(event) =>
                send(
                  { type: 'switch_ai', data: { target: team, ai: event.currentTarget.value } },
                  `switch ${team} → ${event.currentTarget.value}`,
                )
              }
            >
              {!current && <option value="">No active AI</option>}
              {choices.map((ai) => (
                <option key={ai.id} value={ai.id}>
                  {ai.label}
                </option>
              ))}
            </Select>
          </Field>
        )
      })}
      <Toggle
        checked={controls.teleportBallOnNoProgress ?? false}
        disabled={!mutable}
        onChange={(enabled) =>
          send(
            { type: 'set_ball_recovery', data: { target: 'ball-recovery', enabled } },
            `ball recovery ${enabled ? 'on' : 'off'}`,
          )
        }
        label="Recover a stalled ball"
        hint="Teleports the ball to the centre after sustained no progress"
      />
    </div>
  )
}
