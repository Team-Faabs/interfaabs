// Uniform-grid spatial index for field picking.
//
// A single focused field holds only ~23 pickable entities, where a linear scan
// would do. The grid earns its keep in the multi-world grid view, where every
// visible tile contributes its own entities and the cursor must resolve
// against all of them without a per-frame O(n) sweep.

import type { Pickable } from './build'

const DEFAULT_CELL_MM = 500

export class PickIndex {
  private cells = new Map<number, Pickable[]>()
  private maxRadius = 0

  constructor(
    items: Pickable[],
    private readonly cellMm = DEFAULT_CELL_MM,
  ) {
    for (const item of items) {
      this.maxRadius = Math.max(this.maxRadius, item.radiusMm)
      const key = this.key(item.x, item.y)
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(item)
      else this.cells.set(key, [item])
    }
  }

  private key(x: number, y: number): number {
    // Pack the cell coordinates into one number; fields are far smaller than
    // the 2^16 cells this allows for in each axis.
    const cx = Math.floor(x / this.cellMm) + 32768
    const cy = Math.floor(y / this.cellMm) + 32768
    return cx * 65536 + cy
  }

  /**
   * Nearest entity whose disc contains the point, grown by `toleranceMm` so
   * small targets stay clickable when zoomed out.
   */
  pick(x: number, y: number, toleranceMm = 0): Pickable | null {
    const reach = this.maxRadius + toleranceMm
    const span = Math.ceil(reach / this.cellMm)
    let best: Pickable | null = null
    let bestDistance = Infinity

    for (let dx = -span; dx <= span; dx += 1) {
      for (let dy = -span; dy <= span; dy += 1) {
        const bucket = this.cells.get(this.key(x + dx * this.cellMm, y + dy * this.cellMm))
        if (!bucket) continue
        for (const item of bucket) {
          const distance = Math.hypot(item.x - x, item.y - y)
          if (distance > item.radiusMm + toleranceMm) continue
          if (distance < bestDistance) {
            bestDistance = distance
            best = item
          }
        }
      }
    }
    return best
  }
}
