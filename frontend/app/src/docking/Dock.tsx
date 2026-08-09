import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  addTab,
  allTabs,
  moveTab,
  openPanel,
  panel as makePanel,
  removeTab,
  setActiveTab,
  setSizes,
  setTabPopped,
  type DockNode,
  type DockSplit,
  type DockTabs,
  type DropZone,
  type PanelInstance,
} from './model'
import { PopoutWindow } from './Popout'
import './dock.css'

/** Width of the icon rail itself; the panel body sits beside it. Mirrored by
 *  `.dock-strip--rail` in dock.css. */
export const RAIL_SIZE = 62
const SPLITTER_SIZE = 6
const DRAG_THRESHOLD_PX = 4

export interface PanelDescriptor {
  id: string
  title: string
  icon: string
  description?: string
  render: (instance: PanelInstance) => ReactNode
  /** Drawn in the tab strip's right-hand corner while this panel is active. */
  actions?: (instance: PanelInstance) => ReactNode
}

interface DockContextValue {
  registry: Record<string, PanelDescriptor>
  root: DockNode
  change: (next: DockNode) => void
  drag: DragState | null
  setDrag: (drag: DragState | null) => void
  register: (id: string, element: HTMLElement | null) => void
  rects: React.MutableRefObject<Map<string, HTMLElement>>
}

interface DragState {
  tabId: string
  label: string
  x: number
  y: number
  over: { tabsetId: string; zone: DropZone; index?: number } | null
}

const DockContext = createContext<DockContextValue | null>(null)

function useDock(): DockContextValue {
  const value = useContext(DockContext)
  if (!value) throw new Error('dock component used outside DockView')
  return value
}

export function DockView({
  layout,
  onChange,
  registry,
  themeKey = '',
}: {
  layout: DockNode
  onChange: (next: DockNode) => void
  registry: Record<string, PanelDescriptor>
  /** Changes when the theme does, so pop-out windows restyle themselves. */
  themeKey?: string
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const rects = useRef(new Map<string, HTMLElement>())

  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) rects.current.set(id, element)
    else rects.current.delete(id)
  }, [])

  const value = useMemo<DockContextValue>(
    () => ({ registry, root: layout, change: onChange, drag, setDrag, register, rects }),
    [registry, layout, onChange, drag, register],
  )

  // The hit tester reads live DOM rects rather than React state, so resolving a
  // drop target during `pointermove` never causes a render.
  useEffect(() => {
    hitTestImpl = (x, y) => {
      let best: {
        tabsetId: string
        zone: DropZone
        area: number
        index?: number
      } | null = null
      for (const [id, element] of rects.current) {
        const rect = element.getBoundingClientRect()
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
        const area = rect.width * rect.height
        // The innermost target wins, so nesting resolves the way it looks.
        if (best && area >= best.area) continue
        // Over the tab strip itself the gesture is a reorder, not a split, and
        // the insertion point is whichever gap the pointer is nearest.
        const strip = element.querySelector<HTMLElement>('.dock-strip:not(.dock-strip--rail)')
        if (strip) {
          const stripRect = strip.getBoundingClientRect()
          if (y >= stripRect.top && y <= stripRect.bottom) {
            const tabs = [...strip.querySelectorAll<HTMLElement>('.dock-tab')]
            let index = tabs.length
            for (let position = 0; position < tabs.length; position += 1) {
              const tabRect = tabs[position].getBoundingClientRect()
              if (x < tabRect.left + tabRect.width / 2) {
                index = position
                break
              }
            }
            best = { tabsetId: id, zone: 'center', area, index }
            continue
          }
        }

        const relX = (x - rect.left) / rect.width
        const relY = (y - rect.top) / rect.height
        const candidates: Array<[DropZone, number]> = [
          ['left', relX],
          ['right', 1 - relX],
          ['top', relY],
          ['bottom', 1 - relY],
        ]
        candidates.sort((a, b) => a[1] - b[1])
        const zone: DropZone = candidates[0][1] < 0.22 ? candidates[0][0] : 'center'
        best = { tabsetId: id, zone, area }
      }
      return best ? { tabsetId: best.tabsetId, zone: best.zone, index: best.index } : null
    }
    return () => {
      hitTestImpl = () => null
    }
  }, [])

  return (
    <DockContext.Provider value={value}>
      <div className={`dock ${drag ? 'is-dragging' : ''}`}>
        <DockNodeView node={layout} />
        {drag && (
          <div className="dock-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
            {drag.label}
          </div>
        )}
        {allTabs(layout)
          .filter((instance) => instance.popped)
          .map((instance) => {
            const descriptor = registry[instance.panel]
            if (!descriptor) return null
            return (
              <PopoutWindow
                key={instance.id}
                title={instance.title ?? descriptor.title}
                themeKey={themeKey}
                onClose={() => onChange(setTabPopped(layout, instance.id, false))}
              >
                <div className="dock-popout">{descriptor.render(instance)}</div>
              </PopoutWindow>
            )
          })}
      </div>
    </DockContext.Provider>
  )
}

function DockNodeView({ node }: { node: DockNode }) {
  return node.kind === 'split' ? <SplitView node={node} /> : <TabsView node={node} />
}

// ── splits ───────────────────────────────────────────────────────────────

function railBasis(node: DockNode): number | null {
  if (node.kind !== 'tabs' || node.rail === null) return null
  return node.activeTabId === null ? RAIL_SIZE : RAIL_SIZE + (node.railWidth ?? 280)
}

function SplitView({ node }: { node: DockSplit }) {
  const { change, root } = useDock()
  const hostRef = useRef<HTMLDivElement | null>(null)

  const startResize = useCallback(
    (index: number, event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current
      if (!host) return
      event.preventDefault()
      const horizontal = node.direction === 'row'
      const hostRect = host.getBoundingClientRect()
      const total = horizontal ? hostRect.width : hostRect.height
      const startPosition = horizontal ? event.clientX : event.clientY

      const before = node.children[index]
      const after = node.children[index + 1]
      const beforeRail = railBasis(before)
      const afterRail = railBasis(after)

      // Rails are sized in pixels, so a splitter next to one resizes the rail
      // rather than redistributing the row's fractions.
      const railTarget =
        beforeRail !== null ? { node: before as DockTabs, sign: 1 } :
        afterRail !== null ? { node: after as DockTabs, sign: -1 } :
        null
      const startRailWidth = railTarget ? (railTarget.node.railWidth ?? 280) : 0

      const fixed = node.children.reduce(
        (sum, child) => sum + (railBasis(child) ?? 0),
        0,
      )
      const flexible = Math.max(1, total - fixed - SPLITTER_SIZE * (node.children.length - 1))
      const startSizes = [...node.sizes]

      const move = (moveEvent: PointerEvent) => {
        const delta = (horizontal ? moveEvent.clientX : moveEvent.clientY) - startPosition

        if (railTarget) {
          const width = Math.max(160, Math.min(720, startRailWidth + delta * railTarget.sign))
          change(
            mapTabs(root, railTarget.node.id, (tabs) => ({ ...tabs, railWidth: width })),
          )
          return
        }

        const fraction = delta / flexible
        const next = [...startSizes]
        const lower = 0.08
        const sum = next[index] + next[index + 1]
        next[index] = Math.max(lower, Math.min(sum - lower, startSizes[index] + fraction))
        next[index + 1] = sum - next[index]
        change(setSizes(root, node.id, next))
      }

      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.classList.remove('is-resizing')
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [change, node, root],
  )

  return (
    <div
      className={`dock-split dock-split--${node.direction}`}
      ref={hostRef}
    >
      {node.children.map((child, index) => {
        const basis = railBasis(child)
        return (
          <div key={child.id} style={{ display: 'contents' }}>
            <div
              className="dock-cell"
              style={
                basis !== null
                  ? { flex: `0 0 ${basis}px` }
                  : { flex: `${node.sizes[index] ?? 1} 1 0`, minWidth: 0, minHeight: 0 }
              }
            >
              <DockNodeView node={child} />
            </div>
            {index < node.children.length - 1 && (
              <div
                className={`dock-splitter dock-splitter--${node.direction}`}
                onPointerDown={(event) => startResize(index, event)}
                role="separator"
                aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function mapTabs(
  node: DockNode,
  tabsetId: string,
  transform: (tabs: DockTabs) => DockTabs,
): DockNode {
  if (node.kind === 'tabs') return node.id === tabsetId ? transform(node) : node
  return {
    ...node,
    children: node.children.map((child) => mapTabs(child, tabsetId, transform)),
  }
}

// ── tabsets ──────────────────────────────────────────────────────────────

function TabsView({ node }: { node: DockTabs }) {
  const { registry, root, change, drag, setDrag, register } = useDock()
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    register(node.id, hostRef.current)
    return () => register(node.id, null)
  }, [node.id, register])

  const active = node.tabs.find((tab) => tab.id === node.activeTabId) ?? null
  const collapsed = node.rail !== null && active === null
  const descriptor = active ? registry[active.panel] : null

  const beginDrag = useCallback(
    (instance: PanelInstance, event: React.PointerEvent) => {
      if (event.button !== 0) return
      const startX = event.clientX
      const startY = event.clientY
      let started = false

      const move = (moveEvent: PointerEvent) => {
        if (
          !started &&
          Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) <
            DRAG_THRESHOLD_PX
        ) {
          return
        }
        started = true
        setDrag({
          tabId: instance.id,
          label: registry[instance.panel]?.title ?? instance.panel,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          over: hitTest(moveEvent.clientX, moveEvent.clientY),
        })
      }

      const up = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (!started) return
        const over = hitTest(upEvent.clientX, upEvent.clientY)
        setDrag(null)
        if (over) change(moveTab(root, instance.id, over.tabsetId, over.zone, over.index))
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [change, registry, root, setDrag],
  )

  const dropHint = drag?.over?.tabsetId === node.id ? drag.over.zone : null

  return (
    <div
      className={`dock-tabs ${node.rail ? `dock-tabs--rail dock-tabs--rail-${node.rail}` : ''} ${
        collapsed ? 'is-collapsed' : ''
      }`}
      ref={hostRef}
      data-tabset={node.id}
    >
      <TabStrip node={node} onTabPointerDown={beginDrag} />

      {!collapsed && (
        <div className="dock-body">
          {active?.popped ? (
            <div className="dock-empty">
              <span>Open in a separate window.</span>
              <button onClick={() => change(setTabPopped(root, active.id, false))}>
                Bring back
              </button>
            </div>
          ) : descriptor && active ? (
            descriptor.render(active)
          ) : (
            <div className="dock-empty">
              {active ? `Unknown panel “${active.panel}”` : 'Drop a panel here'}
            </div>
          )}
        </div>
      )}

      {dropHint && <div className={`dock-drop dock-drop--${dropHint}`} />}
    </div>
  )
}

function TabStrip({
  node,
  onTabPointerDown,
}: {
  node: DockTabs
  onTabPointerDown: (instance: PanelInstance, event: React.PointerEvent) => void
}) {
  const { registry, root, change } = useDock()
  const railed = node.rail !== null
  const active = node.tabs.find((tab) => tab.id === node.activeTabId) ?? null
  const descriptor = active ? registry[active.panel] : null

  const select = (instance: PanelInstance) => {
    // Clicking the active tab of a rail collapses the dock, per the plan.
    if (railed && node.activeTabId === instance.id) {
      change(setActiveTab(root, node.id, null))
    } else {
      change(setActiveTab(root, node.id, instance.id))
    }
  }

  return (
    <div className={`dock-strip ${railed ? 'dock-strip--rail' : ''}`}>
      {node.tabs.map((instance) => {
        const meta = registry[instance.panel]
        const isActive = instance.id === node.activeTabId
        return (
          <button
            key={instance.id}
            className={`dock-tab ${isActive ? 'is-active' : ''}`}
            title={instance.title ?? meta?.title ?? instance.panel}
            onPointerDown={(event) => onTabPointerDown(instance, event)}
            onClick={() => select(instance)}
          >
            {railed ? (
              <>
                <span className="dock-tab-icon">{meta?.icon ?? '▢'}</span>
                <em>{instance.title ?? meta?.title ?? instance.panel}</em>
              </>
            ) : (
              <>
                <span className="dock-tab-label">
                  {instance.title ?? meta?.title ?? instance.panel}
                </span>
                <span
                  className="dock-tab-close"
                  role="button"
                  aria-label="Close panel"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    change(removeTab(root, instance.id))
                  }}
                >
                  ×
                </span>
              </>
            )}
          </button>
        )
      })}
      {!railed && (
        <>
          <div className="dock-strip-grow" />
          {descriptor?.actions && active && (
            <div className="dock-strip-actions">{descriptor.actions(active)}</div>
          )}
          <div className="dock-strip-actions">
            {active && (
              <button
                className="dock-strip-btn"
                title="Open this panel in a separate window"
                onClick={() => change(setTabPopped(root, active.id, true))}
              >
                ⧉
              </button>
            )}
            <AddPanelButton tabsetId={node.id} />
          </div>
        </>
      )}
    </div>
  )
}

/** Reopens closed panels. Without it, closing a panel is a one-way door. */
function AddPanelButton({ tabsetId }: { tabsetId: string }) {
  const { registry, root, change } = useDock()
  const [open, setOpen] = useState(false)
  const present = new Set(allTabs(root).map((tab) => tab.panel))

  return (
    <span className="dock-add">
      <button
        className="dock-strip-btn"
        title="Add a panel to this tabset"
        onClick={() => setOpen((value) => !value)}
      >
        ＋
      </button>
      {open && (
        <>
          <span className="dock-add-scrim" onClick={() => setOpen(false)} />
          <span className="dock-add-menu">
            {Object.values(registry).map((descriptor) => (
              <button
                key={descriptor.id}
                title={descriptor.description}
                onClick={() => {
                  setOpen(false)
                  change(addTab(root, tabsetId, makePanel(descriptor.id)))
                }}
              >
                <i>{descriptor.icon}</i>
                {descriptor.title}
                {present.has(descriptor.id) && <em>open</em>}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  )
}

// ── drop targeting ───────────────────────────────────────────────────────

let hitTestImpl: (x: number, y: number) => DragState['over'] = () => null

function hitTest(x: number, y: number): DragState['over'] {
  return hitTestImpl(x, y)
}

/** Opens a panel type into the layout, or focuses an existing instance. */
export function openPanelInLayout(root: DockNode, panelType: string): DockNode {
  return openPanel(root, panelType)
}
