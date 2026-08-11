// Turning a robot: the step sizes and the key mapping shared by the keyboard,
// the dial and the degree box. Pure geometry — the command that carries a new
// heading to the host lives in `util/robotCommand`.
//
// The behaviour comes from the simhark interface, whose operators expect the
// arrow keys to turn the selected robot. The three step sizes are what make it
// usable without watching the readout: 5° for nudging, Shift for 25° strides,
// and Ctrl to walk the 45° compass points, so a robot can be squared up to the
// field exactly rather than approximately.

import type { EntitySelection } from '../store/store'

const DEG = Math.PI / 180

/** Plain step. */
export const ROTATION_STEP_RAD = 5 * DEG
/** Shift step. */
export const ROTATION_COARSE_STEP_RAD = 25 * DEG
/** Ctrl walks these compass points instead of stepping. */
export const ROTATION_SNAP_RAD = 45 * DEG

export interface RotationModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** How far one keypress or one dial detent moves, given the held modifiers. */
export function rotationStepOf(modifiers: RotationModifiers): number {
  if (modifiers.ctrlKey || modifiers.metaKey) return ROTATION_SNAP_RAD
  if (modifiers.shiftKey) return ROTATION_COARSE_STEP_RAD
  return ROTATION_STEP_RAD
}

/** Wraps to (−π, π], the range the world reports orientations in. */
export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

export function toRadians(degrees: number): number {
  return degrees * DEG
}

/**
 * `1` turns counter-clockwise, `-1` clockwise, `0` for a key that does not
 * rotate. Q/E sit under the left hand while the right one drags; the arrows are
 * the same gesture for operators who came from the simhark interface.
 */
export function rotationDirection(code: string): -1 | 0 | 1 {
  if (code === 'KeyQ' || code === 'ArrowLeft') return 1
  if (code === 'KeyE' || code === 'ArrowRight') return -1
  return 0
}

/**
 * The next multiple of `step` strictly beyond `angle`. Ctrl-turning from 40°
 * lands on 45°, not on 85° — the point is to reach the compass point, and only
 * then to keep walking.
 */
export function nextSnappedAngle(angle: number, direction: number, step: number): number {
  // The epsilon keeps an angle that is already a compass point (up to float
  // error) from counting as "just short of it" and stalling on the spot.
  const index =
    direction > 0
      ? Math.floor(angle / step + 1e-9) + 1
      : Math.ceil(angle / step - 1e-9) - 1
  return normalizeAngle(index * step)
}

/** The nearest multiple of `step`, for the dial, which lands rather than walks. */
export function snapAngle(angle: number, step: number): number {
  return normalizeAngle(Math.round(angle / step) * step)
}

/** One keypress worth of rotation. */
export function rotateBy(
  orientation: number,
  direction: number,
  modifiers: RotationModifiers,
): number {
  if (modifiers.ctrlKey || modifiers.metaKey) {
    return nextSnappedAngle(orientation, direction, ROTATION_SNAP_RAD)
  }
  return normalizeAngle(orientation + direction * rotationStepOf(modifiers))
}

// ── the orientation the world has not caught up to yet ────────────────────

/** Within this, a reported orientation counts as the one that was asked for. */
const CONVERGED_RAD = 0.6 * DEG
/** After this long without a further turn, the world is believed again. */
const STALE_MS = 2000

/**
 * Holding a key repeats faster than the host can answer, so each press has to
 * build on the last one asked for rather than on the last one reported — read
 * the world instead and the robot stutters back a step. The request is only
 * trusted for as long as it plausibly has not arrived yet: once the world
 * agrees, or the operator stops turning, the world is authoritative again, so a
 * rejected command or a robot moved from elsewhere is not fought over.
 */
export class PendingOrientation {
  private entry: { key: string; orientation: number; at: number } | null = null

  set(key: string, orientation: number, now: number = Date.now()): void {
    this.entry = { key, orientation, at: now }
  }

  clear(): void {
    this.entry = null
  }

  /** What the next turn of `key` should start from, given the reported angle. */
  base(key: string, live: number, now: number = Date.now()): number {
    const entry = this.entry
    if (!entry || entry.key !== key) return live
    if (now - entry.at > STALE_MS) return live
    if (Math.abs(normalizeAngle(live - entry.orientation)) <= CONVERGED_RAD) return live
    return entry.orientation
  }
}

/** Identifies the robot a pending orientation belongs to. */
export function selectionKey(selection: EntitySelection): string {
  return `${selection.worldId}:${selection.kind}:${selection.team ?? ''}:${selection.robotId ?? ''}`
}
