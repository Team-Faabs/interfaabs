import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { DEFAULT_FIELD_GEOMETRY } from '../protocol/types'
import { visibleLayerIds } from './build'
import {
  clampScale,
  fieldExtent,
  fitTo,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Viewport,
} from './viewport'

const WIDTH = 1200
const HEIGHT = 700

function viewport(overrides: Partial<Viewport> = {}): Viewport {
  return { centerX: 0, centerY: 0, scale: 0.08, mirrorX: false, mirrorY: false, ...overrides }
}

describe('viewport transform', () => {
  it('round-trips world to screen and back', () => {
    for (const mirrorX of [false, true]) {
      for (const mirrorY of [false, true]) {
        const view = viewport({ mirrorX, mirrorY, centerX: 300, centerY: -120 })
        const [px, py] = worldToScreen(view, WIDTH, HEIGHT, -1234.5, 678.25)
        const [x, y] = screenToWorld(view, WIDTH, HEIGHT, px, py)
        assert.ok(Math.abs(x - -1234.5) < 1e-6, `x round trip with ${mirrorX}/${mirrorY}`)
        assert.ok(Math.abs(y - 678.25) < 1e-6, `y round trip with ${mirrorX}/${mirrorY}`)
      }
    }
  })

  it('puts +Y up and +X right on screen', () => {
    const view = viewport()
    const [, aboveY] = worldToScreen(view, WIDTH, HEIGHT, 0, 1000)
    const [, belowY] = worldToScreen(view, WIDTH, HEIGHT, 0, -1000)
    const [rightX] = worldToScreen(view, WIDTH, HEIGHT, 1000, 0)
    const [leftX] = worldToScreen(view, WIDTH, HEIGHT, -1000, 0)

    assert.ok(aboveY < belowY, 'positive Y must be higher on screen')
    assert.ok(rightX > leftX, 'positive X must be further right')
  })

  it('mirroring flips the viewport without touching the coordinates', () => {
    const plain = viewport()
    const flipped = viewport({ mirrorX: true })
    const point = { x: 1500, y: 400 }

    const [plainX] = worldToScreen(plain, WIDTH, HEIGHT, point.x, point.y)
    const [flippedX] = worldToScreen(flipped, WIDTH, HEIGHT, point.x, point.y)

    assert.ok(Math.abs(plainX - WIDTH / 2 - (WIDTH / 2 - flippedX)) < 1e-6)
    // The input is unchanged — mirroring is display-only.
    assert.equal(point.x, 1500)
    assert.equal(point.y, 400)
  })

  it('keeps the anchored world point under the cursor while zooming', () => {
    const view = viewport()
    const anchorX = 840
    const anchorY = 210
    const [beforeX, beforeY] = screenToWorld(view, WIDTH, HEIGHT, anchorX, anchorY)
    const zoomed = zoomAt(view, WIDTH, HEIGHT, anchorX, anchorY, 1.8)
    const [afterX, afterY] = screenToWorld(zoomed, WIDTH, HEIGHT, anchorX, anchorY)

    assert.ok(Math.abs(afterX - beforeX) < 1e-6)
    assert.ok(Math.abs(afterY - beforeY) < 1e-6)
    assert.ok(zoomed.scale > view.scale)
  })

  it('pans by whole pixels in the direction of the drag', () => {
    const view = viewport()
    const panned = panBy(view, 100, 0)
    const [x] = worldToScreen(panned, WIDTH, HEIGHT, 0, 0)
    const [before] = worldToScreen(view, WIDTH, HEIGHT, 0, 0)

    assert.ok(Math.abs(x - (before + 100)) < 1e-6)
  })

  it('fits the whole field inside the viewport', () => {
    const extent = fieldExtent(DEFAULT_FIELD_GEOMETRY)
    const fitted = { ...viewport(), ...fitTo(extent, WIDTH, HEIGHT, 16) }

    const [leftX, topY] = worldToScreen(fitted, WIDTH, HEIGHT, extent.minX, extent.maxY)
    const [rightX, bottomY] = worldToScreen(fitted, WIDTH, HEIGHT, extent.maxX, extent.minY)

    assert.ok(leftX >= 0 && rightX <= WIDTH, 'field fits horizontally')
    assert.ok(topY >= 0 && bottomY <= HEIGHT, 'field fits vertically')
  })

  it('clamps absurd zoom levels', () => {
    assert.ok(clampScale(1e9) < 2)
    assert.ok(clampScale(0) > 0)
  })
})

describe('debug layer visibility', () => {
  const layers = [
    { id: 'play', parent_id: null, label: 'Play', default_visible: true },
    { id: 'play.target', parent_id: 'play', label: 'Target', default_visible: true },
    { id: 'play.lanes', parent_id: 'play', label: 'Lanes', default_visible: true },
    { id: 'world', parent_id: null, label: 'World', default_visible: true },
  ]

  it('shows everything by default', () => {
    const visible = visibleLayerIds(layers, [], null)
    assert.equal(visible.size, 4)
  })

  it('hides descendants of a hidden parent', () => {
    const visible = visibleLayerIds(layers, ['play'], null)
    assert.deepEqual([...visible], ['world'])
  })

  it('solo keeps only that layer and its descendants', () => {
    const visible = visibleLayerIds(layers, [], 'play')
    assert.deepEqual([...visible].sort(), ['play', 'play.lanes', 'play.target'])
  })

  it('survives a parent cycle without hanging', () => {
    const cyclic = [
      { id: 'a', parent_id: 'b', label: 'A', default_visible: true },
      { id: 'b', parent_id: 'a', label: 'B', default_visible: true },
    ]
    const visible = visibleLayerIds(cyclic, [], null)
    assert.equal(visible.size, 2)
  })
})
