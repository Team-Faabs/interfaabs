// Turns canonical protocol state into a scene. Pure, synchronous and free of
// any drawing API, so it can be unit-tested and reused by a future backend.

import type { FieldSettings } from '../config/types'
import type {
  DebugItem,
  DebugLayer,
  DebugStyle,
  FieldGeometry,
  RobotState,
  WorldState,
} from '../protocol/types'
import type { EntitySelection } from '../store/store'
import type { FieldPalette } from '../theme/themes'
import { LayerBuilder, type Primitive, type Scene, type SceneLayer } from './scene'
import { fieldExtent } from './viewport'

/** Seconds of velocity drawn as the vector's length. */
const VELOCITY_LOOKAHEAD_S = 0.35
/** The real ball is 21.5 mm across, which is a sub-pixel dot at match zoom. */
const MIN_BALL_DRAW_RADIUS_MM = 42
const LOW_CONFIDENCE = 0.92
/** Front chord as a fraction of the body radius, from the SSL rules envelope. */
const FRONT_RATIO = 75 / 90

/**
 * A pose the operator is proposing with the pointer. It is not world state and
 * never will be: it exists between pointer-down and the command the drag emits,
 * so the field answers the drag immediately instead of waiting for the host to
 * echo the move back.
 */
export interface DragGhost {
  kind: 'move' | 'rotate'
  target: EntitySelection
  /** The proposed pose. */
  x: number
  y: number
  orientation: number
  /** The pose the world still reports, which the ghost was dragged away from. */
  fromX: number
  fromY: number
  fromOrientation: number
}

export interface BuildInput {
  world: WorldState
  debugItems: DebugItem[]
  debugLayers: DebugLayer[]
  settings: FieldSettings
  palette: FieldPalette
  selection: EntitySelection | null
  /** Desaturated, non-interactive presentation for detached viewer cursors. */
  review: boolean
  trail: Array<[number, number]>
  /** Entity under the pointer, ringed so the drag target is never a surprise. */
  hover?: EntitySelection | null
  /** Live drag preview. Only ever set for the world that owns the target. */
  ghost?: DragGhost | null
}

export function buildScene(input: BuildInput): Scene {
  const { world, settings, palette } = input
  const geometry = world.field

  const layers: SceneLayer[] = [
    buildFieldLayer(geometry, palette, settings).build(),
    ...buildDebugLayers(input),
    buildBallLayer(input).build(),
    buildRobotLayer(input).build(),
    ...buildInteractionLayer(input),
  ]
  if (settings.showCoordinateHints) layers.push(buildHintLayer(geometry, palette).build())

  layers.sort((a, b) => a.z - b.z)
  return { layers, background: palette.boundary, extent: fieldExtent(geometry) }
}

// ── field geometry ───────────────────────────────────────────────────────

function buildFieldLayer(
  geometry: FieldGeometry,
  palette: FieldPalette,
  settings: FieldSettings,
): LayerBuilder {
  const builder = new LayerBuilder('field', 0, 1, true)
  const halfLength = geometry.field_length_mm / 2
  const halfWidth = geometry.field_width_mm / 2
  const lineWidth = Math.max(geometry.line_thickness_mm, 10)

  builder.add({
    k: 'rect',
    x: -halfLength - geometry.boundary_width_mm,
    y: -halfWidth - geometry.boundary_width_mm,
    wMm: geometry.field_length_mm + geometry.boundary_width_mm * 2,
    hMm: geometry.field_width_mm + geometry.boundary_width_mm * 2,
    fill: palette.boundary,
  })
  builder.add({
    k: 'rect',
    x: -halfLength,
    y: -halfWidth,
    wMm: geometry.field_length_mm,
    hMm: geometry.field_width_mm,
    fill: palette.pitch,
  })

  if (settings.showFieldGrid) {
    for (let x = -halfLength; x <= halfLength + 1; x += 1000) {
      builder.add({
        k: 'polyline',
        points: [x, -halfWidth, x, halfWidth],
        closed: false,
        stroke: palette.grid,
        widthMm: 6,
      })
    }
    for (let y = -halfWidth; y <= halfWidth + 1; y += 1000) {
      builder.add({
        k: 'polyline',
        points: [-halfLength, y, halfLength, y],
        closed: false,
        stroke: palette.grid,
        widthMm: 6,
      })
    }
  }

  const line = { stroke: palette.line, widthMm: lineWidth * 2 }
  builder.add({
    k: 'rect',
    x: -halfLength,
    y: -halfWidth,
    wMm: geometry.field_length_mm,
    hMm: geometry.field_width_mm,
    ...line,
  })
  builder.add({
    k: 'polyline',
    points: [0, -halfWidth, 0, halfWidth],
    closed: false,
    ...line,
  })
  builder.add({ k: 'circle', x: 0, y: 0, rMm: geometry.center_circle_radius_mm, ...line })
  builder.add({ k: 'circle', x: 0, y: 0, rMm: lineWidth * 2.4, fill: palette.line })

  for (const sign of [-1, 1] as const) {
    builder.add({
      k: 'rect',
      x:
        sign > 0
          ? halfLength - geometry.penalty_area_depth_mm
          : -halfLength,
      y: -geometry.penalty_area_width_mm / 2,
      wMm: geometry.penalty_area_depth_mm,
      hMm: geometry.penalty_area_width_mm,
      ...line,
    })
    builder.add({
      k: 'rect',
      x: sign > 0 ? halfLength : -halfLength - geometry.goal_depth_mm,
      y: -geometry.goal_width_mm / 2,
      wMm: geometry.goal_depth_mm,
      hMm: geometry.goal_width_mm,
      stroke: settings.showGoalHighlights
        ? sign < 0
          ? palette.blue
          : palette.yellow
        : palette.line,
      widthMm: lineWidth * 2.6,
    })
  }

  // Everything the field layer draws is a function of these, so the offscreen
  // tile survives across frames and is only re-rasterised when one changes.
  builder.cacheKey = JSON.stringify([
    geometry,
    palette.pitch,
    palette.boundary,
    palette.line,
    palette.grid,
    palette.blue,
    palette.yellow,
    settings.showFieldGrid,
    settings.showGoalHighlights,
  ])

  return builder
}

// ── debug ────────────────────────────────────────────────────────────────

/**
 * A layer is drawn when it is not hidden, no ancestor is hidden, and — when a
 * solo layer is set — it is that layer or one of its descendants.
 */
export function visibleLayerIds(
  layers: DebugLayer[],
  hidden: string[],
  solo: string | null,
): Set<string> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  const hiddenSet = new Set(hidden)

  const ancestors = (id: string): string[] => {
    const chain: string[] = []
    let current = byId.get(id)?.parent_id ?? null
    const guard = new Set<string>()
    while (current && !guard.has(current)) {
      guard.add(current)
      chain.push(current)
      current = byId.get(current)?.parent_id ?? null
    }
    return chain
  }

  const visible = new Set<string>()
  for (const layer of layers) {
    const chain = ancestors(layer.id)
    if (hiddenSet.has(layer.id) || chain.some((id) => hiddenSet.has(id))) continue
    if (solo && layer.id !== solo && !chain.includes(solo)) continue
    if (!layer.default_visible && !solo && !hiddenSet.has(layer.id)) {
      // `default_visible: false` means off until the operator turns it on;
      // turning it on is recorded as removing it from `hidden`, so an id that
      // was never touched stays off.
      if (!hiddenSet.has(`!${layer.id}`)) continue
    }
    visible.add(layer.id)
  }
  return visible
}

function buildDebugLayers(input: BuildInput): SceneLayer[] {
  const { debugItems, debugLayers, settings, palette } = input
  if (!settings.showDebugOverlays || debugItems.length === 0) return []

  const visible = visibleLayerIds(debugLayers, settings.hiddenLayerIds, settings.soloLayerId)
  const heat = new LayerBuilder('debug-heatmaps', 10, settings.layerOpacity)
  const shapes = new LayerBuilder('debug-shapes', 20, settings.layerOpacity)
  const labels = new LayerBuilder('debug-labels', 55, settings.layerOpacity)

  for (const item of debugItems) {
    if (!visible.has(item.layer_id)) continue
    const primitive = item.primitive
    if (primitive.type === 'heatmap') {
      if (!settings.showHeatmaps) continue
      const data = primitive.data
      heat.add({
        k: 'heatmap',
        id: item.id,
        x: data.origin.x_mm,
        y: data.origin.y_mm,
        cellWMm: data.cell_width_mm,
        cellHMm: data.cell_height_mm,
        columns: data.columns,
        rows: data.rows,
        values: data.values,
        min: data.min,
        max: data.max,
        color: palette.heat,
      })
      continue
    }
    appendDebugPrimitive(shapes, labels, item, palette, settings)
  }

  return [heat.build(), shapes.build(), labels.build()].filter(
    (layer) => layer.primitives.length > 0,
  )
}

function styleOf(style: DebugStyle, palette: FieldPalette): {
  stroke?: string
  fill?: string
  widthMm: number
  opacity: number
} {
  return {
    stroke: style.stroke ?? palette.debug,
    fill: style.fill ?? undefined,
    widthMm: style.stroke_width_mm ?? 16,
    opacity: style.opacity,
  }
}

function appendDebugPrimitive(
  shapes: LayerBuilder,
  labels: LayerBuilder,
  item: DebugItem,
  palette: FieldPalette,
  settings: FieldSettings,
): void {
  const primitive = item.primitive
  const data = 'data' in primitive ? primitive.data : null
  if (!data) return
  const style = 'style' in data ? styleOf(data.style as DebugStyle, palette) : null
  if (!style) return

  switch (primitive.type) {
    case 'line':
      shapes.add({
        k: 'polyline',
        points: [
          primitive.data.from.x_mm,
          primitive.data.from.y_mm,
          primitive.data.to.x_mm,
          primitive.data.to.y_mm,
        ],
        closed: false,
        ...style,
      })
      break
    case 'arrow':
      shapes.add({
        k: 'arrow',
        x1: primitive.data.from.x_mm,
        y1: primitive.data.from.y_mm,
        x2: primitive.data.to.x_mm,
        y2: primitive.data.to.y_mm,
        headMm: Math.max(90, style.widthMm * 5),
        ...style,
      })
      break
    case 'polyline':
      shapes.add({
        k: 'polyline',
        points: flatten(primitive.data.points),
        closed: primitive.data.closed,
        ...style,
      })
      break
    case 'polygon':
      shapes.add({
        k: 'polyline',
        points: flatten(primitive.data.points),
        closed: true,
        ...style,
      })
      break
    case 'circle':
      shapes.add({
        k: 'circle',
        x: primitive.data.center.x_mm,
        y: primitive.data.center.y_mm,
        rMm: primitive.data.radius_mm,
        ...style,
      })
      break
    case 'ellipse':
      shapes.add({
        k: 'ellipse',
        x: primitive.data.center.x_mm,
        y: primitive.data.center.y_mm,
        rxMm: primitive.data.radius_x_mm,
        ryMm: primitive.data.radius_y_mm,
        rotation: primitive.data.rotation_rad,
        ...style,
      })
      break
    case 'rectangle':
      shapes.add({
        k: 'rect',
        x: Math.min(primitive.data.min.x_mm, primitive.data.max.x_mm),
        y: Math.min(primitive.data.min.y_mm, primitive.data.max.y_mm),
        wMm: Math.abs(primitive.data.max.x_mm - primitive.data.min.x_mm),
        hMm: Math.abs(primitive.data.max.y_mm - primitive.data.min.y_mm),
        ...style,
      })
      break
    case 'arc':
    case 'sector':
      shapes.add({
        k: 'arc',
        x: primitive.data.center.x_mm,
        y: primitive.data.center.y_mm,
        rMm: primitive.data.radius_mm,
        start: primitive.data.start_rad,
        end: primitive.data.end_rad,
        sector: primitive.type === 'sector',
        ...style,
      })
      break
    case 'capsule':
      shapes.add({
        k: 'capsule',
        x1: primitive.data.from.x_mm,
        y1: primitive.data.from.y_mm,
        x2: primitive.data.to.x_mm,
        y2: primitive.data.to.y_mm,
        rMm: primitive.data.radius_mm,
        ...style,
      })
      break
    case 'marker':
      shapes.add({
        k: 'marker',
        x: primitive.data.at.x_mm,
        y: primitive.data.at.y_mm,
        sizeMm: primitive.data.size_mm,
        ...style,
      })
      break
    case 'text':
      if (settings.showLabels) {
        labels.add({
          k: 'text',
          x: primitive.data.at.x_mm,
          y: primitive.data.at.y_mm,
          text: primitive.data.text,
          color: style.stroke ?? palette.fieldText,
          sizePx: 11,
          opacity: style.opacity,
          mono: true,
        })
      }
      break
    case 'robot_pose':
      // Holograms: the AI's predicted pose, drawn as an outline so it never
      // reads as a tracked robot.
      shapes.add({
        k: 'robot',
        x: primitive.data.at.x_mm,
        y: primitive.data.at.y_mm,
        orientation: primitive.data.orientation_rad,
        radiusMm: 90,
        frontMm: 90 * FRONT_RATIO,
        fill: 'transparent',
        ghost: true,
        stroke: primitive.data.team === 'blue' ? palette.blue : palette.yellow,
        opacity: style.opacity * 0.65,
        label: primitive.data.robot_id !== null ? String(primitive.data.robot_id) : undefined,
        labelColor: palette.fieldText,
      })
      break
  }

  const label = 'style' in data ? (data.style as DebugStyle).label : null
  if (label && settings.showLabels) {
    const anchor = primitiveAnchor(item)
    if (anchor) {
      labels.add({
        k: 'text',
        x: anchor[0],
        y: anchor[1],
        text: item.scalar !== null ? `${label} ${formatScalar(item)}` : label,
        color: palette.fieldText,
        sizePx: 10,
        mono: true,
        baseline: 'bottom',
      })
    }
  }
}

function formatScalar(item: DebugItem): string {
  if (item.scalar === null) return ''
  const value =
    Math.abs(item.scalar) >= 100 ? item.scalar.toFixed(0) : item.scalar.toFixed(2)
  return item.unit ? `${value} ${item.unit}` : value
}

function primitiveAnchor(item: DebugItem): [number, number] | null {
  const primitive = item.primitive
  if (!('data' in primitive)) return null
  const data = primitive.data as Record<string, unknown>
  for (const key of ['center', 'at', 'from', 'origin', 'min']) {
    const point = data[key] as { x_mm: number; y_mm: number } | undefined
    if (point) return [point.x_mm, point.y_mm]
  }
  const points = data.points as Array<{ x_mm: number; y_mm: number }> | undefined
  if (points?.length) return [points[0].x_mm, points[0].y_mm]
  return null
}

function flatten(points: Array<{ x_mm: number; y_mm: number }>): number[] {
  const out = new Array<number>(points.length * 2)
  for (let index = 0; index < points.length; index += 1) {
    out[index * 2] = points[index].x_mm
    out[index * 2 + 1] = points[index].y_mm
  }
  return out
}

// ── ball ─────────────────────────────────────────────────────────────────

function buildBallLayer(input: BuildInput): LayerBuilder {
  const { world, palette, settings, selection } = input
  const builder = new LayerBuilder('ball', 40)
  const ball = world.ball
  if (!ball) return builder

  const radius = Math.max(world.field.ball_radius_mm, MIN_BALL_DRAW_RADIUS_MM)
  const x = ball.position.x_mm
  const y = ball.position.y_mm

  if (settings.ballTrailFrames > 0 && input.trail.length > 1) {
    builder.add({
      k: 'polyline',
      points: input.trail.flat(),
      closed: false,
      stroke: palette.ball,
      widthMm: 12,
      opacity: 0.4,
    })
  }

  if (settings.showVelocities) {
    const vx = ball.velocity.x_mm_per_s
    const vy = ball.velocity.y_mm_per_s
    if (Math.hypot(vx, vy) > 50) {
      builder.add({
        k: 'arrow',
        x1: x,
        y1: y,
        x2: x + vx * VELOCITY_LOOKAHEAD_S,
        y2: y + vy * VELOCITY_LOOKAHEAD_S,
        headMm: 110,
        stroke: palette.ball,
        widthMm: 14,
        opacity: 0.85,
      })
    }
  }

  if (selection?.kind === 'ball' && selection.worldId === world.world_id) {
    builder.add({
      k: 'circle',
      x,
      y,
      rMm: radius + 70,
      stroke: palette.select,
      widthMm: 18,
      dashMm: [60, 40],
    })
  }

  // A soft halo under the dot. The ball is the smallest thing on the field and
  // the one the eye looks for first, so it gets a little help. Sized as a
  // multiple of the dot rather than a fixed margin, so it stays a glow when
  // zoomed in instead of growing into a smudge.
  builder.add({ k: 'circle', x, y, rMm: radius * 1.75, fill: palette.ball, opacity: 0.2 })
  builder.add({ k: 'circle', x, y, rMm: radius, fill: palette.ball })
  return builder
}

// ── robots ───────────────────────────────────────────────────────────────

function buildRobotLayer(input: BuildInput): LayerBuilder {
  const { world, palette, settings, selection, review } = input
  const builder = new LayerBuilder('robots', 50)
  const radius = world.field.max_robot_radius_mm
  const front = radius * FRONT_RATIO

  for (const robot of world.robots) {
    const dim = !robot.visible || review
    const selected =
      selection?.kind === 'robot' &&
      selection.worldId === world.world_id &&
      selection.team === robot.team &&
      selection.robotId === robot.id

    if (selected) {
      builder.add({
        k: 'circle',
        x: robot.position.x_mm,
        y: robot.position.y_mm,
        rMm: radius + 70,
        stroke: palette.select,
        widthMm: 22,
        dashMm: [60, 40],
      })
    }

    if (
      settings.showConfidence &&
      robot.visibility !== null &&
      robot.visibility < LOW_CONFIDENCE
    ) {
      builder.add({
        k: 'circle',
        x: robot.position.x_mm,
        y: robot.position.y_mm,
        rMm: radius + 34,
        stroke: palette.uncertain,
        widthMm: 12,
        dashMm: [26, 26],
      })
    }

    builder.add({
      k: 'robot',
      x: robot.position.x_mm,
      y: robot.position.y_mm,
      orientation: robot.orientation_rad,
      radiusMm: radius,
      frontMm: front,
      fill: robot.team === 'blue' ? palette.blue : palette.yellow,
      stroke: palette.robotEdge,
      opacity: dim ? 0.45 : 1,
      label: settings.showRobotIds ? String(robot.id) : undefined,
      labelColor: palette.robotLabel,
    })

    if (settings.showVelocities) appendVelocity(builder, robot, palette)

    if (!robot.visible) {
      const cross = 70
      builder.add({
        k: 'polyline',
        points: [
          robot.position.x_mm - cross,
          robot.position.y_mm - cross,
          robot.position.x_mm + cross,
          robot.position.y_mm + cross,
        ],
        closed: false,
        stroke: palette.alert,
        widthMm: 16,
      })
      builder.add({
        k: 'polyline',
        points: [
          robot.position.x_mm - cross,
          robot.position.y_mm + cross,
          robot.position.x_mm + cross,
          robot.position.y_mm - cross,
        ],
        closed: false,
        stroke: palette.alert,
        widthMm: 16,
      })
    }

    if (settings.showLabels && robot.task) {
      builder.add({
        k: 'text',
        x: robot.position.x_mm,
        y: robot.position.y_mm - radius - 40,
        text: robot.task,
        color: palette.fieldText,
        sizePx: 9,
        align: 'center',
        baseline: 'top',
        mono: true,
        opacity: dim ? 0.5 : 0.9,
      })
    }
  }

  return builder
}

function appendVelocity(
  builder: LayerBuilder,
  robot: RobotState,
  palette: FieldPalette,
): void {
  const vx = robot.velocity.x_mm_per_s
  const vy = robot.velocity.y_mm_per_s
  if (Math.hypot(vx, vy) < 30) return
  builder.add({
    k: 'polyline',
    points: [
      robot.position.x_mm,
      robot.position.y_mm,
      robot.position.x_mm + vx * VELOCITY_LOOKAHEAD_S,
      robot.position.y_mm + vy * VELOCITY_LOOKAHEAD_S,
    ],
    closed: false,
    stroke: palette.velocity,
    widthMm: 14,
  })
}

// ── interaction ──────────────────────────────────────────────────────────

/**
 * Hover and drag feedback, in its own layer above the robots. Neither the world
 * layers nor the picking geometry has to know a pointer exists, and an idle
 * field pays nothing: with no hover and no drag the layer is dropped entirely.
 */
function buildInteractionLayer(input: BuildInput): SceneLayer[] {
  const { world, palette, ghost, hover, selection } = input
  const builder = new LayerBuilder('interaction', 56)

  if (hover && hover.worldId === world.world_id && !sameEntity(hover, selection)) {
    const at = poseOf(world, hover)
    if (at) {
      builder.add({
        k: 'circle',
        x: at.x,
        y: at.y,
        rMm: entityRadius(world, hover) + 55,
        stroke: palette.select,
        widthMm: 14,
        opacity: 0.34,
      })
    }
  }

  if (ghost && ghost.target.worldId === world.world_id) appendGhost(builder, input, ghost)

  const layer = builder.build()
  return layer.primitives.length > 0 ? [layer] : []
}

function appendGhost(builder: LayerBuilder, input: BuildInput, ghost: DragGhost): void {
  const { world, palette } = input
  const radius = world.field.max_robot_radius_mm
  const tint =
    ghost.target.kind === 'ball'
      ? palette.ball
      : ghost.target.team === 'blue'
        ? palette.blue
        : palette.yellow

  if (ghost.kind === 'rotate') {
    const delta = normalizeAngle(ghost.orientation - ghost.fromOrientation)
    const ring = radius + 110
    // The arc is always drawn as the short way round, so a small correction
    // never flashes up as a 350° sweep.
    builder.add({
      k: 'arc',
      x: ghost.fromX,
      y: ghost.fromY,
      rMm: ring,
      start: ghost.fromOrientation + Math.min(0, delta),
      end: ghost.fromOrientation + Math.max(0, delta),
      sector: false,
      stroke: palette.select,
      widthMm: 16,
      opacity: 0.5,
    })
    builder.add({
      k: 'arrow',
      x1: ghost.fromX,
      y1: ghost.fromY,
      x2: ghost.fromX + Math.cos(ghost.orientation) * (ring + 90),
      y2: ghost.fromY + Math.sin(ghost.orientation) * (ring + 90),
      headMm: 90,
      stroke: tint,
      widthMm: 14,
      opacity: 0.85,
    })
    builder.add(ghostRobot(ghost.fromX, ghost.fromY, ghost.orientation, radius, tint, ghost))
    builder.add({
      k: 'text',
      x: ghost.fromX,
      y: ghost.fromY + ring + 130,
      text: `${((delta * 180) / Math.PI).toFixed(0)}°`,
      color: palette.fieldText,
      sizePx: 11,
      align: 'center',
      baseline: 'bottom',
      mono: true,
    })
    return
  }

  const reach = Math.hypot(ghost.x - ghost.fromX, ghost.y - ghost.fromY)
  if (reach > radius * 0.4) {
    builder.add({
      k: 'polyline',
      points: [ghost.fromX, ghost.fromY, ghost.x, ghost.y],
      closed: false,
      stroke: palette.select,
      widthMm: 12,
      dashMm: [90, 70],
      opacity: 0.45,
    })
  }

  if (ghost.target.kind === 'ball') {
    const ballRadius = Math.max(world.field.ball_radius_mm, MIN_BALL_DRAW_RADIUS_MM)
    builder.add({ k: 'circle', x: ghost.x, y: ghost.y, rMm: ballRadius, fill: tint, opacity: 0.4 })
    builder.add({
      k: 'circle',
      x: ghost.x,
      y: ghost.y,
      rMm: ballRadius + 50,
      stroke: tint,
      widthMm: 14,
      dashMm: [55, 45],
      opacity: 0.9,
    })
  } else {
    builder.add(ghostRobot(ghost.x, ghost.y, ghost.orientation, radius, tint, ghost))
  }

  builder.add({
    k: 'text',
    x: ghost.x,
    y: ghost.y + entityRadius(world, ghost.target) + 70,
    text: `${(ghost.x / 1000).toFixed(2)}, ${(ghost.y / 1000).toFixed(2)} m`,
    color: palette.fieldText,
    sizePx: 10.5,
    align: 'center',
    baseline: 'bottom',
    mono: true,
  })
}

function ghostRobot(
  x: number,
  y: number,
  orientation: number,
  radius: number,
  tint: string,
  ghost: DragGhost,
): Primitive {
  return {
    k: 'robot',
    x,
    y,
    orientation,
    radiusMm: radius,
    frontMm: radius * FRONT_RATIO,
    fill: 'transparent',
    ghost: true,
    stroke: tint,
    opacity: 0.95,
    label: ghost.target.robotId !== undefined ? String(ghost.target.robotId) : undefined,
    labelColor: tint,
  }
}

/** Pose of a selected entity in the world it belongs to, if it is still there. */
export function poseOf(
  world: WorldState,
  selection: EntitySelection,
): { x: number; y: number; orientation: number } | null {
  if (selection.kind === 'ball') {
    if (!world.ball) return null
    return { x: world.ball.position.x_mm, y: world.ball.position.y_mm, orientation: 0 }
  }
  const robot = world.robots.find(
    (entry) => entry.team === selection.team && entry.id === selection.robotId,
  )
  if (!robot) return null
  return {
    x: robot.position.x_mm,
    y: robot.position.y_mm,
    orientation: robot.orientation_rad,
  }
}

function entityRadius(world: WorldState, selection: EntitySelection): number {
  return selection.kind === 'ball'
    ? Math.max(world.field.ball_radius_mm, MIN_BALL_DRAW_RADIUS_MM)
    : world.field.max_robot_radius_mm
}

function sameEntity(a: EntitySelection | null, b: EntitySelection | null): boolean {
  if (!a || !b) return false
  return (
    a.kind === b.kind &&
    a.worldId === b.worldId &&
    a.team === b.team &&
    a.robotId === b.robotId
  )
}

/** To `[-π, π)`, so an angle delta is always the short way round. */
export function normalizeAngle(angle: number): number {
  return angle - Math.PI * 2 * Math.floor((angle + Math.PI) / (Math.PI * 2))
}

// ── hints ────────────────────────────────────────────────────────────────

function buildHintLayer(geometry: FieldGeometry, palette: FieldPalette): LayerBuilder {
  const builder = new LayerBuilder('hints', 60, 0.55)
  const halfLength = geometry.field_length_mm / 2
  const halfWidth = geometry.field_width_mm / 2
  builder.add({
    k: 'text',
    x: halfLength - 120,
    y: -halfWidth + 200,
    text: '+X',
    color: palette.fieldText,
    sizePx: 11,
    align: 'right',
    mono: true,
  })
  builder.add({
    k: 'text',
    // Clear of the halfway line it would otherwise sit on top of.
    x: 320,
    y: halfWidth - 160,
    text: '+Y',
    color: palette.fieldText,
    sizePx: 11,
    mono: true,
  })
  return builder
}

/** Pickable entities in world space, for hit testing. */
export interface Pickable {
  selection: EntitySelection
  x: number
  y: number
  radiusMm: number
}

export function pickablesOf(world: WorldState): Pickable[] {
  const out: Pickable[] = world.robots.map((robot) => ({
    selection: {
      kind: 'robot' as const,
      worldId: world.world_id,
      team: robot.team,
      robotId: robot.id,
    },
    x: robot.position.x_mm,
    y: robot.position.y_mm,
    radiusMm: world.field.max_robot_radius_mm,
  }))
  if (world.ball) {
    out.push({
      selection: { kind: 'ball', worldId: world.world_id },
      x: world.ball.position.x_mm,
      y: world.ball.position.y_mm,
      radiusMm: Math.max(world.field.ball_radius_mm, MIN_BALL_DRAW_RADIUS_MM),
    })
  }
  return out
}
