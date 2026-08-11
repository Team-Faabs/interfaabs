// The selected robot's controls, on the field itself.
//
// Everything here is also reachable from the Properties panel; this is the copy
// that is next to the robot, for the operator who is placing a scenario with a
// mouse and does not want to cross the shell to change a kick speed. It drives
// the same two hosts the panel does: simhark for placement, which applies as it
// is typed, and CrashPilot for the manual command, which is sent as a whole.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RobotManualCommand, RobotState } from '../protocol/types'
import { useLiveTick, useMeta, useStore } from '../store/hooks'
import { Button, Select, TextInput, Toggle } from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import { formatSpeed, shortState, teamTag } from '../util/format'
import {
  CommandThrottle,
  DEFAULT_MANUAL_COMMAND,
  STATE_OPTIONS,
  TASK_OPTIONS,
  isRotatable,
  milliradOf,
  radiansOfMillirad,
  seedManualCommand,
  sendManualCommand,
  sendMove,
  sendRotation,
  sendSetPresent,
  unsignedOrNull,
} from '../util/robotCommand'
import {
  PendingOrientation,
  ROTATION_COARSE_STEP_RAD,
  ROTATION_SNAP_RAD,
  ROTATION_STEP_RAD,
  normalizeAngle,
  rotateBy,
  rotationDirection,
  rotationStepOf,
  selectionKey,
  snapAngle,
  toDegrees,
  toRadians,
} from './rotation'

const DIAL_SIZE = 46

/** Which placement box the operator is typing in, if any. */
type EditField = 'x' | 'y' | 'heading'

export function RobotControl({ panelId }: { panelId: string }) {
  const store = useStore()
  const meta = useMeta()
  const tick = useLiveTick()

  const selection = meta.selection
  const simharkId = systemIdOfKind(meta, 'simhark')
  const crashPilotId = systemIdOfKind(meta, 'crash_pilot')
  const mutable = canMutate(meta)
  const key = selection ? selectionKey(selection) : ''

  const pendingRef = useRef(new PendingOrientation())
  /** Dragging and key repeat want the first value straight away… */
  const turnRef = useRef(new CommandThrottle())
  /** …a typed box wants only the finished number, not every keystroke on the
   * way to it, or `-1200` walks the robot through −1 and −120 first. */
  const typedRef = useRef(new CommandThrottle(300, false))
  useEffect(() => {
    const [turn, typed] = [turnRef.current, typedRef.current]
    return () => {
      turn.dispose()
      typed.dispose()
    }
  }, [])

  const [expanded, setExpanded] = useState(false)
  const [edit, setEdit] = useState<{ field: EditField; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState<RobotManualCommand>(DEFAULT_MANUAL_COMMAND)

  // Nothing typed for one robot may survive onto the next.
  useEffect(() => {
    pendingRef.current.clear()
    setEdit(null)
  }, [key])

  const robot = useMemo<RobotState | null>(() => {
    if (!selection || selection.kind !== 'robot') return null
    const world = store.getWorld(selection.worldId)?.world
    return (
      world?.robots.find(
        (entry) => entry.team === selection.team && entry.id === selection.robotId,
      ) ?? null
    )
    // `tick` is what makes this follow the world; it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selection, tick])

  // Retarget the command draft once per robot, keeping whatever has already
  // been typed rather than resetting it under the operator on the next frame.
  // Keyed by the selection rather than by the robot id, so blue 3 and yellow 3
  // are not the same robot.
  const seededRef = useRef('')
  useEffect(() => {
    if (!robot || seededRef.current === key) return
    seededRef.current = key
    setDraft((current) => seedManualCommand(robot, current))
  }, [key, robot])

  const canPlace = simharkId !== null && mutable && isRotatable(selection)
  const canCommand = crashPilotId !== null && mutable && robot !== null

  const orientation = pendingRef.current.base(key, robot?.orientation_rad ?? 0)

  const applyRotation = useCallback(
    (next: number, throttle: CommandThrottle = turnRef.current) => {
      if (!selection || !isRotatable(selection) || !simharkId) return
      const value = normalizeAngle(next)
      pendingRef.current.set(key, value)
      throttle.run(() => sendRotation(store, panelId, simharkId, selection, value))
    },
    [key, panelId, selection, simharkId, store],
  )

  const applyPosition = useCallback(
    (x: number, y: number) => {
      if (!selection || !simharkId) return
      typedRef.current.run(() => sendMove(store, panelId, simharkId, selection, x, y))
    },
    [panelId, selection, simharkId, store],
  )

  /** Sends the draft, optionally with a one-off change such as a quick action. */
  const sendCommand = useCallback(
    (patch: Partial<RobotManualCommand> = {}) => {
      if (!robot || !crashPilotId) return
      const next = { ...draft, ...patch }
      setDraft(next)
      sendManualCommand(store, panelId, crashPilotId, robot, next)
    },
    [crashPilotId, draft, panelId, robot, store],
  )

  // ── dial ───────────────────────────────────────────────────────────────

  const dialRef = useRef<HTMLDivElement | null>(null)

  const angleFromPointer = useCallback(
    (
      event: { clientX: number; clientY: number },
      modifiers: Parameters<typeof rotationStepOf>[0],
    ) => {
      const dial = dialRef.current
      if (!dial) return null
      const rect = dial.getBoundingClientRect()
      const dx = event.clientX - (rect.left + rect.width / 2)
      // Screen y grows downwards and headings do not, so the dial reads like a
      // compass rather than a mirror of one.
      const dy = rect.top + rect.height / 2 - event.clientY
      if (Math.hypot(dx, dy) < 4) return null
      return snapAngle(Math.atan2(dy, dx), rotationStepOf(modifiers))
    },
    [],
  )

  const onDialDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canPlace || event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      setEdit(null)
      const angle = angleFromPointer(event, event)
      if (angle !== null) applyRotation(angle)
    },
    [angleFromPointer, applyRotation, canPlace],
  )

  const onDialMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const angle = angleFromPointer(event, event)
      if (angle !== null) applyRotation(angle)
    },
    [angleFromPointer, applyRotation, dragging],
  )

  const onDialUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
    turnRef.current.flush()
  }, [])

  // The dial takes the same keys as the field, so tabbing to it does not leave
  // the operator with a control that only answers the mouse.
  const onDialKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const direction = rotationDirection(event.code)
      if (direction === 0 || !canPlace) return
      event.preventDefault()
      event.stopPropagation()
      applyRotation(rotateBy(orientation, direction, event))
    },
    [applyRotation, canPlace, orientation],
  )

  if (!robot || !selection || (!canPlace && !canCommand)) return null

  // A focused box shows what is being typed; every other box follows the world.
  const shownX = edit?.field === 'x' ? edit.text : String(Math.round(robot.position.x_mm))
  const shownY = edit?.field === 'y' ? edit.text : String(Math.round(robot.position.y_mm))
  const degrees = toDegrees(orientation)
  const shownHeading =
    edit?.field === 'heading' ? edit.text : String(Math.round(degrees * 10) / 10)

  const editPlacement = (field: EditField, text: string) => {
    setEdit({ field, text })
    const parsed = Number(text)
    if (text.trim() === '' || !Number.isFinite(parsed)) return
    if (field === 'heading') applyRotation(toRadians(parsed), typedRef.current)
    else if (field === 'x') applyPosition(parsed, robot.position.y_mm)
    else applyPosition(robot.position.x_mm, parsed)
  }

  const stopEdit = () => {
    setEdit(null)
    typedRef.current.flush()
  }

  const placementBox = (field: EditField, value: string, label: string) => (
    <label className="fc-rc-box" title={label}>
      <span>{label}</span>
      <TextInput
        type="number"
        step={field === 'heading' ? Math.round(toDegrees(ROTATION_STEP_RAD)) : 10}
        value={value}
        disabled={!canPlace}
        aria-label={label}
        onChange={(event) => editPlacement(field, event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={stopEdit}
        onKeyDown={(event) => {
          // The field's own rotation keys must not fight the caret.
          event.stopPropagation()
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )

  return (
    // The card sits inside the field, whose own pointer handlers would otherwise
    // read a click on it as the start of a pan and take the focus off the boxes.
    <div
      className={`fc-rc ${dragging ? 'is-dragging' : ''} ${expanded ? 'is-expanded' : ''}`}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="fc-rc-head">
        <b className={`fc-rc-chip fc-rc-chip--${robot.team}`}>
          {teamTag(robot.team, robot.id)}
        </b>
        <span className="fc-rc-live ui-mono" title="Speed · infrared · dribbler">
          {formatSpeed(robot.velocity.x_mm_per_s, robot.velocity.y_mm_per_s)}
          <i className={`fc-rc-led ${robot.infrared ? 'is-on' : ''}`} title="Infrared">
            ir
          </i>
          <i className={`fc-rc-led ${robot.dribbler_enabled ? 'is-on' : ''}`} title="Dribbler">
            dr
          </i>
        </span>
        <div className="fc-rc-grow" />
        {canPlace && (
          <button
            className="fc-rc-icon"
            title="Remove from field"
            onClick={() =>
              sendSetPresent(
                store,
                panelId,
                simharkId!,
                selection.worldId,
                robot.team,
                robot.id,
                false,
              )
            }
          >
            ✕
          </button>
        )}
        <button
          className="fc-rc-icon"
          title={expanded ? 'Show placement only' : 'Show all robot controls'}
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      <div className="fc-rc-place">
        <div
          ref={dialRef}
          className="fc-rc-dial"
          role="slider"
          tabIndex={0}
          aria-label={`Heading of ${teamTag(robot.team, robot.id)}`}
          aria-valuenow={Math.round(degrees)}
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuetext={`${degrees.toFixed(1)} degrees`}
          title={`Drag to turn · Shift ${Math.round(toDegrees(ROTATION_COARSE_STEP_RAD))}° · Ctrl ${Math.round(toDegrees(ROTATION_SNAP_RAD))}° · otherwise ${Math.round(toDegrees(ROTATION_STEP_RAD))}°`}
          onPointerDown={onDialDown}
          onPointerMove={onDialMove}
          onPointerUp={onDialUp}
          onPointerCancel={onDialUp}
          onKeyDown={onDialKeyDown}
        >
          <Dial orientation={orientation} />
        </div>
        <div className="fc-rc-boxes">
          {placementBox('x', shownX, 'x mm')}
          {placementBox('y', shownY, 'y mm')}
          {placementBox('heading', shownHeading, 'θ °')}
        </div>
      </div>

      {!expanded && <span className="fc-rc-hint">Q/E · ←/→ · shift 25° · ctrl 45°</span>}

      {expanded && (
        <>
          <div className="fc-rc-rule">
            <span>command</span>
          </div>

          {!canCommand ? (
            <span className="fc-rc-hint">
              No CrashPilot system, so this robot takes placement only.
            </span>
          ) : (
            <div className="fc-rc-form">
              <label className="fc-rc-box" title="State">
                <span>state</span>
                <Select
                  value={draft.state}
                  onChange={(event) => setDraft({ ...draft, state: event.currentTarget.value })}
                >
                  {STATE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {shortState(option)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="fc-rc-box" title="Task">
                <span>task</span>
                <Select
                  value={draft.task}
                  onChange={(event) => setDraft({ ...draft, task: event.currentTarget.value })}
                >
                  {TASK_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {shortState(option)}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="fc-rc-box" title="Target position, x">
                <span>to x</span>
                <TextInput
                  type="number"
                  step={10}
                  value={draft.position?.x_mm ?? ''}
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      position: {
                        x_mm: Math.round(Number(event.currentTarget.value) || 0),
                        y_mm: draft.position?.y_mm ?? 0,
                      },
                    })
                  }
                />
              </label>
              <label className="fc-rc-box" title="Target position, y">
                <span>to y</span>
                <TextInput
                  type="number"
                  step={10}
                  value={draft.position?.y_mm ?? ''}
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      position: {
                        x_mm: draft.position?.x_mm ?? 0,
                        y_mm: Math.round(Number(event.currentTarget.value) || 0),
                      },
                    })
                  }
                />
              </label>
              <button
                className="fc-rc-icon fc-rc-here"
                title="Target where the robot is now"
                onClick={() =>
                  setDraft({
                    ...draft,
                    position: {
                      x_mm: Math.round(robot.position.x_mm),
                      y_mm: Math.round(robot.position.y_mm),
                    },
                  })
                }
              >
                ⌖
              </button>

              <label className="fc-rc-box" title="Speed cap for this command">
                <span>speed</span>
                <TextInput
                  type="number"
                  min={0}
                  step={100}
                  value={draft.speed_mm_per_s ?? ''}
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      speed_mm_per_s: unsignedOrNull(event.currentTarget.value),
                    })
                  }
                />
              </label>
              <label className="fc-rc-box" title="Heading to hold while driving">
                <span>face °</span>
                <TextInput
                  type="number"
                  step={5}
                  value={
                    draft.orientation_millirad === null
                      ? ''
                      : Math.round(toDegrees(radiansOfMillirad(draft.orientation_millirad)))
                  }
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      orientation_millirad: degreesToMillirad(
                        event.currentTarget.value,
                        draft.orientation_millirad,
                      ),
                    })
                  }
                />
              </label>
              <button
                className="fc-rc-icon fc-rc-here"
                title="Face the way the robot is pointing now"
                onClick={() =>
                  setDraft({ ...draft, orientation_millirad: milliradOf(orientation) })
                }
              >
                ⌖
              </button>

              <label className="fc-rc-box" title="Direction to kick or chip in">
                <span>kick °</span>
                <TextInput
                  type="number"
                  step={5}
                  value={
                    draft.kick_orientation_millirad === null
                      ? ''
                      : Math.round(toDegrees(radiansOfMillirad(draft.kick_orientation_millirad)))
                  }
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kick_orientation_millirad: degreesToMillirad(
                        event.currentTarget.value,
                        draft.kick_orientation_millirad,
                      ),
                    })
                  }
                />
              </label>
              <label className="fc-rc-box" title="Kicker strength">
                <span>kick pw</span>
                <TextInput
                  type="number"
                  min={0}
                  value={draft.kick_speed ?? ''}
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({ ...draft, kick_speed: unsignedOrNull(event.currentTarget.value) })
                  }
                />
              </label>
              <button
                className="fc-rc-icon fc-rc-here"
                title="Kick the way the robot is pointing now"
                onClick={() =>
                  setDraft({ ...draft, kick_orientation_millirad: milliradOf(orientation) })
                }
              >
                ⌖
              </button>

              <label className="fc-rc-box" title="Enemy to block, for TASK_BLOCK">
                <span>enemy</span>
                <TextInput
                  type="number"
                  min={0}
                  value={draft.enemy_id ?? ''}
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({ ...draft, enemy_id: unsignedOrNull(event.currentTarget.value) })
                  }
                />
              </label>
              <label className="fc-rc-box fc-rc-box--wide" title="Comma-separated robot ids">
                <span>ignore</span>
                <TextInput
                  value={draft.ignore_robots.join(', ')}
                  placeholder="—"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setDraft({ ...draft, ignore_robots: parseIds(event.currentTarget.value) })
                  }
                />
              </label>

              <div className="fc-rc-toggles">
                <Toggle
                  checked={draft.raw ?? false}
                  onChange={(raw) => setDraft({ ...draft, raw })}
                  label="raw"
                  hint="Raw movement, bypassing path planning"
                />
                <Toggle
                  checked={draft.in_wall ?? false}
                  onChange={(in_wall) => setDraft({ ...draft, in_wall })}
                  label="in wall"
                />
              </div>

              {/* The kicker and the dribbler are tasks rather than switches:
                  nothing in the protocol drives those actuators directly, so
                  these ask CrashPilot for the behaviour and the LEDs above
                  report what the robot actually did. */}
              <div className="fc-rc-actions">
                <Button size="sm" onClick={() => sendCommand({ task: 'TASK_POS' })}>
                  Drive
                </Button>
                <Button size="sm" onClick={() => sendCommand({ task: 'TASK_KICK' })}>
                  Kick
                </Button>
                <Button size="sm" onClick={() => sendCommand({ task: 'TASK_CHIP' })}>
                  Chip
                </Button>
                <Button size="sm" onClick={() => sendCommand({ task: 'TASK_DRIBBLE' })}>
                  Dribble
                </Button>
                <Button size="sm" onClick={() => sendCommand({ task: 'TASK_REC_KICK' })}>
                  Receive
                </Button>
                <Button
                  size="sm"
                  tone="danger"
                  title="Halt this robot"
                  onClick={() => sendCommand({ state: 'STATE_HALT' })}
                >
                  Halt
                </Button>
                <div className="fc-rc-grow" />
                <Button size="sm" tone="accent" onClick={() => sendCommand()}>
                  Send
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Half-typed input keeps the last heading rather than snapping the box to 0. */
function degreesToMillirad(raw: string, previous: number | null): number | null {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? milliradOf(toRadians(parsed)) : previous
}

function parseIds(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isFinite(id))
}

/** Compass face: 0° points at +X, angles grow counter-clockwise. */
function Dial({ orientation }: { orientation: number }) {
  const r = DIAL_SIZE / 2
  const needle = r - 5
  return (
    <svg
      width={DIAL_SIZE}
      height={DIAL_SIZE}
      viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
      aria-hidden="true"
    >
      <circle className="fc-rc-face" cx={r} cy={r} r={r - 1.5} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const angle = (deg * Math.PI) / 180
        const outer = r - 2.5
        const inner = deg % 90 === 0 ? r - 7 : r - 5
        return (
          <line
            key={deg}
            className={deg % 90 === 0 ? 'fc-rc-tick fc-rc-tick--major' : 'fc-rc-tick'}
            x1={r + Math.cos(angle) * inner}
            y1={r - Math.sin(angle) * inner}
            x2={r + Math.cos(angle) * outer}
            y2={r - Math.sin(angle) * outer}
          />
        )
      })}
      <line
        className="fc-rc-needle"
        x1={r}
        y1={r}
        x2={r + Math.cos(orientation) * needle}
        y2={r - Math.sin(orientation) * needle}
      />
      <circle className="fc-rc-hub" cx={r} cy={r} r={2.5} />
    </svg>
  )
}
