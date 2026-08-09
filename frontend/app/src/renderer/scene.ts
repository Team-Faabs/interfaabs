// Renderer-independent scene graph.
//
// Nothing here knows about Canvas, WebGL or WebGPU. A scene is a flat list of
// layers, each a flat list of primitives in canonical field coordinates
// (millimetres, +X right, +Y up, origin at field centre). The Canvas 2D
// backend is the only consumer in v4; keeping the graph free of drawing calls
// is what preserves the option of adding another backend later without paying
// for two production renderers now.

export interface Style {
  stroke?: string
  fill?: string
  /** Stroke width in millimetres. */
  widthMm?: number
  /** Dash pattern in millimetres. */
  dashMm?: number[]
  opacity?: number
}

export type Primitive =
  | ({ k: 'polyline'; points: number[]; closed: boolean } & Style)
  | ({ k: 'circle'; x: number; y: number; rMm: number } & Style)
  | ({
      k: 'ellipse'
      x: number
      y: number
      rxMm: number
      ryMm: number
      rotation: number
    } & Style)
  | ({ k: 'rect'; x: number; y: number; wMm: number; hMm: number } & Style)
  | ({
      k: 'arc'
      x: number
      y: number
      rMm: number
      start: number
      end: number
      sector: boolean
    } & Style)
  | ({
      k: 'capsule'
      x1: number
      y1: number
      x2: number
      y2: number
      rMm: number
    } & Style)
  | ({
      k: 'arrow'
      x1: number
      y1: number
      x2: number
      y2: number
      headMm: number
    } & Style)
  | ({ k: 'marker'; x: number; y: number; sizeMm: number } & Style)
  | {
      k: 'text'
      x: number
      y: number
      text: string
      color: string
      /** Screen pixels — labels must stay legible at every zoom. */
      sizePx: number
      align?: CanvasTextAlign
      baseline?: CanvasTextBaseline
      opacity?: number
      mono?: boolean
    }
  | {
      k: 'robot'
      x: number
      y: number
      orientation: number
      radiusMm: number
      frontMm: number
      fill: string
      stroke: string
      label?: string
      labelColor?: string
      opacity?: number
      /**
       * A pose that is proposed or predicted rather than observed — a drag
       * ghost or an AI hologram. Drawn as a dashed outline so it can never be
       * mistaken for a tracked robot. `fill: 'transparent'` implies it.
       */
      ghost?: boolean
    }
  | {
      k: 'heatmap'
      /** Stable identity, so the rasterised tile can be cached across frames. */
      id: string
      x: number
      y: number
      cellWMm: number
      cellHMm: number
      columns: number
      rows: number
      values: number[]
      min: number
      max: number
      color: string
      opacity?: number
    }

export interface SceneLayer {
  id: string
  /** Lower draws first. */
  z: number
  opacity: number
  primitives: Primitive[]
  /**
   * Static layers are rasterised once into an offscreen tile in world space and
   * blitted thereafter. Only use for geometry that does not change per frame.
   */
  static?: boolean
  /**
   * Identity of a static layer's *content*. The offscreen tile is reused while
   * this is unchanged, so it must cover everything that affects the drawing —
   * geometry, palette and the toggles that add or remove primitives.
   */
  cacheKey?: string
}

export interface Scene {
  layers: SceneLayer[]
  background: string
  /** World-space extent used by fit-to-view, in millimetres. */
  extent: { minX: number; minY: number; maxX: number; maxY: number }
}

export function emptyScene(background: string): Scene {
  return {
    layers: [],
    background,
    extent: { minX: -5000, minY: -3500, maxX: 5000, maxY: 3500 },
  }
}

export class LayerBuilder {
  readonly primitives: Primitive[] = []
  cacheKey?: string

  constructor(
    readonly id: string,
    readonly z: number,
    readonly opacity = 1,
    readonly isStatic = false,
  ) {}

  add(primitive: Primitive): this {
    this.primitives.push(primitive)
    return this
  }

  build(): SceneLayer {
    return {
      id: this.id,
      z: this.z,
      opacity: this.opacity,
      primitives: this.primitives,
      static: this.isStatic,
      cacheKey: this.cacheKey,
    }
  }
}
