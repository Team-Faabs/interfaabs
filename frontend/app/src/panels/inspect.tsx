// Inspector panels: the canonical Properties panel, the robot task table, the
// referee readout and debug values.
//
// The plan folds CrashPilot's duplicated global options into one Properties
// panel; other panels link here rather than repeating the controls.

import { useEffect, useMemo, useState } from 'react'

import type {
  CrashPilotMode,
  CrashPilotOptions,
  RobotManualCommand,
  RobotState,
  TeamColor,
} from '../protocol/types'
import { useLiveTick, useMeta, usePrimaryWorld, useStore } from '../store/hooks'
import {
  Button,
  Disclosure,
  Empty,
  Field,
  Segmented,
  Select,
  StatusDot,
  TextInput,
  Toggle,
} from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import {
  formatDegrees,
  formatMm,
  formatNs,
  formatSpeed,
  shortState,
  teamTag,
} from '../util/format'
import './inspect.css'

export const STATE_OPTIONS = [
  'STATE_HALT',
  'STATE_STOP',
  'STATE_FREE',
  'STATE_GOALIE',
  'STATE_SUBSTITUTE',
]

export const TASK_OPTIONS = [
  'TASK_UNSPECIFIED',
  'TASK_POS',
  'TASK_KICK',
  'TASK_CHIP',
  'TASK_REC_KICK',
  'TASK_STEAL',
  'TASK_DRIBBLE',
  'TASK_PosBall',
  'TASK_BLOCK',
  'STATE_KICKOFF',
  'STATE_FREEKICK',
]

const DEFAULT_OPTIONS: CrashPilotOptions = {
  mode: 'manual',
  defends_positive_x: false,
  team: 'blue',
  enable_test_field: false,
  test_field: 0,
  tracked_ball: true,
  game_controller: false,
  running: false,
  goalkeeper_id: 0,
  max_speed_mm_per_s: 2000,
  test: '',
  test_robot_ids: [],
}

// ── properties ───────────────────────────────────────────────────────────

export function PropertiesPanel() {
  const store = useStore()
  const meta = useMeta()
  const world = usePrimaryWorld()
  const mutable = canMutate(meta)
  const crashPilotId = systemIdOfKind(meta, 'crash_pilot')

  const selected = useMemo<RobotState | null>(() => {
    if (!world || meta.selection?.kind !== 'robot') return null
    return (
      world.robots.find(
        (robot) =>
          robot.team === meta.selection?.team && robot.id === meta.selection?.robotId,
      ) ?? null
    )
  }, [world, meta.selection])

  const [draft, setDraft] = useState<RobotManualCommand>({
    robot_ids: [],
    state: 'STATE_FREE',
    task: 'TASK_POS',
    position: null,
    speed_mm_per_s: null,
    raw: false,
    in_wall: false,
    ignore_robots: [],
    orientation_millirad: null,
    kick_orientation_millirad: null,
    kick_speed: null,
    enemy_id: null,
  })

  // Retarget the draft when the selection changes, seeding position and
  // orientation from where the robot actually is — an empty form that the
  // operator has to retype is how a wrong position gets sent. Editing the same
  // robot keeps whatever they have already typed.
  useEffect(() => {
    if (!selected) return
    setDraft((current) =>
      current.robot_ids[0] === selected.id
        ? current
        : {
            ...current,
            robot_ids: [selected.id],
            position: {
              x_mm: Math.round(selected.position.x_mm),
              y_mm: Math.round(selected.position.y_mm),
            },
            orientation_millirad: Math.round(selected.orientation_rad * 1000),
            state: selected.task && STATE_OPTIONS.includes(selected.task)
              ? selected.task
              : current.state,
          },
    )
  }, [selected])

  if (!crashPilotId) {
    return (
      <Empty
        title="No CrashPilot system"
        hint="The host has not registered a CrashPilot system, so there are no robot commands or global options to show."
      />
    )
  }

  const send = () => {
    if (!selected) return
    store.send(
      'properties',
      {
        type: 'system',
        data: {
          system_id: crashPilotId,
          command: {
            type: 'crash_pilot',
            data: {
              type: 'send_robot_command',
              data: { ...draft, robot_ids: [selected.id] },
            },
          },
        },
      },
      `${teamTag(selected.team, selected.id)} ${shortState(draft.state)} · ${shortState(draft.task)}`,
    )
  }

  return (
    <div className="ins">
      {selected ? (
        <>
          <div className="ins-selection">
            <span className={`ins-chip ins-chip--${selected.team}`}>
              {teamTag(selected.team, selected.id)}
            </span>
            <div>
              <b>
                {selected.team} · robot {selected.id}
              </b>
              <i className="ui-mono">
                {formatMm(selected.position.x_mm)}, {formatMm(selected.position.y_mm)} mm ·{' '}
                {formatDegrees(selected.orientation_rad)}
                {selected.visibility !== null && ` · conf ${selected.visibility.toFixed(2)}`}
              </i>
            </div>
          </div>

          <Disclosure title="Command">
            <div className="ins-form">
              <Field label="State">
                <Select
                  value={draft.state}
                  onChange={(event) => setDraft({ ...draft, state: event.currentTarget.value })}
                >
                  {STATE_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Task">
                <Select
                  value={draft.task}
                  onChange={(event) => setDraft({ ...draft, task: event.currentTarget.value })}
                >
                  {TASK_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </Select>
              </Field>
              <Field label="X (mm)">
                <TextInput
                  type="number"
                  value={draft.position?.x_mm ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      position: {
                        x_mm: Number(event.currentTarget.value) || 0,
                        y_mm: draft.position?.y_mm ?? 0,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Y (mm)">
                <TextInput
                  type="number"
                  value={draft.position?.y_mm ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      position: {
                        x_mm: draft.position?.x_mm ?? 0,
                        y_mm: Number(event.currentTarget.value) || 0,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Speed (mm/s)">
                <TextInput
                  type="number"
                  value={draft.speed_mm_per_s ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      speed_mm_per_s: numberOrNull(event.currentTarget.value),
                    })
                  }
                />
              </Field>
              <Field label="Orientation (mrad)">
                <TextInput
                  type="number"
                  value={draft.orientation_millirad ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      orientation_millirad: numberOrNull(event.currentTarget.value),
                    })
                  }
                />
              </Field>
              <Field label="Kick orient. (mrad)">
                <TextInput
                  type="number"
                  value={draft.kick_orientation_millirad ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kick_orientation_millirad: numberOrNull(event.currentTarget.value),
                    })
                  }
                />
              </Field>
              <Field label="Kick speed">
                <TextInput
                  type="number"
                  value={draft.kick_speed ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({ ...draft, kick_speed: numberOrNull(event.currentTarget.value) })
                  }
                />
              </Field>
              <Field label="Enemy id">
                <TextInput
                  type="number"
                  value={draft.enemy_id ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({ ...draft, enemy_id: numberOrNull(event.currentTarget.value) })
                  }
                />
              </Field>
              <Field label="Ignore robots" wide hint="Comma-separated ids">
                <TextInput
                  value={draft.ignore_robots.join(', ')}
                  placeholder="—"
                  onChange={(event) =>
                    setDraft({ ...draft, ignore_robots: parseIds(event.currentTarget.value) })
                  }
                />
              </Field>
            </div>
            <div className="ins-toggles">
              <Toggle
                checked={draft.raw ?? false}
                onChange={(raw) => setDraft({ ...draft, raw })}
                label="Raw movement"
              />
              <Toggle
                checked={draft.in_wall ?? false}
                onChange={(in_wall) => setDraft({ ...draft, in_wall })}
                label="In wall"
              />
            </div>
            <div className="ins-apply">
              <code className="ui-mono">
                {shortState(draft.state)} · {shortState(draft.task)}
                {draft.position
                  ? ` → ${formatMm(draft.position.x_mm)}, ${formatMm(draft.position.y_mm)}`
                  : ''}
              </code>
              <Button tone="accent" disabled={!mutable} onClick={send} title={
                mutable ? undefined : 'Review mode — the host rejects mutations on a detached cursor'
              }>
                Send
              </Button>
            </div>
          </Disclosure>
        </>
      ) : (
        <div className="ins-noselection">
          Select a robot on the field, in the task table or in the feed to build a command.
        </div>
      )}

      <GlobalOptions systemId={crashPilotId} mutable={mutable} />
    </div>
  )
}

function GlobalOptions({ systemId, mutable }: { systemId: string; mutable: boolean }) {
  const store = useStore()
  const meta = useMeta()
  const [options, setOptions] = useState<CrashPilotOptions>(DEFAULT_OPTIONS)

  // The host is authoritative. `propertiesVersion` advances whenever a system
  // republishes different properties, so this follows changes made from another
  // browser instead of freezing on whatever was published at mount.
  useEffect(() => {
    const published = store.getSnapshotProperties()['crashpilot.options']
    if (published && typeof published === 'object') {
      setOptions((current) => ({ ...current, ...(published as Partial<CrashPilotOptions>) }))
    }
  }, [store, meta.propertiesVersion])

  const apply = (patch: Partial<CrashPilotOptions>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    store.send(
      'properties',
      {
        type: 'system',
        data: {
          system_id: systemId,
          command: { type: 'crash_pilot', data: { type: 'set_options', data: next } },
        },
      },
      `options · ${Object.keys(patch).join(', ')}`,
    )
  }

  return (
    <Disclosure title="Global options">
      <div className="ins-form">
        <Field label="Mode" wide>
          <Segmented
            size="sm"
            value={options.mode}
            onChange={(mode) => apply({ mode: mode as CrashPilotMode })}
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'game', label: 'Game' },
              { value: 'test', label: 'Test' },
            ]}
          />
        </Field>
        <Field label="Team">
          <Select
            value={options.team}
            onChange={(event) => apply({ team: event.currentTarget.value as TeamColor })}
          >
            <option value="blue">Blue</option>
            <option value="yellow">Yellow</option>
          </Select>
        </Field>
        <Field label="Field side">
          <Select
            value={options.defends_positive_x ? 'positive' : 'negative'}
            onChange={(event) =>
              apply({ defends_positive_x: event.currentTarget.value === 'positive' })
            }
          >
            <option value="negative">defends −X</option>
            <option value="positive">defends +X</option>
          </Select>
        </Field>
        <Field label="Goalkeeper">
          <TextInput
            type="number"
            value={options.goalkeeper_id}
            onChange={(event) =>
              apply({ goalkeeper_id: Number(event.currentTarget.value) || 0 })
            }
          />
        </Field>
        <Field label="Max speed (mm/s)">
          <TextInput
            type="number"
            value={options.max_speed_mm_per_s}
            onChange={(event) =>
              apply({ max_speed_mm_per_s: Number(event.currentTarget.value) || 0 })
            }
          />
        </Field>
        {options.mode === 'test' && (
          <>
            <Field label="Test" wide>
              <TextInput
                value={options.test}
                onChange={(event) => apply({ test: event.currentTarget.value })}
              />
            </Field>
            <Field label="Test robots" wide hint="Comma-separated ids">
              <TextInput
                value={options.test_robot_ids.join(', ')}
                onChange={(event) =>
                  apply({ test_robot_ids: parseIds(event.currentTarget.value) })
                }
              />
            </Field>
            <Field label="Test field">
              <TextInput
                type="number"
                value={options.test_field}
                onChange={(event) =>
                  apply({ test_field: Number(event.currentTarget.value) || 0 })
                }
              />
            </Field>
          </>
        )}
      </div>
      <div className="ins-toggles">
        <Toggle
          checked={options.tracked_ball}
          onChange={(tracked_ball) => apply({ tracked_ball })}
          label="Tracked ball"
        />
        <Toggle
          checked={options.game_controller}
          onChange={(game_controller) => apply({ game_controller })}
          label="Game controller"
        />
        <Toggle
          checked={options.enable_test_field}
          onChange={(enable_test_field) => apply({ enable_test_field })}
          label="Test field"
        />
        <Toggle
          checked={options.running}
          onChange={(running) => apply({ running })}
          label="Running"
          disabled={!mutable}
        />
      </div>
    </Disclosure>
  )
}

function numberOrNull(value: string): number | null {
  return value === '' ? null : Number(value)
}

function parseIds(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isFinite(id))
}

// ── task table ───────────────────────────────────────────────────────────

export function TasksPanel() {
  const store = useStore()
  const meta = useMeta()
  const world = usePrimaryWorld()
  useLiveTick()

  if (!world) return <Empty title="No world" hint="Nothing is being tracked yet." />

  return (
    <div className="ui-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th>Robot</th>
            <th>Task</th>
            <th>X</th>
            <th>Y</th>
            <th>θ</th>
            <th>Speed</th>
            <th>Conf</th>
            <th>IR</th>
            <th>Drib</th>
          </tr>
        </thead>
        <tbody>
          {world.robots.map((robot) => {
            const selected =
              meta.selection?.kind === 'robot' &&
              meta.selection.team === robot.team &&
              meta.selection.robotId === robot.id
            return (
              <tr
                key={`${robot.team}${robot.id}`}
                className={selected ? 'is-selected' : !robot.visible ? 'is-error' : ''}
                onClick={() =>
                  store.setSelection({
                    kind: 'robot',
                    worldId: world.world_id,
                    team: robot.team,
                    robotId: robot.id,
                  })
                }
              >
                <td className="tag">{teamTag(robot.team, robot.id)}</td>
                <td>{robot.task ? shortState(robot.task) : '—'}</td>
                <td className="num">{formatMm(robot.position.x_mm)}</td>
                <td className="num">{formatMm(robot.position.y_mm)}</td>
                <td className="num">{formatDegrees(robot.orientation_rad)}</td>
                <td className="num">
                  {formatSpeed(robot.velocity.x_mm_per_s, robot.velocity.y_mm_per_s)}
                </td>
                <td className="num">
                  {robot.visibility === null ? '—' : robot.visibility.toFixed(2)}
                </td>
                <td className="num">{robot.infrared === null ? '—' : robot.infrared ? '●' : '·'}</td>
                <td className="num">
                  {robot.dribbler_enabled === null ? '—' : robot.dribbler_enabled ? '●' : '·'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── referee ──────────────────────────────────────────────────────────────

export function RefereePanel() {
  const world = usePrimaryWorld()
  useLiveTick()
  const referee = world?.referee

  if (!referee) {
    return <Empty title="No referee state" hint="No referee packets have been received." />
  }

  return (
    <div className="ui-scroll">
      <div className="ins-refgrid">
        <Cell label="Stage" value={referee.stage ?? '—'} />
        <Cell label="Command" value={referee.command} />
        <Cell label="Next" value={referee.next_command ?? '—'} />
        <Cell label="Counter" value={String(referee.command_counter)} />
        <Cell
          label="Score"
          value={`${referee.score.blue} — ${referee.score.yellow}`}
        />
        <Cell label="Stage time left" value={formatNs(referee.stage_time_left_ns)} />
        <Cell label="Action time" value={formatNs(referee.action_time_remaining_ns)} />
        <Cell
          label="Blue half"
          value={
            referee.blue_team_on_positive_half === null
              ? '—'
              : referee.blue_team_on_positive_half
                ? '+X'
                : '−X'
          }
        />
        <Cell
          label="Placement"
          value={
            referee.designated_position
              ? `${formatMm(referee.designated_position.x_mm)}, ${formatMm(referee.designated_position.y_mm)}`
              : '—'
          }
        />
      </div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b className="ui-mono">{value}</b>
    </div>
  )
}

// ── debug values ─────────────────────────────────────────────────────────

export function DebugValuesPanel() {
  const store = useStore()
  const meta = useMeta()
  useLiveTick()
  const worldId = meta.worldIds[0]
  const items = worldId === undefined ? [] : store.getDebugItems(worldId)
  const scalars = items.filter((item) => item.scalar !== null)

  if (scalars.length === 0) {
    return (
      <Empty
        title="No debug values"
        hint="Debug items carrying a scalar value appear here with their unit and range."
      />
    )
  }

  return (
    <div className="ui-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th>Layer</th>
            <th>Item</th>
            <th>Value</th>
            <th>Range</th>
            <th>Recent</th>
          </tr>
        </thead>
        <tbody>
          {scalars.map((item) => (
            <tr key={item.id}>
              <td className="dim">{item.layer_id}</td>
              <td>{item.id}</td>
              <td className="num">
                {item.scalar?.toFixed(3)}
                {item.unit ? ` ${item.unit}` : ''}
              </td>
              <td className="num">
                {item.range ? `${item.range[0]} … ${item.range[1]}` : '—'}
              </td>
              <td>
                <Sparkline
                  values={store.getDebugSeries(item.id)}
                  range={item.range}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Recent history of a scalar debug value, drawn inline. */
function Sparkline({
  values,
  range,
}: {
  values: Array<[number, number]>
  range: [number, number] | null
}) {
  if (values.length < 2) return <span className="ui-dim">—</span>

  const numbers = values.map(([, value]) => value)
  const low = range ? range[0] : Math.min(...numbers)
  const high = range ? range[1] : Math.max(...numbers)
  const span = high - low || 1
  const width = 110
  const height = 18

  const points = numbers
    .map((value, index) => {
      const x = (index / (numbers.length - 1)) * width
      const y = height - ((value - low) / span) * height
      return `${x.toFixed(1)},${Math.max(0, Math.min(height, y)).toFixed(1)}`
    })
    .join(' ')

  return (
    <svg className="ins-spark" width={width} height={height} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function HealthIndicator({ level }: { level: string }) {
  return (
    <StatusDot
      tone={level === 'healthy' ? 'ok' : level === 'degraded' ? 'warn' : 'error'}
      title={level}
    />
  )
}
