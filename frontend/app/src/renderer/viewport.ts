// Viewport transform: pan, zoom, fit, mirror and follow.
//
// Mirroring is a property of the *viewport*, never of state. Flipping X or Y
// changes only how canonical millimetres land on screen; the world, the
// commands derived from it and the recording are untouched. Screen Y is
// inverted once as a matter of course, because the canonical frame has +Y up
// and canvas has +Y down.

import type { FieldGeometry } from '../protocol/types'

export interface Viewport {
  /** World point at the centre of the canvas, in millimetres. */
  centerX: number
  centerY: number
  /** Screen pixels per millimetre. */
  scale: number
  mirrorX: boolean
  mirrorY: boolean
}

export const MIN_SCALE = 0.004
export const MAX_SCALE = 1.5

export function initialViewport(): Viewport {
  return { centerX: 0, centerY: 0, scale: 0.06, mirrorX: false, mirrorY: false }
}

export function axisSigns(viewport: Viewport): { sx: number; sy: number } {
  return {
    sx: viewport.mirrorX ? -viewport.scale : viewport.scale,
    sy: viewport.mirrorY ? viewport.scale : -viewport.scale,
  }
}

export function worldToScreen(
  viewport: Viewport,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number] {
  const { sx, sy } = axisSigns(viewport)
  return [
    width / 2 + (x - viewport.centerX) * sx,
    height / 2 + (y - viewport.centerY) * sy,
  ]
}

export function screenToWorld(
  viewport: Viewport,
  width: number,
  height: number,
  px: number,
  py: number,
): [number, number] {
  const { sx, sy } = axisSigns(viewport)
  return [
    (px - width / 2) / sx + viewport.centerX,
    (py - height / 2) / sy + viewport.centerY,
  ]
}

export function fitTo(
  extent: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  padding = 16,
): Pick<Viewport, 'centerX' | 'centerY' | 'scale'> {
  const worldWidth = Math.max(1, extent.maxX - extent.minX)
  const worldHeight = Math.max(1, extent.maxY - extent.minY)
  const scale = Math.min(
    (width - padding * 2) / worldWidth,
    (height - padding * 2) / worldHeight,
  )
  return {
    centerX: (extent.minX + extent.maxX) / 2,
    centerY: (extent.minY + extent.maxY) / 2,
    scale: clampScale(scale),
  }
}

export function fieldExtent(geometry: FieldGeometry): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const halfLength = geometry.field_length_mm / 2 + geometry.boundary_width_mm
  const halfWidth = geometry.field_width_mm / 2 + geometry.boundary_width_mm
  return { minX: -halfLength, minY: -halfWidth, maxX: halfLength, maxY: halfWidth }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Zooms about a screen anchor, so the world point under the cursor stays put. */
export function zoomAt(
  viewport: Viewport,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  factor: number,
): Viewport {
  const [worldX, worldY] = screenToWorld(viewport, width, height, anchorX, anchorY)
  const scale = clampScale(viewport.scale * factor)
  if (scale === viewport.scale) return viewport
  const zoomed = { ...viewport, scale }
  const [afterX, afterY] = worldToScreen(zoomed, width, height, worldX, worldY)
  const { sx, sy } = axisSigns(zoomed)
  return {
    ...zoomed,
    centerX: zoomed.centerX + (afterX - anchorX) / sx,
    centerY: zoomed.centerY + (afterY - anchorY) / sy,
  }
}

export function panBy(viewport: Viewport, dxPixels: number, dyPixels: number): Viewport {
  const { sx, sy } = axisSigns(viewport)
  return {
    ...viewport,
    centerX: viewport.centerX - dxPixels / sx,
    centerY: viewport.centerY - dyPixels / sy,
  }
}
