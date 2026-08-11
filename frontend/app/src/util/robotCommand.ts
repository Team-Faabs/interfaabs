// Everything that can be asked of one robot, in one place.
//
// Two hosts answer for a robot and they are not interchangeable: simhark owns
// where the robot *is* (placement, applied the moment it is asked for) and
// CrashPilot owns what the robot is *doing* (a manual command, sent as a whole).
// The Properties panel and the field popup both drive these, so the payload
// shapes and the feed wording live here rather than in whichever one was
// written first.

import type {
  CommandAction,
  PointMm,
  RobotManualCommand,
  RobotState,
  SystemId,
  TeamColor,
} from '../protocol/types'
import type { EntitySelection, InterfaceStore } from '../store/store'
import { shortState, teamTag } from './format'

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

export const DEFAULT_MANUAL_COMMAND: RobotManualCommand = {
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
}

// ── wire units ───────────────────────────────────────────────────────────

/**
 * Headings travel as unsigned milliradians — the robot protocol has no sign for
 * them — while the world reports them in (−π, π]. Sending the raw negative
 * would be rejected by the host as a malformed command, so the angle is folded
 * into [0, 2π) first.
 */
export function milliradOf(radians: number): number {
  if (!Number.isFinite(radians)) return 0
  const turn = Math.PI * 2
  const wrapped = ((radians % turn) + turn) % turn
  // 0…6283, so a full turn never becomes 6284 and overflows a whole revolution.
  return Math.min(Math.round(wrapped * 1000), Math.floor(turn * 1000))
}

export function radiansOfMillirad(millirad: number): number {
  return Math.atan2(Math.sin(millirad / 1000), Math.cos(millirad / 1000))
}

/** Speeds and ids are unsigned on the wire too. */
export function unsignedOrNull(value: number | string | null): number | null {
  if (value === null || value === '') return null
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, parsed)
}

// ── manual command ───────────────────────────────────────────────────────

/**
 * Retargets a draft at another robot, seeding the fields that describe where it
 * already is. An empty form the operator has to retype is how a command gets
 * sent with someone else's position in it.
 */
export function seedManualCommand(
  robot: RobotState,
  current: RobotManualCommand = DEFAULT_MANUAL_COMMAND,
): RobotManualCommand {
  return {
    ...current,
    robot_ids: [robot.id],
    position: {
      x_mm: Math.round(robot.position.x_mm),
      y_mm: Math.round(robot.position.y_mm),
    },
    orientation_millirad: milliradOf(robot.orientation_rad),
    state:
      robot.task && STATE_OPTIONS.includes(robot.task) ? robot.task : current.state,
  }
}

export function manualCommandAction(
  systemId: SystemId,
  command: RobotManualCommand,
): CommandAction {
  return {
    type: 'system',
    data: {
      system_id: systemId,
      command: {
        type: 'crash_pilot',
        data: { type: 'send_robot_command', data: command },
      },
    },
  }
}

export function describeManualCommand(
  robot: { team: TeamColor; id: number },
  command: RobotManualCommand,
): string {
  const parts = [shortState(command.state), shortState(command.task)]
  if (command.position) parts.push(`→ ${command.position.x_mm}, ${command.position.y_mm}`)
  if (command.kick_speed !== null) parts.push(`kick ${command.kick_speed}`)
  return `${teamTag(robot.team, robot.id)} ${parts.join(' · ')}`
}

export function sendManualCommand(
  store: InterfaceStore,
  panelId: string,
  systemId: SystemId,
  robot: { team: TeamColor; id: number },
  command: RobotManualCommand,
): void {
  const payload: RobotManualCommand = { ...command, robot_ids: [robot.id] }
  store.send(panelId, manualCommandAction(systemId, payload), describeManualCommand(robot, payload))
}

// ── placement ────────────────────────────────────────────────────────────

/** A robot may be turned; the ball has no heading and an empty selection none. */
export function isRotatable(
  selection: EntitySelection | null,
): selection is EntitySelection & { team: TeamColor; robotId: number } {
  return (
    selection !== null &&
    selection.kind === 'robot' &&
    selection.team !== undefined &&
    selection.robotId !== undefined
  )
}

export function rotateRobotAction(
  systemId: SystemId,
  selection: EntitySelection & { team: TeamColor; robotId: number },
  orientation: number,
): CommandAction {
  return {
    type: 'system',
    data: {
      system_id: systemId,
      command: {
        type: 'simhark',
        data: {
          type: 'rotate_robot',
          data: {
            world_id: selection.worldId,
            team: selection.team,
            id: selection.robotId,
            orientation_rad: orientation,
          },
        },
      },
    },
  }
}

export function sendRotation(
  store: InterfaceStore,
  panelId: string,
  systemId: SystemId,
  selection: EntitySelection,
  orientation: number,
): void {
  if (!isRotatable(selection)) return
  store.send(
    panelId,
    rotateRobotAction(systemId, selection, orientation),
    `rotate ${teamTag(selection.team, selection.robotId)} → ${((orientation * 180) / Math.PI).toFixed(1)}°`,
  )
}

export function moveRobotAction(
  systemId: SystemId,
  worldId: number,
  team: TeamColor,
  id: number,
  position: PointMm,
): CommandAction {
  return {
    type: 'system',
    data: {
      system_id: systemId,
      command: {
        type: 'simhark',
        data: { type: 'move_robot', data: { world_id: worldId, team, id, position } },
      },
    },
  }
}

export function moveBallAction(
  systemId: SystemId,
  worldId: number,
  position: PointMm,
): CommandAction {
  return {
    type: 'system',
    data: {
      system_id: systemId,
      command: {
        type: 'simhark',
        data: { type: 'move_ball', data: { world_id: worldId, position } },
      },
    },
  }
}

export function setRobotPresentAction(
  systemId: SystemId,
  worldId: number,
  team: TeamColor,
  id: number,
  present: boolean,
): CommandAction {
  return {
    type: 'system',
    data: {
      system_id: systemId,
      command: {
        type: 'simhark',
        data: { type: 'set_robot_present', data: { world_id: worldId, team, id, present } },
      },
    },
  }
}

/** Moves whichever entity the selection names. Coordinates are rounded to mm. */
export function sendMove(
  store: InterfaceStore,
  panelId: string,
  systemId: SystemId,
  selection: EntitySelection,
  x: number,
  y: number,
): void {
  const position = { x_mm: Math.round(x), y_mm: Math.round(y) }
  if (selection.kind === 'ball') {
    store.send(
      panelId,
      moveBallAction(systemId, selection.worldId, position),
      `move ball → ${position.x_mm}, ${position.y_mm}`,
    )
    return
  }
  if (selection.team === undefined || selection.robotId === undefined) return
  store.send(
    panelId,
    moveRobotAction(systemId, selection.worldId, selection.team, selection.robotId, position),
    `move ${teamTag(selection.team, selection.robotId)} → ${position.x_mm}, ${position.y_mm}`,
  )
}

/**
 * Key repeat, dial drags and typed boxes all produce far more values than are
 * worth sending: every one is a round trip and a line in the command feed.
 *
 * A leading throttle sends the first immediately — so the robot answers the
 * keystroke — and then at most one per interval, always including the last. A
 * trailing one waits for the operator to stop, which is what a typed box wants:
 * typing `-1200` should not drive the robot through −1 and −120 on the way.
 */
export class CommandThrottle {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: (() => void) | null = null
  private lastAt = 0

  constructor(
    private readonly intervalMs = 70,
    private readonly leading = true,
  ) {}

  run(send: () => void): void {
    const now = Date.now()
    const wait = this.leading ? this.intervalMs - (now - this.lastAt) : this.intervalMs
    if (this.leading && wait <= 0) {
      this.lastAt = now
      send()
      return
    }
    this.pending = send
    // A trailing throttle restarts its wait on every call, so it fires once the
    // operator stops rather than part-way through what they are typing.
    if (this.timer !== null) {
      if (this.leading) return
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      const queued = this.pending
      this.pending = null
      if (!queued) return
      this.lastAt = Date.now()
      queued()
    }, wait)
  }

  /** Sends whatever is queued now, so a released key or box commits at once. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const queued = this.pending
    this.pending = null
    if (!queued) return
    this.lastAt = Date.now()
    queued()
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}

export function sendSetPresent(
  store: InterfaceStore,
  panelId: string,
  systemId: SystemId,
  worldId: number,
  team: TeamColor,
  id: number,
  present: boolean,
): void {
  store.send(
    panelId,
    setRobotPresentAction(systemId, worldId, team, id, present),
    `${present ? 'place' : 'remove'} ${teamTag(team, id)}`,
  )
}
