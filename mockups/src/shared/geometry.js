// SSL Division B field geometry, all values in millimetres.
// Canonical frame per the rebuild plan: origin at field centre, +X right,
// +Y up, orientation zero along +X, positive rotation counter-clockwise.

export const FIELD = {
  length: 9000,
  width: 6000,
  boundary: 300,
  goalWidth: 1000,
  goalDepth: 180,
  defenseDepth: 1000, // along X
  defenseWidth: 2000, // along Y
  centerCircleRadius: 500,
  lineThickness: 10,
  robotRadius: 90,
  robotFrontOffset: 75, // flat front chord, measured from robot centre
  ballRadius: 45, // exaggerated from the real 21.5 mm so it reads at this scale
}

export const VIEWBOX = [
  -(FIELD.length / 2 + FIELD.boundary),
  -(FIELD.width / 2 + FIELD.boundary),
  FIELD.length + FIELD.boundary * 2,
  FIELD.width + FIELD.boundary * 2,
].join(' ')

// SVG has +Y pointing down, the field frame has +Y up. Negate on the way in
// rather than flipping the group, so text and rotations stay readable.
export const sy = (yMm) => -yMm

// Field radians (CCW positive) -> SVG degrees (CW positive).
export const svgDeg = (rad) => -(rad * 180) / Math.PI

// Outline of an SSL robot: a circle with the front flattened into a chord.
export function robotPath(r = FIELD.robotRadius, front = FIELD.robotFrontOffset) {
  const half = Math.sqrt(r * r - front * front)
  return `M ${front} ${-half} A ${r} ${r} 0 1 1 ${front} ${half} Z`
}

// Defense area rectangle for the side defending the given X sign.
export function defenseArea(sign) {
  const x = sign > 0 ? FIELD.length / 2 - FIELD.defenseDepth : -FIELD.length / 2
  return {
    x,
    y: sy(FIELD.defenseWidth / 2),
    w: FIELD.defenseDepth,
    h: FIELD.defenseWidth,
  }
}

export function goalArea(sign) {
  const x = sign > 0 ? FIELD.length / 2 : -FIELD.length / 2 - FIELD.goalDepth
  return {
    x,
    y: sy(FIELD.goalWidth / 2),
    w: FIELD.goalDepth,
    h: FIELD.goalWidth,
  }
}

// Small helper for arrowheads and velocity vectors.
export function vectorEnd(x, y, vx, vy, scale) {
  return [x + vx * scale, y + vy * scale]
}
