// Canvas 2D backend — the only renderer in v4.
//
// Three things carry the performance budget:
//
//   * **Batching.** Stroked primitives that share a style are accumulated into
//     one `Path2D` and issued as a single stroke, so a field full of debug
//     lines costs a handful of context state changes instead of hundreds.
//   * **Offscreen static tiles.** A layer marked static is rasterised once into
//     a world-space tile and blitted thereafter, keyed on its `cacheKey` and a
//     zoom bucket so the tile is only redrawn when it would actually look
//     different.
//   * **Screen-space text.** Labels are drawn under the identity transform at a
//     fixed pixel size, which keeps them legible at every zoom and keeps glyph
//     rasterisation off the transformed path.

import type { Primitive, Scene, SceneLayer } from './scene'
import { axisSigns, worldToScreen, type Viewport } from './viewport'

export interface DrawStats {
  drawCalls: number
  primitives: number
  batches: number
  /** Milliseconds spent inside `render`. */
  drawMs: number
  staticTileRedraws: number
}

const MIN_STROKE_PX = 0.75
const MAX_TILE_PX = 4096
/** Static tiles are re-rasterised when zoom crosses a power-of-two bucket. */
const SCALE_BUCKETS_PER_OCTAVE = 2

interface Tile {
  canvas: HTMLCanvasElement
  pxPerMm: number
  minX: number
  minY: number
  widthMm: number
  heightMm: number
}

export class Canvas2DRenderer {
  private context: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private dpr = 1
  private staticTiles = new Map<string, Tile>()
  private heatmapTiles = new Map<string, { canvas: HTMLCanvasElement; key: string }>()

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('2D canvas context unavailable')
    this.context = context
  }

  /** Sizes the backing store for the device pixel ratio. Idempotent. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const backingWidth = Math.max(1, Math.round(cssWidth * dpr))
    const backingHeight = Math.max(1, Math.round(cssHeight * dpr))
    if (
      this.canvas.width === backingWidth &&
      this.canvas.height === backingHeight &&
      this.dpr === dpr
    ) {
      this.width = cssWidth
      this.height = cssHeight
      return
    }
    this.canvas.width = backingWidth
    this.canvas.height = backingHeight
    this.width = cssWidth
    this.height = cssHeight
    this.dpr = dpr
  }

  render(scene: Scene, viewport: Viewport): DrawStats {
    const started = performance.now()
    const stats: DrawStats = {
      drawCalls: 0,
      primitives: 0,
      batches: 0,
      drawMs: 0,
      staticTileRedraws: 0,
    }
    const context = this.context

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    context.fillStyle = scene.background
    context.fillRect(0, 0, this.width, this.height)

    for (const layer of scene.layers) {
      if (layer.primitives.length === 0) continue
      context.save()
      context.globalAlpha = layer.opacity
      if (layer.static && layer.cacheKey) {
        this.drawStaticLayer(layer, scene, viewport, stats)
      } else {
        this.drawLayer(layer, viewport, stats)
      }
      context.restore()
    }

    stats.drawMs = performance.now() - started
    return stats
  }

  // ── static tiles ───────────────────────────────────────────────────────

  private scaleBucket(scale: number): number {
    return Math.round(Math.log2(scale) * SCALE_BUCKETS_PER_OCTAVE)
  }

  private drawStaticLayer(
    layer: SceneLayer,
    scene: Scene,
    viewport: Viewport,
    stats: DrawStats,
  ): void {
    const bucket = this.scaleBucket(viewport.scale)
    const key = `${layer.cacheKey}@${bucket}`
    let tile = this.staticTiles.get(key)

    if (!tile) {
      tile = this.rasteriseTile(layer, scene, 2 ** (bucket / SCALE_BUCKETS_PER_OCTAVE))
      this.staticTiles.clear() // one live zoom bucket at a time keeps memory flat
      this.staticTiles.set(key, tile)
      stats.staticTileRedraws += 1
    }

    const context = this.context
    const { sx, sy } = axisSigns(viewport)
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    context.translate(this.width / 2, this.height / 2)
    context.scale(sx, sy)
    context.translate(-viewport.centerX, -viewport.centerY)
    context.imageSmoothingEnabled = true
    // The tile's first row is world `minY`. Under the +Y-up transform the blit
    // flips it back the right way round, and mirroring flips it again, which is
    // exactly what mirroring should do.
    context.drawImage(tile.canvas, tile.minX, tile.minY, tile.widthMm, tile.heightMm)
    stats.drawCalls += 1
    stats.primitives += layer.primitives.length
  }

  private rasteriseTile(layer: SceneLayer, scene: Scene, requestedPxPerMm: number): Tile {
    const { minX, minY, maxX, maxY } = scene.extent
    const widthMm = maxX - minX
    const heightMm = maxY - minY
    const pxPerMm = Math.min(
      requestedPxPerMm * this.dpr,
      MAX_TILE_PX / widthMm,
      MAX_TILE_PX / heightMm,
    )

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(widthMm * pxPerMm))
    canvas.height = Math.max(1, Math.ceil(heightMm * pxPerMm))
    const context = canvas.getContext('2d')
    if (context) {
      // World -> tile with +Y downwards, undone by the blit.
      context.setTransform(pxPerMm, 0, 0, pxPerMm, -minX * pxPerMm, -minY * pxPerMm)
      const tileViewport: Viewport = {
        centerX: 0,
        centerY: 0,
        scale: pxPerMm,
        mirrorX: false,
        mirrorY: false,
      }
      drawPrimitives(context, layer.primitives, tileViewport, pxPerMm, null, {
        drawCalls: 0,
        primitives: 0,
        batches: 0,
        drawMs: 0,
        staticTileRedraws: 0,
      })
    }

    return { canvas, pxPerMm, minX, minY, widthMm, heightMm }
  }

  // ── dynamic layers ─────────────────────────────────────────────────────

  private drawLayer(layer: SceneLayer, viewport: Viewport, stats: DrawStats): void {
    const context = this.context
    const { sx, sy } = axisSigns(viewport)
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    context.translate(this.width / 2, this.height / 2)
    context.scale(sx, sy)
    context.translate(-viewport.centerX, -viewport.centerY)

    drawPrimitives(context, layer.primitives, viewport, viewport.scale, this, stats)

    // Text and glyph-sized labels go back to identity so they neither mirror
    // nor scale with zoom.
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    for (const primitive of layer.primitives) {
      if (primitive.k === 'text') {
        this.drawText(primitive, viewport)
        stats.drawCalls += 1
      } else if (primitive.k === 'robot' && primitive.label) {
        this.drawRobotLabel(primitive, viewport)
        stats.drawCalls += 1
      }
    }
  }

  private drawText(
    primitive: Extract<Primitive, { k: 'text' }>,
    viewport: Viewport,
  ): void {
    const context = this.context
    const [px, py] = worldToScreen(viewport, this.width, this.height, primitive.x, primitive.y)
    context.save()
    context.globalAlpha *= primitive.opacity ?? 1
    context.fillStyle = primitive.color
    context.font = `${primitive.sizePx}px ${
      primitive.mono ? 'ui-monospace, monospace' : 'Inter, system-ui, sans-serif'
    }`
    context.textAlign = primitive.align ?? 'left'
    context.textBaseline = primitive.baseline ?? 'alphabetic'
    context.fillText(primitive.text, px, py)
    context.restore()
  }

  private drawRobotLabel(
    primitive: Extract<Primitive, { k: 'robot' }>,
    viewport: Viewport,
  ): void {
    const context = this.context
    const [px, py] = worldToScreen(viewport, this.width, this.height, primitive.x, primitive.y)
    const radiusPx = primitive.radiusMm * viewport.scale
    const size = Math.max(7, Math.min(20, radiusPx * 0.95))
    if (size < 7.5) return // below this the digit is noise, not information
    context.save()
    context.globalAlpha *= primitive.opacity ?? 1
    context.fillStyle = primitive.labelColor ?? '#000'
    context.font = `700 ${size}px ui-monospace, monospace`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(primitive.label ?? '', px, py)
    context.restore()
  }

  /** Rasterised heatmap tiles, keyed by item id and value identity. */
  heatmapTile(
    primitive: Extract<Primitive, { k: 'heatmap' }>,
  ): HTMLCanvasElement | null {
    const key = `${primitive.columns}x${primitive.rows}:${primitive.min}:${primitive.max}:${
      primitive.values.length
    }:${primitive.values[0] ?? 0}:${primitive.values[primitive.values.length - 1] ?? 0}`
    const cached = this.heatmapTiles.get(primitive.id)
    if (cached && cached.key === key) return cached.canvas

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, primitive.columns)
    canvas.height = Math.max(1, primitive.rows)
    const context = canvas.getContext('2d')
    if (!context) return null

    const image = context.createImageData(canvas.width, canvas.height)
    const [r, g, b] = parseColor(primitive.color)
    const span = primitive.max - primitive.min || 1
    for (let row = 0; row < primitive.rows; row += 1) {
      for (let column = 0; column < primitive.columns; column += 1) {
        const value = primitive.values[row * primitive.columns + column] ?? primitive.min
        const t = Math.max(0, Math.min(1, (value - primitive.min) / span))
        const offset = (row * primitive.columns + column) * 4
        image.data[offset] = r
        image.data[offset + 1] = g
        image.data[offset + 2] = b
        image.data[offset + 3] = Math.round(t * 255)
      }
    }
    context.putImageData(image, 0, 0)
    this.heatmapTiles.set(primitive.id, { canvas, key })
    return canvas
  }

  dispose(): void {
    this.staticTiles.clear()
    this.heatmapTiles.clear()
  }
}

// ── primitive drawing, shared by the main context and tile rasterisation ──

interface Batch {
  path: Path2D
  stroke?: string
  fill?: string
  lineWidth: number
  dash: number[]
  opacity: number
}

function styleKey(
  stroke: string | undefined,
  fill: string | undefined,
  lineWidth: number,
  dash: number[],
  opacity: number,
): string {
  return `${stroke ?? '-'}|${fill ?? '-'}|${lineWidth.toFixed(2)}|${dash.join(',')}|${opacity.toFixed(2)}`
}

function drawPrimitives(
  context: CanvasRenderingContext2D,
  primitives: Primitive[],
  viewport: Viewport,
  pxPerMm: number,
  renderer: Canvas2DRenderer | null,
  stats: DrawStats,
): void {
  const batches = new Map<string, Batch>()

  const batchFor = (
    stroke: string | undefined,
    fill: string | undefined,
    widthMm: number | undefined,
    dashMm: number[] | undefined,
    opacity: number | undefined,
  ): Batch => {
    const lineWidth = Math.max(MIN_STROKE_PX / pxPerMm, (widthMm ?? 16) / 1)
    const dash = (dashMm ?? []).slice()
    const alpha = opacity ?? 1
    const key = styleKey(stroke, fill, lineWidth, dash, alpha)
    let batch = batches.get(key)
    if (!batch) {
      batch = { path: new Path2D(), stroke, fill, lineWidth, dash, opacity: alpha }
      batches.set(key, batch)
      stats.batches += 1
    }
    return batch
  }

  for (const primitive of primitives) {
    stats.primitives += 1
    switch (primitive.k) {
      case 'polyline': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        const points = primitive.points
        if (points.length < 4) break
        batch.path.moveTo(points[0], points[1])
        for (let index = 2; index < points.length; index += 2) {
          batch.path.lineTo(points[index], points[index + 1])
        }
        if (primitive.closed) batch.path.closePath()
        break
      }

      case 'circle': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        batch.path.moveTo(primitive.x + primitive.rMm, primitive.y)
        batch.path.arc(primitive.x, primitive.y, primitive.rMm, 0, Math.PI * 2)
        break
      }

      case 'ellipse': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        batch.path.ellipse(
          primitive.x,
          primitive.y,
          primitive.rxMm,
          primitive.ryMm,
          primitive.rotation,
          0,
          Math.PI * 2,
        )
        break
      }

      case 'rect': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        batch.path.rect(primitive.x, primitive.y, primitive.wMm, primitive.hMm)
        break
      }

      case 'arc': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        if (primitive.sector) batch.path.moveTo(primitive.x, primitive.y)
        batch.path.arc(
          primitive.x,
          primitive.y,
          primitive.rMm,
          primitive.start,
          primitive.end,
        )
        if (primitive.sector) batch.path.closePath()
        break
      }

      case 'capsule': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        appendCapsule(batch.path, primitive)
        break
      }

      case 'marker': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        const half = primitive.sizeMm / 2
        batch.path.moveTo(primitive.x - half, primitive.y - half)
        batch.path.lineTo(primitive.x + half, primitive.y + half)
        batch.path.moveTo(primitive.x - half, primitive.y + half)
        batch.path.lineTo(primitive.x + half, primitive.y - half)
        break
      }

      case 'arrow': {
        const batch = batchFor(
          primitive.stroke,
          primitive.fill,
          primitive.widthMm,
          primitive.dashMm,
          primitive.opacity,
        )
        appendArrow(batch.path, primitive)
        break
      }

      case 'robot': {
        // Robots are drawn individually: each has its own fill, and the flat
        // front means the path is orientation-dependent anyway.
        context.save()
        context.globalAlpha *= primitive.opacity ?? 1
        context.translate(primitive.x, primitive.y)
        context.rotate(primitive.orientation)
        const path = robotPath(primitive.radiusMm, primitive.frontMm)
        if (primitive.fill !== 'transparent') {
          context.fillStyle = primitive.fill
          context.fill(path)
        }
        context.strokeStyle = primitive.stroke
        context.lineWidth = Math.max(MIN_STROKE_PX / pxPerMm, 10)
        if (primitive.fill === 'transparent') context.setLineDash([70, 50])
        context.stroke(path)
        context.restore()
        stats.drawCalls += 2
        break
      }

      case 'heatmap': {
        const tile = renderer?.heatmapTile(primitive)
        if (!tile) break
        context.save()
        context.globalAlpha *= primitive.opacity ?? 0.75
        context.imageSmoothingEnabled = true
        context.drawImage(
          tile,
          primitive.x,
          primitive.y,
          primitive.cellWMm * primitive.columns,
          primitive.cellHMm * primitive.rows,
        )
        context.restore()
        stats.drawCalls += 1
        break
      }

      case 'text':
        // Drawn separately, in screen space.
        break
    }
  }

  for (const batch of batches.values()) {
    context.save()
    context.globalAlpha *= batch.opacity
    if (batch.fill) {
      context.fillStyle = batch.fill
      context.fill(batch.path)
      stats.drawCalls += 1
    }
    if (batch.stroke) {
      context.strokeStyle = batch.stroke
      context.lineWidth = batch.lineWidth
      context.lineJoin = 'round'
      context.lineCap = 'round'
      if (batch.dash.length > 0) context.setLineDash(batch.dash)
      context.stroke(batch.path)
      stats.drawCalls += 1
    }
    context.restore()
  }
  void viewport
}

/** An SSL robot: a circle with the front flattened into a chord. */
function robotPath(radius: number, front: number): Path2D {
  const path = new Path2D()
  const half = Math.sqrt(Math.max(0, radius * radius - front * front))
  path.moveTo(front, -half)
  path.arc(0, 0, radius, -Math.atan2(half, front) + Math.PI * 2, Math.atan2(half, front))
  path.closePath()
  return path
}

function appendCapsule(
  path: Path2D,
  primitive: Extract<Primitive, { k: 'capsule' }>,
): void {
  const dx = primitive.x2 - primitive.x1
  const dy = primitive.y2 - primitive.y1
  const angle = Math.atan2(dy, dx)
  const normal = angle + Math.PI / 2
  const r = primitive.rMm
  path.moveTo(primitive.x1 + Math.cos(normal) * r, primitive.y1 + Math.sin(normal) * r)
  path.lineTo(primitive.x2 + Math.cos(normal) * r, primitive.y2 + Math.sin(normal) * r)
  path.arc(primitive.x2, primitive.y2, r, normal, normal + Math.PI, false)
  path.lineTo(primitive.x1 - Math.cos(normal) * r, primitive.y1 - Math.sin(normal) * r)
  path.arc(primitive.x1, primitive.y1, r, normal + Math.PI, normal, false)
  path.closePath()
}

function appendArrow(path: Path2D, primitive: Extract<Primitive, { k: 'arrow' }>): void {
  path.moveTo(primitive.x1, primitive.y1)
  path.lineTo(primitive.x2, primitive.y2)
  const angle = Math.atan2(primitive.y2 - primitive.y1, primitive.x2 - primitive.x1)
  const head = primitive.headMm
  const spread = Math.PI / 7
  path.moveTo(primitive.x2, primitive.y2)
  path.lineTo(
    primitive.x2 - Math.cos(angle - spread) * head,
    primitive.y2 - Math.sin(angle - spread) * head,
  )
  path.moveTo(primitive.x2, primitive.y2)
  path.lineTo(
    primitive.x2 - Math.cos(angle + spread) * head,
    primitive.y2 - Math.sin(angle + spread) * head,
  )
}

function parseColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((character) => character + character)
            .join('')
        : hex
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ]
  }
  const match = color.match(/rgba?\(([^)]+)\)/)
  if (match) {
    const parts = match[1].split(',').map((part) => Number.parseFloat(part))
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
  }
  return [255, 95, 109]
}

/**
 * One-shot render into a caller-supplied canvas. This is the entry point the
 * deterministic screenshot fixtures use, so they never depend on React,
 * animation frames or device pixel ratio.
 */
export function renderSceneToCanvas(
  canvas: HTMLCanvasElement,
  scene: Scene,
  viewport: Viewport,
  width: number,
  height: number,
): DrawStats {
  const renderer = new Canvas2DRenderer(canvas)
  renderer.resize(width, height, 1)
  const stats = renderer.render(scene, viewport)
  renderer.dispose()
  return stats
}
