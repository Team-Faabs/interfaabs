import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import type { TeamColor } from '../protocol/types'
import { useStore } from '../store/hooks'
import type { EntitySelection } from '../store/store'
import { useTheme } from '../theme/ThemeProvider'
import { ContextMenu, type MenuItem } from '../ui/primitives'
import { systemIdOfKind } from '../util/systems'
import { buildScene, pickablesOf } from './build'
import { Canvas2DRenderer, type DrawStats } from './canvas2d'
import { PickIndex } from './picking'
import type { Scene } from './scene'
import {
  fieldExtent,
  fitTo,
  initialViewport,
  panBy,
  screenToWorld,
  zoomAt,
  type Viewport,
} from './viewport'
import './field.css'

const TRAIL_CAPACITY = 240

export interface FieldCanvasHandle {
  fit: () => void
}

interface DragState {
  kind: 'pan' | 'move' | 'rotate'
  pointerId: number
  startX: number
  startY: number
  target?: EntitySelection
  /** Live world position while dragging, committed on pointer up. */
  worldX: number
  worldY: number
  orientation: number
  moved: boolean
}

export function FieldCanvas({
  worldIds,
  panelId,
  interactive = true,
  compare = false,
  showStats,
  onViewportChange,
  fitToken,
  cursorId,
}: {
  worldIds: number[]
  panelId: string
  interactive?: boolean
  compare?: boolean
  showStats?: boolean
  onViewportChange?: (viewport: Viewport) => void
  /** Changing this value refits the view. */
  fitToken?: number
  /**
   * Renders the seeked state for this viewer cursor instead of the live world.
   * A history-bound canvas is never interactive: the host rejects mutations
   * against a detached cursor, so offering them would only produce errors.
   */
  cursorId?: string
}) {
  const store = useStore()
  const theme = useTheme()
  const { config } = useConfig()
  const settings = config.field

  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<Canvas2DRenderer | null>(null)
  const viewportRef = useRef<Viewport>({
    ...initialViewport(),
    mirrorX: settings.mirrorX,
    mirrorY: settings.mirrorY,
  })
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 })
  const dragRef = useRef<DragState | null>(null)
  const trailsRef = useRef(new Map<number, Array<[number, number]>>())
  const lastFrameRef = useRef(new Map<number, number>())
  const pickRef = useRef<PickIndex | null>(null)
  const needsFitRef = useRef(true)
  const [stats, setStats] = useState<DrawStats | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const simharkId = useMemo(
    () => systemIdOfKind(store.getMeta(), 'simhark'),
    // Recomputed on every render is fine: the meta read is a field access.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, store.getMeta().systems],
  )

  // Mirroring is a viewport property, so settings changes are applied to the
  // live viewport rather than rebuilding it.
  useEffect(() => {
    viewportRef.current = {
      ...viewportRef.current,
      mirrorX: settings.mirrorX,
      mirrorY: settings.mirrorY,
    }
  }, [settings.mirrorX, settings.mirrorY])

  useEffect(() => {
    needsFitRef.current = true
  }, [fitToken])

  // ── canvas lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const renderer = new Canvas2DRenderer(canvas)
    rendererRef.current = renderer

    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect()
      sizeRef.current = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        dpr: window.devicePixelRatio || 1,
      }
      needsFitRef.current = needsFitRef.current || rect.width < 2
    })
    observer.observe(host)

    const rect = host.getBoundingClientRect()
    sizeRef.current = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      dpr: window.devicePixelRatio || 1,
    }

    return () => {
      observer.disconnect()
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  const updateTrail = useCallback(
    (worldId: number, world: { frame: number; ball: { position: { x_mm: number; y_mm: number } } | null }) => {
      if (!world.ball) return
      if (lastFrameRef.current.get(worldId) === world.frame) return
      lastFrameRef.current.set(worldId, world.frame)
      const trail = trailsRef.current.get(worldId) ?? []
      trail.push([world.ball.position.x_mm, world.ball.position.y_mm])
      const wanted = Math.min(TRAIL_CAPACITY, Math.max(0, settings.ballTrailFrames))
      if (trail.length > wanted) trail.splice(0, trail.length - wanted)
      trailsRef.current.set(worldId, trail)
    },
    [settings.ballTrailFrames],
  )

  // ── render loop ────────────────────────────────────────────────────────
  //
  // Reads the store directly rather than through React state. This is the loop
  // that must not cause a re-render at simulation frame rate.
  useEffect(() => {
    let raf = 0
    let lastDraw = 0
    let disposed = false

    const frame = (now: number) => {
      if (disposed) return
      raf = requestAnimationFrame(frame)

      const minInterval = 1000 / Math.max(15, settings.maxFps)
      if (now - lastDraw < minInterval - 1) return
      lastDraw = now

      const renderer = rendererRef.current
      if (!renderer) return
      const { width, height, dpr } = sizeRef.current
      renderer.resize(width, height, dpr)

      const meta = store.getMeta()
      const chosen = worldIds.length > 0 ? worldIds : meta.worldIds.slice(0, 1)
      const frames = chosen
        .map((worldId) =>
          cursorId ? store.getHistoryWorld(cursorId, worldId) : store.getWorld(worldId),
        )
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)

      if (frames.length === 0) {
        const scene: Scene = {
          layers: [],
          background: theme.field.boundary,
          extent: { minX: -5000, minY: -3500, maxX: 5000, maxY: 3500 },
        }
        renderer.render(scene, viewportRef.current)
        return
      }

      const review = cursorId ? true : meta.cursor ? !meta.cursor.live : false
      const scenes: Scene[] = frames.map((entry, index) => {
        // A history canvas has no trail: the frames arrive out of order as the
        // operator scrubs, so joining them would draw a path that never happened.
        if (!cursorId) updateTrail(entry.world.world_id, entry.world)
        return buildScene({
          world: entry.world,
          debugItems: cursorId
            ? store.getHistoryDebugItems(cursorId, entry.world.world_id)
            : store.getDebugItems(entry.world.world_id),
          debugLayers: meta.debugLayers,
          settings,
          // In compare mode every world after the first is drawn at reduced
          // opacity in a stable per-slot tint, so overlays stay tellable apart.
          palette: compare && index > 0 ? comparePalette(theme.field, index) : theme.field,
          selection: meta.selection,
          review,
          trail: cursorId ? [] : (trailsRef.current.get(entry.world.world_id) ?? []),
        })
      })

      const scene = mergeScenes(scenes, compare)

      if (needsFitRef.current && width > 2) {
        needsFitRef.current = false
        viewportRef.current = { ...viewportRef.current, ...fitTo(scene.extent, width, height) }
        onViewportChange?.(viewportRef.current)
      }

      if (settings.followBall && frames[0].world.ball && !dragRef.current) {
        const ball = frames[0].world.ball.position
        viewportRef.current = {
          ...viewportRef.current,
          centerX: ball.x_mm,
          centerY: ball.y_mm,
        }
      }

      pickRef.current = new PickIndex(frames.flatMap((entry) => pickablesOf(entry.world)))

      const drawStats = renderer.render(scene, viewportRef.current)
      if (showStats) setStats(drawStats)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
    }
    // `settings` and `theme` are read fresh each frame through the closure, so
    // the loop restarts only when the identity of one of them changes.
  }, [store, worldIds, settings, theme, compare, showStats, onViewportChange, cursorId, updateTrail])

  // ── interaction ────────────────────────────────────────────────────────

  const toWorld = useCallback((event: { clientX: number; clientY: number }) => {
    const host = hostRef.current
    if (!host) return [0, 0] as const
    const rect = host.getBoundingClientRect()
    return screenToWorld(
      viewportRef.current,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
    )
  }, [])

  const mutable = useCallback((): boolean => {
    const meta = store.getMeta()
    if (meta.cursor && !meta.cursor.live) return false
    const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId)
    return session ? session.mutable : true
  }, [store])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || event.button === 2) return
      const [worldX, worldY] = toWorld(event)
      const tolerance = 12 / viewportRef.current.scale
      const hit = pickRef.current?.pick(worldX, worldY, tolerance) ?? null

      event.currentTarget.setPointerCapture(event.pointerId)

      if (hit && event.button === 0) {
        store.setSelection(hit.selection)
        const canMutate = mutable() && simharkId !== null
        dragRef.current = {
          kind: canMutate ? (event.altKey ? 'rotate' : 'move') : 'pan',
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          target: hit.selection,
          worldX,
          worldY,
          orientation: 0,
          moved: false,
        }
        return
      }

      if (event.button === 0 && !hit) store.setSelection(null)
      dragRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        worldX,
        worldY,
        orientation: 0,
        moved: false,
      }
    },
    [interactive, mutable, simharkId, store, toWorld],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true

      if (drag.kind === 'pan') {
        viewportRef.current = panBy(viewportRef.current, dx, dy)
        drag.startX = event.clientX
        drag.startY = event.clientY
        onViewportChange?.(viewportRef.current)
        return
      }

      const [worldX, worldY] = toWorld(event)
      if (drag.kind === 'move') {
        drag.worldX = worldX
        drag.worldY = worldY
      } else {
        drag.orientation = Math.atan2(worldY - drag.worldY, worldX - drag.worldX)
      }
    },
    [onViewportChange, toWorld],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || drag.pointerId !== event.pointerId) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      if (!drag.moved || !drag.target || !simharkId) return

      const target = drag.target
      const worldId = target.worldId
      if (drag.kind === 'move') {
        const position = { x_mm: Math.round(drag.worldX), y_mm: Math.round(drag.worldY) }
        if (target.kind === 'ball') {
          store.send(
            panelId,
            {
              type: 'system',
              data: {
                system_id: simharkId,
                command: { type: 'simhark', data: { type: 'move_ball', data: { world_id: worldId, position } } },
              },
            },
            `move ball → ${position.x_mm}, ${position.y_mm}`,
          )
        } else if (target.team !== undefined && target.robotId !== undefined) {
          store.send(
            panelId,
            {
              type: 'system',
              data: {
                system_id: simharkId,
                command: {
                  type: 'simhark',
                  data: {
                    type: 'move_robot',
                    data: { world_id: worldId, team: target.team, id: target.robotId, position },
                  },
                },
              },
            },
            `move ${initial(target.team)}${target.robotId} → ${position.x_mm}, ${position.y_mm}`,
          )
        }
      } else if (
        drag.kind === 'rotate' &&
        target.kind === 'robot' &&
        target.team !== undefined &&
        target.robotId !== undefined
      ) {
        store.send(
          panelId,
          {
            type: 'system',
            data: {
              system_id: simharkId,
              command: {
                type: 'simhark',
                data: {
                  type: 'rotate_robot',
                  data: {
                    world_id: worldId,
                    team: target.team,
                    id: target.robotId,
                    orientation_rad: drag.orientation,
                  },
                },
              },
            },
          },
          `rotate ${initial(target.team)}${target.robotId} → ${((drag.orientation * 180) / Math.PI).toFixed(1)}°`,
        )
      }
    },
    [panelId, simharkId, store],
  )

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    const factor = Math.exp(-event.deltaY * 0.0015)
    viewportRef.current = zoomAt(
      viewportRef.current,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
      factor,
    )
  }, [])

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive) return
      event.preventDefault()
      const [worldX, worldY] = toWorld(event)
      const tolerance = 12 / viewportRef.current.scale
      const hit = pickRef.current?.pick(worldX, worldY, tolerance) ?? null
      const canMutate = mutable() && simharkId !== null
      const meta = store.getMeta()
      const worldId = hit?.selection.worldId ?? meta.worldIds[0] ?? 0

      const items: MenuItem[] = []
      if (hit) {
        items.push({
          id: 'select',
          label:
            hit.selection.kind === 'ball'
              ? 'Select ball'
              : `Select ${initial(hit.selection.team!)}${hit.selection.robotId}`,
          onSelect: () => store.setSelection(hit.selection),
        })
        if (hit.selection.kind === 'robot' && canMutate) {
          items.push({
            id: 'remove',
            label: 'Remove from field',
            danger: true,
            onSelect: () =>
              store.send(panelId, {
                type: 'system',
                data: {
                  system_id: simharkId!,
                  command: {
                    type: 'simhark',
                    data: {
                      type: 'set_robot_present',
                      data: {
                        world_id: worldId,
                        team: hit.selection.team!,
                        id: hit.selection.robotId!,
                        present: false,
                      },
                    },
                  },
                },
              }),
          })
        }
      }

      if (canMutate) {
        // Placing a robot needs an id the world is not already using.
        const world = store.getWorld(worldId)?.world
        for (const team of ['blue', 'yellow'] as const) {
          const used = new Set(
            (world?.robots ?? []).filter((r) => r.team === team).map((r) => r.id),
          )
          let free = 0
          while (used.has(free) && free < 16) free += 1
          if (free >= 16) continue
          items.push({
            id: `place-${team}`,
            label: `Place ${team} ${free} here`,
            separatorBefore: team === 'blue' && items.length > 0,
            onSelect: () => {
              store.send(panelId, {
                type: 'system',
                data: {
                  system_id: simharkId!,
                  command: {
                    type: 'simhark',
                    data: {
                      type: 'set_robot_present',
                      data: { world_id: worldId, team, id: free, present: true },
                    },
                  },
                },
              })
              store.send(panelId, {
                type: 'system',
                data: {
                  system_id: simharkId!,
                  command: {
                    type: 'simhark',
                    data: {
                      type: 'move_robot',
                      data: {
                        world_id: worldId,
                        team,
                        id: free,
                        position: { x_mm: Math.round(worldX), y_mm: Math.round(worldY) },
                      },
                    },
                  },
                },
              })
            },
          })
        }

        items.push({
          id: 'ball-here',
          label: 'Move ball here',
          separatorBefore: items.length > 0,
          onSelect: () =>
            store.send(panelId, {
              type: 'system',
              data: {
                system_id: simharkId!,
                command: {
                  type: 'simhark',
                  data: {
                    type: 'move_ball',
                    data: {
                      world_id: worldId,
                      position: { x_mm: Math.round(worldX), y_mm: Math.round(worldY) },
                    },
                  },
                },
              },
            }),
        })
      }

      items.push({
        id: 'copy',
        label: 'Copy position',
        hint: `${worldX.toFixed(0)}, ${worldY.toFixed(0)}`,
        separatorBefore: true,
        onSelect: () =>
          void navigator.clipboard?.writeText(`${worldX.toFixed(0)}, ${worldY.toFixed(0)}`),
      })
      items.push({
        id: 'fit',
        label: 'Fit view',
        onSelect: () => {
          needsFitRef.current = true
        },
      })

      setMenu({ x: event.clientX, y: event.clientY, items })
    },
    [interactive, mutable, panelId, simharkId, store, toWorld],
  )

  const onDoubleClick = useCallback(() => {
    needsFitRef.current = true
  }, [])

  return (
    <div
      className={`fc ${interactive ? 'is-interactive' : ''}`}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      style={{ background: theme.field.boundary }}
    >
      <canvas ref={canvasRef} className="fc-canvas" />
      {showStats && stats && (
        <div className="fc-stats ui-mono">
          {stats.drawMs.toFixed(2)} ms · {stats.drawCalls} calls · {stats.batches} batches ·{' '}
          {stats.primitives} prims
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function initial(team: TeamColor): string {
  return team === 'blue' ? 'B' : 'Y'
}

/**
 * Stable per-slot tints, so a compared world keeps its colour across frames.
 * The team fills are left alone — a compare view that cannot tell blue from
 * yellow is worse than no compare view. The world identity goes on the outline
 * instead, which is what the legend shows.
 */
function comparePalette(
  base: import('../theme/themes').FieldPalette,
  index: number,
): import('../theme/themes').FieldPalette {
  const tint = `hsl(${[200, 320, 90, 40, 260][(index - 1) % 5]} 70% 60%)`
  return { ...base, robotEdge: tint, select: tint, velocity: tint, keepout: tint }
}

function mergeScenes(scenes: Scene[], compare: boolean): Scene {
  if (scenes.length === 1) return scenes[0]
  const [first, ...rest] = scenes
  const layers = [...first.layers]
  rest.forEach((scene, index) => {
    for (const layer of scene.layers) {
      // The pitch is drawn once; overlaying it would hide the world beneath.
      if (layer.static) continue
      layers.push({
        ...layer,
        id: `${layer.id}#${index + 1}`,
        z: layer.z + 0.5,
        opacity: compare ? 0.6 : layer.opacity,
        static: false,
      })
    }
  })
  layers.sort((a, b) => a.z - b.z)
  return { ...first, layers }
}
