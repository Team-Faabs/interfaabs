import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import type { RobotState } from '../protocol/types'
import {
  DEFAULT_MANUAL_COMMAND,
  describeManualCommand,
  isRotatable,
  manualCommandAction,
  milliradOf,
  moveRobotAction,
  radiansOfMillirad,
  rotateRobotAction,
  seedManualCommand,
  unsignedOrNull,
} from './robotCommand'

function robot(overrides: Partial<RobotState> = {}): RobotState {
  return {
    id: 3,
    team: 'blue',
    position: { x_mm: -1200.4, y_mm: 340.6 },
    orientation_rad: Math.PI / 2,
    velocity: { x_mm_per_s: 0, y_mm_per_s: 0, z_mm_per_s: 0 },
    angular_velocity_rad_per_s: 0,
    visible: true,
    visibility: 1,
    infrared: false,
    dribbler_enabled: false,
    task: null,
    ...overrides,
  }
}

describe('milliradOf', () => {
  it('never emits a negative, which the host would reject', () => {
    for (const radians of [-0.001, -1, -Math.PI, -Math.PI * 1.5, -12]) {
      assert.ok(milliradOf(radians) >= 0, `${radians} → ${milliradOf(radians)}`)
    }
  })

  it('folds a negative heading into the same direction', () => {
    assert.equal(milliradOf(-Math.PI / 2), Math.round(Math.PI * 1.5 * 1000))
    assert.ok(Math.abs(radiansOfMillirad(milliradOf(-Math.PI / 2)) + Math.PI / 2) < 1e-3)
  })

  it('stays inside one revolution', () => {
    const full = Math.floor(Math.PI * 2 * 1000)
    for (const radians of [0, Math.PI * 2, Math.PI * 4, -1e-12, 6.2831852]) {
      const milli = milliradOf(radians)
      assert.ok(milli >= 0 && milli <= full, `${radians} → ${milli}`)
    }
  })

  it('round-trips a positive heading', () => {
    assert.ok(Math.abs(radiansOfMillirad(milliradOf(1.234)) - 1.234) < 1e-3)
  })

  it('is 0 for a value that is not a number', () => {
    assert.equal(milliradOf(Number.NaN), 0)
  })
})

describe('unsignedOrNull', () => {
  it('keeps an empty box empty rather than sending a zero', () => {
    assert.equal(unsignedOrNull(''), null)
    assert.equal(unsignedOrNull(null), null)
  })

  it('rounds and clamps, because speeds and ids are unsigned on the wire', () => {
    assert.equal(unsignedOrNull('1500'), 1500)
    assert.equal(unsignedOrNull('12.6'), 13)
    assert.equal(unsignedOrNull('-40'), 0)
    assert.equal(unsignedOrNull('abc'), null)
  })
})

describe('seedManualCommand', () => {
  it('targets the robot and rounds its pose to whole millimetres', () => {
    const seeded = seedManualCommand(robot())
    assert.deepEqual(seeded.robot_ids, [3])
    assert.deepEqual(seeded.position, { x_mm: -1200, y_mm: 341 })
    assert.equal(seeded.orientation_millirad, Math.round((Math.PI / 2) * 1000))
  })

  it('seeds a negative heading unsigned', () => {
    const seeded = seedManualCommand(robot({ orientation_rad: -Math.PI / 2 }))
    assert.ok((seeded.orientation_millirad ?? -1) >= 0)
  })

  it('adopts the reported state when it is one, and keeps the draft otherwise', () => {
    assert.equal(seedManualCommand(robot({ task: 'STATE_GOALIE' })).state, 'STATE_GOALIE')
    assert.equal(
      seedManualCommand(robot({ task: 'TASK_KICK' }), {
        ...DEFAULT_MANUAL_COMMAND,
        state: 'STATE_STOP',
      }).state,
      'STATE_STOP',
    )
  })

  it('keeps everything else the operator has already typed', () => {
    const typed = { ...DEFAULT_MANUAL_COMMAND, kick_speed: 900, ignore_robots: [1, 2] }
    const seeded = seedManualCommand(robot(), typed)
    assert.equal(seeded.kick_speed, 900)
    assert.deepEqual(seeded.ignore_robots, [1, 2])
  })
})

describe('payloads', () => {
  it('addresses the simhark rotate command at the selected robot', () => {
    const action = rotateRobotAction(
      'sim-1',
      { kind: 'robot', worldId: 2, team: 'yellow', robotId: 5 },
      1.5,
    )
    assert.deepEqual(action, {
      type: 'system',
      data: {
        system_id: 'sim-1',
        command: {
          type: 'simhark',
          data: {
            type: 'rotate_robot',
            data: { world_id: 2, team: 'yellow', id: 5, orientation_rad: 1.5 },
          },
        },
      },
    })
  })

  it('addresses the move command the same way', () => {
    const action = moveRobotAction('sim-1', 0, 'blue', 1, { x_mm: 10, y_mm: -20 })
    assert.equal(action.type, 'system')
    assert.deepEqual(action.type === 'system' ? action.data.command : null, {
      type: 'simhark',
      data: {
        type: 'move_robot',
        data: { world_id: 0, team: 'blue', id: 1, position: { x_mm: 10, y_mm: -20 } },
      },
    })
  })

  it('wraps a manual command for CrashPilot', () => {
    const action = manualCommandAction('cp-1', DEFAULT_MANUAL_COMMAND)
    assert.deepEqual(action.type === 'system' ? action.data.command.type : null, 'crash_pilot')
  })
})

describe('describeManualCommand', () => {
  it('reads as what the operator asked for', () => {
    assert.equal(
      describeManualCommand(
        { team: 'blue', id: 3 },
        { ...DEFAULT_MANUAL_COMMAND, task: 'TASK_KICK', position: null, kick_speed: 900 },
      ),
      'B3 FREE · KICK · kick 900',
    )
  })
})

describe('isRotatable', () => {
  it('accepts a robot and rejects the ball or nothing', () => {
    assert.equal(isRotatable({ kind: 'robot', worldId: 0, team: 'blue', robotId: 2 }), true)
    assert.equal(isRotatable({ kind: 'ball', worldId: 0 }), false)
    assert.equal(isRotatable({ kind: 'robot', worldId: 0 }), false)
    assert.equal(isRotatable(null), false)
  })
})
