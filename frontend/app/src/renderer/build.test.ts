// Scene-graph tests.
//
// These assert the renderer-independent half of the pipeline: what ends up in
// the scene, in which layer, in what order. Pixel-level Canvas screenshot
// fixtures still need a real canvas and are not covered here.

import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { DEFAULT_FIELD_SETTINGS } from '../config/defaults'
import type { FieldSettings } from '../config/types'
import { DEFAULT_FIELD_GEOMETRY } from '../protocol/types'
import type { DebugItem, DebugLayer, WorldState } from '../protocol/types'
import type { EntitySelection } from '../store/store'
import { THEMES } from '../theme/themes'
import { buildScene, pickablesOf } from './build'
import type { Primitive, Scene } from './scene'

const PALETTE = THEMES.evolved.field

function world(overrides: Partial<WorldState> = {}): WorldState {
  return {
    world_id: 0,
    frame: 120,
    simulation_time_ns: 2_000_000_000,
    field: DEFAULT_FIELD_GEOMETRY,
    ball: {
      position: { x_mm: 120, y_mm: -60, z_mm: 0 },
      velocity: { x_mm_per_s: -1850, y_mm_per_s: 640, z_mm_per_s: 0 },
      visibility: 0.94,
      source: null,
    },
    robots: [
      {
        id: 3,
        team: 'blue',
        position: { x_mm: -520, y_mm: 340 },
        orientation_rad: 0.9,
        velocity: { x_mm_per_s: 980, y_mm_per_s: 1240, z_mm_per_s: 0 },
        angular_velocity_rad_per_s: 0,
        visible: true,
        visibility: 0.99,
        infrared: null,
        dribbler_enabled: null,
        task: 'TASK_POS',
      },
      {
        id: 4,
        team: 'blue',
        position: { x_mm: -1240, y_mm: 2210 },
        orientation_rad: -0.6,
        velocity: { x_mm_per_s: 0, y_mm_per_s: 0, z_mm_per_s: 0 },
        angular_velocity_rad_per_s: 0,
        visible: false,
        visibility: 0.72,
        infrared: null,
        dribbler_enabled: null,
        task: null,
      },
      {
        id: 5,
        team: 'yellow',
        position: { x_mm: 900, y_mm: 900 },
        orientation_rad: -1.9,
        velocity: { x_mm_per_s: 180, y_mm_per_s: -620, z_mm_per_s: 0 },
        angular_velocity_rad_per_s: 0,
        visible: true,
        visibility: 0.96,
        infrared: null,
        dribbler_enabled: null,
        task: 'TASK_KICK',
      },
    ],
    referee: null,
    score: { blue: 0, yellow: 0 },
    events: [],
    ...overrides
  }
}

const LAYERS: DebugLayer[] = [
  { id: 'play', parent_id: null, label: 'Play', default_visible: true },
  { id: 'world', parent_id: null, label: 'World', default_visible: true },
]

function debugItem(overrides: Partial<DebugItem> = {}): DebugItem {
  return {
    id: 'item-1',
    layer_id: 'play',
    world_id: 0,
    robot_id: null,
    scalar: null,
    unit: null,
    range: null,
    primitive: {
      type: 'line',
      data: {
        from: { x_mm: 0, y_mm: 0 },
        to: { x_mm: 1000, y_mm: 1000 },
        style: {
          stroke: '#fff',
          fill: null,
          stroke_width_mm: 20,
          opacity: 1,
          label: null,
          tooltip: null,
        },
      },
    },
    ...overrides,
  }
}

function settings(overrides: Partial<FieldSettings> = {}): FieldSettings {
  return { ...DEFAULT_FIELD_SETTINGS, ...overrides }
}

function build(
  overrides: {
    debugItems?: DebugItem[]
    settings?: Partial<FieldSettings>
    selection?: EntitySelection | null
    review?: boolean
    world?: WorldState
  } = {},
): Scene {
  return buildScene({
    world: overrides.world ?? world(),
    debugItems: overrides.debugItems ?? [],
    debugLayers: LAYERS,
    settings: settings(overrides.settings),
    palette: PALETTE,
    selection: overrides.selection ?? null,
    review: overrides.review ?? false,
    trail: [],
  })
}

function layer(scene: Scene, id: string) {
  return scene.layers.find((entry) => entry.id === id)
}

function kinds(scene: Scene, id: string): string[] {
  return (layer(scene, id)?.primitives ?? []).map((primitive: Primitive) => primitive.k)
}

describe('scene structure', () => {
  it('draws layers back to front', () => {
    const scene = build({ debugItems: [debugItem()] })
    const order = scene.layers.map((entry) => entry.z)
    assert.deepEqual([...order].sort((a, b) => a - b), order)
  })

  it('puts the field geometry in a cacheable static layer', () => {
    const scene = build()
    const field = layer(scene, 'field')

    assert.ok(field)
    assert.equal(field.static, true)
    assert.ok(field.cacheKey, 'a static layer needs an identity to cache on')
    assert.ok(field.z < (layer(scene, 'robots')?.z ?? 0))
  })

  it('re-uses the field cache key across frames and busts it on geometry change', () => {
    const first = layer(build(), 'field')?.cacheKey
    const second = layer(build({ world: world({ frame: 999 }) }), 'field')?.cacheKey
    assert.equal(first, second, 'a new frame must not invalidate the static tile')

    const widened = world({
      field: { ...DEFAULT_FIELD_GEOMETRY, field_length_mm: 12_000 },
    })
    assert.notEqual(layer(build({ world: widened }), 'field')?.cacheKey, first)
  })

  it('reports the field extent including the boundary', () => {
    const scene = build()
    const halfLength =
      DEFAULT_FIELD_GEOMETRY.field_length_mm / 2 + DEFAULT_FIELD_GEOMETRY.boundary_width_mm
    assert.equal(scene.extent.maxX, halfLength)
    assert.equal(scene.extent.minX, -halfLength)
  })
})

describe('robots', () => {
  it('emits one robot primitive per robot', () => {
    const scene = build()
    const robots = (layer(scene, 'robots')?.primitives ?? []).filter((p) => p.k === 'robot')
    assert.equal(robots.length, 3)
  })

  it('dims an invisible robot and crosses it out', () => {
    const scene = build()
    const primitives = layer(scene, 'robots')?.primitives ?? []
    const invisible = primitives.find(
      (p): p is Extract<Primitive, { k: 'robot' }> =>
        p.k === 'robot' && p.x === -1240 && p.y === 2210,
    )
    assert.ok(invisible)
    assert.ok((invisible.opacity ?? 1) < 1, 'an untracked robot must read as untracked')
    // Two crossing strokes mark it.
    const crosses = primitives.filter((p) => p.k === 'polyline' && p.stroke === PALETTE.alert)
    assert.equal(crosses.length, 2)
  })

  it('rings a low-confidence robot only when confidence display is on', () => {
    const withRing = build().layers
    const ringed = withRing
      .flatMap((entry) => entry.primitives)
      .filter((p) => p.k === 'circle' && p.dashMm?.[0] === 26)
    assert.equal(ringed.length, 1, 'robot 4 is below the confidence threshold')

    const without = build({ settings: { showConfidence: false } })
    assert.equal(
      without.layers
        .flatMap((entry) => entry.primitives)
        .filter((p) => p.k === 'circle' && p.dashMm?.[0] === 26).length,
      0,
    )
  })

  it('marks only the selected robot', () => {
    const selection: EntitySelection = {
      kind: 'robot',
      worldId: 0,
      team: 'blue',
      robotId: 3,
    }
    const scene = build({ selection })
    const rings = (layer(scene, 'robots')?.primitives ?? []).filter(
      (p) => p.k === 'circle' && p.stroke === PALETTE.select,
    )
    assert.equal(rings.length, 1)
  })

  it('omits robot numbers and tasks when their toggles are off', () => {
    const scene = build({ settings: { showRobotIds: false, showLabels: false } })
    const primitives = layer(scene, 'robots')?.primitives ?? []
    assert.equal(
      primitives.filter((p) => p.k === 'robot' && p.label !== undefined).length,
      0,
    )
    assert.equal(primitives.filter((p) => p.k === 'text').length, 0)
  })

  it('drops velocity vectors when velocities are hidden', () => {
    const on = (layer(build(), 'robots')?.primitives ?? []).filter(
      (p) => p.k === 'polyline' && p.stroke === PALETTE.velocity,
    )
    assert.ok(on.length > 0)

    const off = (
      layer(build({ settings: { showVelocities: false } }), 'robots')?.primitives ?? []
    ).filter((p) => p.k === 'polyline' && p.stroke === PALETTE.velocity)
    assert.equal(off.length, 0)
  })
})

describe('debug overlays', () => {
  it('routes heatmaps to their own layer beneath the shapes', () => {
    const heatmap = debugItem({
      id: 'heat',
      layer_id: 'world',
      primitive: {
        type: 'heatmap',
        data: {
          origin: { x_mm: -1000, y_mm: -1000 },
          cell_width_mm: 100,
          cell_height_mm: 100,
          columns: 2,
          rows: 2,
          values: [0, 1, 0.5, 0.25],
          min: 0,
          max: 1,
          unit: null,
        },
      },
    })
    const scene = build({ debugItems: [heatmap, debugItem()] })

    assert.deepEqual(kinds(scene, 'debug-heatmaps'), ['heatmap'])
    assert.ok(
      (layer(scene, 'debug-heatmaps')?.z ?? 0) < (layer(scene, 'debug-shapes')?.z ?? 0),
    )
  })

  it('drops every debug item when overlays are switched off', () => {
    const scene = build({ debugItems: [debugItem()], settings: { showDebugOverlays: false } })
    assert.equal(layer(scene, 'debug-shapes'), undefined)
  })

  it('honours a hidden layer', () => {
    const scene = build({
      debugItems: [debugItem()],
      settings: { hiddenLayerIds: ['play'] },
    })
    assert.equal(layer(scene, 'debug-shapes'), undefined)
  })

  it('honours solo', () => {
    const scene = build({
      debugItems: [debugItem(), debugItem({ id: 'other', layer_id: 'world' })],
      settings: { soloLayerId: 'world' },
    })
    assert.equal(kinds(scene, 'debug-shapes').length, 1)
  })

  it('draws a robot pose as an outline hologram, not a tracked robot', () => {
    const hologram = debugItem({
      id: 'holo',
      primitive: {
        type: 'robot_pose',
        data: {
          at: { x_mm: 180, y_mm: 890 },
          orientation_rad: 0.74,
          team: 'blue',
          robot_id: 3,
          style: {
            stroke: null,
            fill: null,
            stroke_width_mm: null,
            opacity: 1,
            label: null,
            tooltip: null,
          },
        },
      },
    })
    const scene = build({ debugItems: [hologram] })
    const drawn = (layer(scene, 'debug-shapes')?.primitives ?? []).find(
      (p): p is Extract<Primitive, { k: 'robot' }> => p.k === 'robot',
    )

    assert.ok(drawn)
    assert.equal(drawn.fill, 'transparent', 'a hologram must not read as a solid robot')
  })

  it('applies a debug item with no world to the world being built', () => {
    const scene = build({ debugItems: [debugItem({ world_id: null })] })
    assert.equal(kinds(scene, 'debug-shapes').length, 1)
  })
})

describe('picking', () => {
  it('offers every robot and the ball', () => {
    const pickables = pickablesOf(world())
    assert.equal(pickables.length, 4)
    assert.equal(pickables.filter((entry) => entry.selection.kind === 'ball').length, 1)
  })

  it('gives the ball a clickable radius larger than its real one', () => {
    const ball = pickablesOf(world()).find((entry) => entry.selection.kind === 'ball')
    assert.ok(ball)
    assert.ok(
      ball.radiusMm > DEFAULT_FIELD_GEOMETRY.ball_radius_mm,
      'a 21.5 mm target is unclickable at match zoom',
    )
  })

  it('has no pickables for a world with no ball and no robots', () => {
    assert.deepEqual(pickablesOf(world({ ball: null, robots: [] })), [])
  })
})
