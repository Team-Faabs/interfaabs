import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import {
  PendingOrientation,
  ROTATION_COARSE_STEP_RAD,
  ROTATION_SNAP_RAD,
  ROTATION_STEP_RAD,
  nextSnappedAngle,
  normalizeAngle,
  rotateBy,
  rotationDirection,
  rotationStepOf,
  snapAngle,
  toDegrees,
  toRadians,
} from './rotation'

const deg = toRadians

function closeTo(actual: number, expectedDegrees: number, message?: string) {
  assert.ok(
    Math.abs(normalizeAngle(actual - deg(expectedDegrees))) < 1e-9,
    message ?? `${toDegrees(actual).toFixed(4)}° ≠ ${expectedDegrees}°`,
  )
}

describe('rotation keys', () => {
  it('turns counter-clockwise on Q and the left arrow', () => {
    assert.equal(rotationDirection('KeyQ'), 1)
    assert.equal(rotationDirection('ArrowLeft'), 1)
  })

  it('turns clockwise on E and the right arrow', () => {
    assert.equal(rotationDirection('KeyE'), -1)
    assert.equal(rotationDirection('ArrowRight'), -1)
  })

  it('ignores everything else', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown']) {
      assert.equal(rotationDirection(code), 0, code)
    }
  })
})

describe('step sizes', () => {
  it('defaults to 5°, takes 25° with shift and 45° with ctrl', () => {
    assert.equal(rotationStepOf({}), ROTATION_STEP_RAD)
    assert.equal(rotationStepOf({ shiftKey: true }), ROTATION_COARSE_STEP_RAD)
    assert.equal(rotationStepOf({ ctrlKey: true }), ROTATION_SNAP_RAD)
    closeTo(ROTATION_STEP_RAD, 5)
    closeTo(ROTATION_COARSE_STEP_RAD, 25)
    closeTo(ROTATION_SNAP_RAD, 45)
  })

  it('lets ctrl win over shift, so the compass points stay reachable', () => {
    assert.equal(rotationStepOf({ ctrlKey: true, shiftKey: true }), ROTATION_SNAP_RAD)
  })
})

describe('rotateBy', () => {
  it('steps by 5° and by 25° with shift', () => {
    closeTo(rotateBy(deg(10), 1, {}), 15)
    closeTo(rotateBy(deg(10), -1, {}), 5)
    closeTo(rotateBy(deg(10), 1, { shiftKey: true }), 35)
    closeTo(rotateBy(deg(10), -1, { shiftKey: true }), -15)
  })

  it('walks to the next 45° point with ctrl rather than adding 45°', () => {
    closeTo(rotateBy(deg(40), 1, { ctrlKey: true }), 45)
    closeTo(rotateBy(deg(40), -1, { ctrlKey: true }), 0)
    closeTo(rotateBy(deg(45), 1, { ctrlKey: true }), 90)
    closeTo(rotateBy(deg(45), -1, { ctrlKey: true }), 0)
  })

  it('wraps rather than running off the end of the range', () => {
    closeTo(rotateBy(deg(178), 1, {}), -177)
    closeTo(rotateBy(deg(-178), -1, {}), 177)
    closeTo(rotateBy(deg(170), 1, { ctrlKey: true }), 180)
    closeTo(rotateBy(deg(180), 1, { ctrlKey: true }), -135)
  })

  it('is reversible: a turn each way returns to where it started', () => {
    for (const start of [0, 12.5, -90, 179]) {
      closeTo(rotateBy(rotateBy(deg(start), 1, {}), -1, {}), start)
    }
  })
})

describe('nextSnappedAngle', () => {
  it('never stalls on a point it is already on', () => {
    let angle = 0
    for (let i = 1; i <= 8; i += 1) {
      angle = nextSnappedAngle(angle, 1, ROTATION_SNAP_RAD)
      closeTo(angle, (i * 45) % 360)
    }
  })
})

describe('snapAngle', () => {
  it('lands on the nearest detent, which is what a dial drag wants', () => {
    closeTo(snapAngle(deg(43), ROTATION_SNAP_RAD), 45)
    closeTo(snapAngle(deg(21), ROTATION_SNAP_RAD), 0)
    closeTo(snapAngle(deg(13), ROTATION_STEP_RAD), 15)
    closeTo(snapAngle(deg(-37), ROTATION_COARSE_STEP_RAD), -25)
  })
})

describe('PendingOrientation', () => {
  const KEY = '0:robot:blue:3'

  it('reads the world when nothing has been asked for', () => {
    const pending = new PendingOrientation()
    assert.equal(pending.base(KEY, deg(30), 1000), deg(30))
  })

  it('keeps stepping from the request while the world lags behind', () => {
    const pending = new PendingOrientation()
    pending.set(KEY, deg(35), 1000)
    closeTo(pending.base(KEY, deg(30), 1020), 35)
  })

  it('hands back to the world once it agrees', () => {
    const pending = new PendingOrientation()
    pending.set(KEY, deg(35), 1000)
    assert.equal(pending.base(KEY, deg(35), 1020), deg(35))
  })

  it('hands back to the world when the turn goes stale', () => {
    const pending = new PendingOrientation()
    pending.set(KEY, deg(35), 1000)
    closeTo(pending.base(KEY, deg(30), 9000), 30)
  })

  it('does not carry one robot’s request onto another', () => {
    const pending = new PendingOrientation()
    pending.set(KEY, deg(35), 1000)
    closeTo(pending.base('0:robot:yellow:3', deg(30), 1020), 30)
  })
})

