// Layout tree for the docking shell.
//
// A layout is a tree of splits and tabsets. A tabset whose `rail` is set draws
// its tab strip as a vertical icon rail on that side and collapses to just the
// rail when its active tab is deselected — that is the collapsing side dock
// from the mockups, expressed as an ordinary dock node so that drag and drop,
// splitting and closing work identically everywhere.

export type PanelTypeId = string

export interface PanelInstance {
  /** Unique within a layout. */
  id: string
  panel: PanelTypeId
  /** Overrides the panel type's default title. */
  title?: string
  params?: Record<string, unknown>
  /** Rendered into its own browser window instead of into its tabset. */
  popped?: boolean
}

export interface DockSplit {
  kind: 'split'
  id: string
  direction: 'row' | 'column'
  children: DockNode[]
  /** Fractions of the split's main axis, one per child, summing to 1. */
  sizes: number[]
}

export interface DockTabs {
  kind: 'tabs'
  id: string
  tabs: PanelInstance[]
  /** `null` collapses the tabset to its rail. Only meaningful when railed. */
  activeTabId: string | null
  rail: 'left' | 'right' | null
  /**
   * Width in pixels of the panel body next to the rail. Railed tabsets are
   * sized absolutely rather than by split fraction, so collapsing one does not
   * redistribute the whole row.
   */
  railWidth?: number
}

export type DockNode = DockSplit | DockTabs

export interface Layout {
  root: DockNode
}

export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** Share of a split's flexible space handed to a pane dropped on its edge. */
const NEW_PANE_SHARE = 0.34

let counter = 0
export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}

export function tabs(
  tabList: PanelInstance[],
  options: {
    rail?: 'left' | 'right'
    activeTabId?: string | null
    id?: string
    railWidth?: number
  } = {},
): DockTabs {
  return {
    kind: 'tabs',
    id: options.id ?? nextId('tabs'),
    tabs: tabList,
    activeTabId:
      options.activeTabId !== undefined ? options.activeTabId : (tabList[0]?.id ?? null),
    rail: options.rail ?? null,
    railWidth: options.railWidth,
  }
}

export function split(
  direction: 'row' | 'column',
  children: DockNode[],
  sizes?: number[],
): DockSplit {
  return {
    kind: 'split',
    id: nextId('split'),
    direction,
    children,
    sizes: shareSizes(children, sizes ?? children.map(() => 1 / children.length)),
  }
}

export function panel(
  panelType: PanelTypeId,
  extra: Omit<PanelInstance, 'id' | 'panel'> = {},
): PanelInstance {
  return { id: nextId(panelType), panel: panelType, ...extra }
}

function normalise(sizes: number[], count: number): number[] {
  const filled = Array.from({ length: count }, (_, index) => sizes[index] ?? 1 / count)
  const total = filled.reduce((sum, value) => sum + value, 0)
  return total > 0 ? filled.map((value) => value / total) : filled.map(() => 1 / count)
}

/** Railed tabsets are laid out in pixels by the view, not by split fraction. */
function isRailed(node: DockNode): boolean {
  return node.kind === 'tabs' && node.rail !== null
}

/**
 * Normalises a split's sizes, holding railed children at no share — they are
 * sized in pixels — and rescuing any flexible child that ended up with none.
 *
 * A flexible child with no share renders zero pixels wide, which also leaves no
 * splitter to drag it back out with: it is gone for good. That is exactly what
 * splitting a rail used to produce, since the rail has no share to divide.
 */
function shareSizes(children: DockNode[], sizes: number[]): number[] {
  const raw = children.map((child, index) =>
    isRailed(child) ? 0 : Math.max(0, sizes[index] ?? 1 / children.length),
  )
  const flexible = children.filter((child) => !isRailed(child)).length
  if (flexible === 0) return raw

  const starved = raw.filter((size, index) => !isRailed(children[index]) && size <= 0).length
  if (starved > 0) {
    const total = raw.reduce((sum, size) => sum + size, 0)
    const each =
      total > 0 ? (total * NEW_PANE_SHARE) / (1 - NEW_PANE_SHARE) / starved : 1 / starved
    raw.forEach((size, index) => {
      if (!isRailed(children[index]) && size <= 0) raw[index] = each
    })
  }
  return normalise(raw, children.length)
}

// ── queries ──────────────────────────────────────────────────────────────

export function walk(node: DockNode, visit: (node: DockNode) => void): void {
  visit(node)
  if (node.kind === 'split') for (const child of node.children) walk(child, visit)
}

export function allTabs(node: DockNode): PanelInstance[] {
  const found: PanelInstance[] = []
  walk(node, (current) => {
    if (current.kind === 'tabs') found.push(...current.tabs)
  })
  return found
}

export function findTabset(node: DockNode, tabsetId: string): DockTabs | null {
  let found: DockTabs | null = null
  walk(node, (current) => {
    if (current.kind === 'tabs' && current.id === tabsetId) found = current
  })
  return found
}

export function findTabsetOfTab(node: DockNode, tabId: string): DockTabs | null {
  let found: DockTabs | null = null
  walk(node, (current) => {
    if (current.kind === 'tabs' && current.tabs.some((tab) => tab.id === tabId)) {
      found = current
    }
  })
  return found
}

/** Counts the ordinary panes; rails are chrome and are never counted. */
export function countPanes(node: DockNode): number {
  let total = 0
  walk(node, (current) => {
    if (current.kind === 'tabs' && current.rail === null) total += 1
  })
  return total
}

export function hasPanelType(node: DockNode, panelType: PanelTypeId): boolean {
  return allTabs(node).some((tab) => tab.panel === panelType)
}

// ── transforms ───────────────────────────────────────────────────────────

function mapNode(node: DockNode, transform: (node: DockNode) => DockNode): DockNode {
  if (node.kind === 'split') {
    const children = node.children.map((child) => mapNode(child, transform))
    return transform({ ...node, children })
  }
  return transform(node)
}

/** Drops empty tabsets and dissolves splits that no longer branch. */
function prune(node: DockNode): DockNode | null {
  if (node.kind === 'tabs') {
    // A railed tabset survives emptying. Dropping it would delete the side
    // rail itself, leaving the operator no target to drag panels back onto and
    // no way to recover the dock short of resetting the whole workspace.
    if (node.rail !== null) return { ...node, activeTabId: node.activeTabId }
    return node.tabs.length > 0 ? node : null
  }

  const kept: DockNode[] = []
  const keptSizes: number[] = []
  node.children.forEach((child, index) => {
    const pruned = prune(child)
    if (pruned) {
      kept.push(pruned)
      keptSizes.push(node.sizes[index] ?? 1 / node.children.length)
    }
  })

  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]

  // Merge a nested split of the same direction into its parent, so repeated
  // splitting in one direction does not build a deep, unresizable chain.
  const flattened: DockNode[] = []
  const flatSizes: number[] = []
  kept.forEach((child, index) => {
    if (child.kind === 'split' && child.direction === node.direction) {
      child.children.forEach((grandchild, inner) => {
        flattened.push(grandchild)
        flatSizes.push(keptSizes[index] * child.sizes[inner])
      })
    } else {
      flattened.push(child)
      flatSizes.push(keptSizes[index])
    }
  })

  return { ...node, children: flattened, sizes: shareSizes(flattened, flatSizes) }
}

function finish(node: DockNode | null): DockNode {
  return node ?? tabs([])
}

/**
 * Tidies a whole tree: drops empty tabsets, dissolves splits that no longer
 * branch and repairs shares. Run over persisted layouts, which may have been
 * written by a build whose splits could starve a pane of its share.
 */
export function normaliseLayout(root: DockNode): DockNode {
  return finish(prune(root))
}

export function setTabPopped(root: DockNode, tabId: string, popped: boolean): DockNode {
  return mapNode(root, (node) => {
    if (node.kind !== 'tabs') return node
    if (!node.tabs.some((tab) => tab.id === tabId)) return node
    return {
      ...node,
      tabs: node.tabs.map((tab) => (tab.id === tabId ? { ...tab, popped } : tab)),
    }
  })
}

export function setActiveTab(
  root: DockNode,
  tabsetId: string,
  tabId: string | null,
): DockNode {
  return mapNode(root, (node) =>
    node.kind === 'tabs' && node.id === tabsetId ? { ...node, activeTabId: tabId } : node,
  )
}

export function setSizes(root: DockNode, splitId: string, sizes: number[]): DockNode {
  return mapNode(root, (node) =>
    node.kind === 'split' && node.id === splitId
      ? { ...node, sizes: normalise(sizes, node.children.length) }
      : node,
  )
}

export function removeTab(root: DockNode, tabId: string): DockNode {
  const stripped = mapNode(root, (node) => {
    if (node.kind !== 'tabs') return node
    if (!node.tabs.some((tab) => tab.id === tabId)) return node
    const remaining = node.tabs.filter((tab) => tab.id !== tabId)
    return {
      ...node,
      tabs: remaining,
      activeTabId:
        node.activeTabId === tabId ? (remaining[0]?.id ?? null) : node.activeTabId,
    }
  })
  return finish(prune(stripped))
}

/** Removes `targetId` and its subtree wherever it sits below `node`. */
function dropChild(node: DockNode, targetId: string): DockNode {
  if (node.kind !== 'split') return node
  const children: DockNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    if (child.id === targetId) return
    children.push(dropChild(child, targetId))
    sizes.push(node.sizes[index] ?? 1 / node.children.length)
  })
  return { ...node, children, sizes }
}

/**
 * Closes a whole pane — every tab in it — and dissolves the split around it, so
 * its space goes back to the sibling it was taken from.
 */
export function removeTabset(root: DockNode, tabsetId: string): DockNode {
  if (root.id === tabsetId) return tabs([])
  return finish(prune(dropChild(root, tabsetId)))
}

export function addTab(
  root: DockNode,
  tabsetId: string,
  instance: PanelInstance,
  index?: number,
): DockNode {
  return mapNode(root, (node) => {
    if (node.kind !== 'tabs' || node.id !== tabsetId) return node
    const nextTabs = [...node.tabs]
    nextTabs.splice(index ?? nextTabs.length, 0, instance)
    return { ...node, tabs: nextTabs, activeTabId: instance.id }
  })
}

/**
 * Splices `node` in beside `siblingId` within its parent split. Returns null if
 * the sibling is the root, or its parent runs the other way.
 */
function insertBeside(
  root: DockNode,
  siblingId: string,
  node: DockNode,
  direction: 'row' | 'column',
  before: boolean,
): DockNode | null {
  let placed = false
  const next = mapNode(root, (current) => {
    if (placed || current.kind !== 'split' || current.direction !== direction) return current
    const at = current.children.findIndex((child) => child.id === siblingId)
    if (at < 0) return current
    placed = true

    // Sized against the flexible space only, so the new pane takes its share
    // from the panels beside it rather than from the pixel-sized rails.
    const flexible = current.children.reduce(
      (sum, child, index) => sum + (isRailed(child) ? 0 : (current.sizes[index] ?? 0)),
      0,
    )
    const children = [...current.children]
    const sizes = [...current.sizes]
    const insertAt = before ? at : at + 1
    children.splice(insertAt, 0, node)
    sizes.splice(insertAt, 0, (flexible * NEW_PANE_SHARE) / (1 - NEW_PANE_SHARE))
    return { ...current, children, sizes: shareSizes(children, sizes) }
  })
  return placed ? next : null
}

/**
 * Splits `tabsetId` and puts `instance` on `zone`'s side. `center` appends to
 * the existing tabset instead.
 */
export function dropInto(
  root: DockNode,
  tabsetId: string,
  instance: PanelInstance,
  zone: DropZone,
  index?: number,
): DockNode {
  if (zone === 'center') return addTab(root, tabsetId, instance, index)

  const direction: 'row' | 'column' = zone === 'left' || zone === 'right' ? 'row' : 'column'
  const before = zone === 'left' || zone === 'top'
  const target = findTabset(root, tabsetId)

  // A rail is sized in pixels and holds no share of its split, so wrapping one
  // would hand the new pane that same nothing and render it zero pixels wide.
  // Drop beside the rail in its parent instead, where there is space to take.
  if (target && target.rail !== null) {
    const beside = insertBeside(root, tabsetId, tabs([instance]), direction, before)
    if (beside) return finish(prune(beside))
  }

  const next = mapNode(root, (node) => {
    if (node.kind !== 'tabs' || node.id !== tabsetId) return node
    // The new tabset inherits nothing from the target: a panel dropped beside a
    // rail becomes a normal tabset, otherwise two rails would stack.
    const created = tabs([instance])
    const children = before ? [created, node] : [node, created]
    const shares = before
      ? [NEW_PANE_SHARE, 1 - NEW_PANE_SHARE]
      : [1 - NEW_PANE_SHARE, NEW_PANE_SHARE]
    return split(direction, children, shares)
  })
  return finish(prune(next))
}

export function moveTab(
  root: DockNode,
  tabId: string,
  targetTabsetId: string,
  zone: DropZone,
  index?: number,
): DockNode {
  const source = findTabsetOfTab(root, tabId)
  const instance = source?.tabs.find((tab) => tab.id === tabId)
  if (!source || !instance) return root

  // Reordering inside the same tabset is a move, not a remove-then-add: doing
  // it in two steps can prune the tabset out from under the insert.
  if (zone === 'center' && source.id === targetTabsetId) {
    return mapNode(root, (node) => {
      if (node.kind !== 'tabs' || node.id !== targetTabsetId) return node
      const without = node.tabs.filter((tab) => tab.id !== tabId)
      const at = Math.min(index ?? without.length, without.length)
      without.splice(at, 0, instance)
      return { ...node, tabs: without, activeTabId: tabId }
    })
  }

  const removed = removeTab(root, tabId)
  if (!findTabset(removed, targetTabsetId)) {
    // The target tabset disappeared when the source was pruned (it was the
    // source, and it emptied). Put the panel back where the tree still exists.
    return addTabToFirstTabset(removed, instance)
  }
  return dropInto(removed, targetTabsetId, instance, zone, index)
}

export function addTabToFirstTabset(root: DockNode, instance: PanelInstance): DockNode {
  let target: string | null = null
  walk(root, (node) => {
    if (target === null && node.kind === 'tabs' && node.rail === null) target = node.id
  })
  if (target === null) {
    walk(root, (node) => {
      if (target === null && node.kind === 'tabs') target = node.id
    })
  }
  if (target === null) return tabs([instance])
  return addTab(root, target, instance)
}

/** Adds a panel type, or focuses it if an instance already exists. */
export function openPanel(root: DockNode, panelType: PanelTypeId): DockNode {
  const existing = allTabs(root).find((tab) => tab.panel === panelType)
  if (existing) {
    const owner = findTabsetOfTab(root, existing.id)
    return owner ? setActiveTab(root, owner.id, existing.id) : root
  }
  return addTabToFirstTabset(root, panel(panelType))
}

/** Structural sanity check used when loading persisted layouts. */
export function isValidNode(value: unknown): value is DockNode {
  if (typeof value !== 'object' || value === null) return false
  const node = value as Record<string, unknown>
  if (node.kind === 'tabs') {
    return (
      typeof node.id === 'string' &&
      Array.isArray(node.tabs) &&
      node.tabs.every(
        (tab: unknown) =>
          typeof tab === 'object' &&
          tab !== null &&
          typeof (tab as PanelInstance).id === 'string' &&
          typeof (tab as PanelInstance).panel === 'string',
      )
    )
  }
  if (node.kind === 'split') {
    return (
      typeof node.id === 'string' &&
      (node.direction === 'row' || node.direction === 'column') &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every(isValidNode) &&
      Array.isArray(node.sizes)
    )
  }
  return false
}
