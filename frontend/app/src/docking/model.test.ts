import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import {
  addTab,
  allTabs,
  dropInto,
  findTabsetOfTab,
  isValidNode,
  moveTab,
  openPanel,
  panel,
  removeTab,
  setActiveTab,
  setTabPopped,
  split,
  tabs,
  type DockNode,
  type DockSplit,
  type DockTabs,
} from './model'

function walkNodes(node: DockNode, visit: (node: DockNode) => void): void {
  visit(node)
  if (node.kind === 'split') for (const child of node.children) walkNodes(child, visit)
}

function liveOps() {
  const rail = tabs([panel('systems'), panel('layers')], {
    rail: 'left',
    activeTabId: null,
    railWidth: 260,
  })
  const field = tabs([panel('field')])
  const bottom = tabs([panel('command-feed'), panel('tasks')])
  return { rail, field, bottom, root: split('row', [rail, split('column', [field, bottom])]) }
}

describe('removeTab', () => {
  it('keeps a railed tabset alive when its last panel leaves', () => {
    const { rail, root } = liveOps()
    const next = removeTab(root, rail.tabs[0].id)
    const stillThere = removeTab(next, rail.tabs[1].id)

    const survivor = findTabsetOfTab(stillThere, 'nothing') // just to exercise the walk
    assert.equal(survivor, null)

    let found: DockTabs | null = null
    walkNodes(stillThere, (node) => {
      if (node.kind === 'tabs' && node.rail === 'left') found = node
    })

    assert.ok(found, 'the left rail must survive being emptied')
    assert.equal((found as DockTabs).tabs.length, 0)
    assert.equal((found as DockTabs).activeTabId, null)
  })

  it('prunes an emptied ordinary tabset and dissolves the split around it', () => {
    const { bottom, root } = liveOps()
    let next: DockNode = root
    for (const tab of bottom.tabs) next = removeTab(next, tab.id)

    assert.equal(allTabs(next).length, 3, 'field plus the two rail panels remain')
    // The column split had two children and now has one, so it must be gone.
    const columns: DockSplit[] = []
    walkNodes(next, (node) => {
      if (node.kind === 'split' && node.direction === 'column') columns.push(node)
    })
    assert.equal(columns.length, 0)
  })
})

describe('moveTab', () => {
  it('reorders within one tabset at the requested index', () => {
    const { bottom, root } = liveOps()
    const [first, second] = bottom.tabs
    const next = moveTab(root, second.id, bottom.id, 'center', 0)
    const owner = findTabsetOfTab(next, second.id)

    assert.ok(owner)
    assert.deepEqual(
      owner.tabs.map((tab) => tab.id),
      [second.id, first.id],
    )
  })

  it('moves a panel into another tabset', () => {
    const { field, bottom, root } = liveOps()
    const moved = bottom.tabs[0]
    const next = moveTab(root, moved.id, field.id, 'center')

    assert.equal(findTabsetOfTab(next, moved.id)?.id, field.id)
    assert.equal(allTabs(next).length, 5)
  })

  it('splits when dropped on an edge', () => {
    const { field, bottom, root } = liveOps()
    const moved = bottom.tabs[0]
    const next = moveTab(root, moved.id, field.id, 'right')

    const owner = findTabsetOfTab(next, moved.id)
    assert.ok(owner)
    assert.notEqual(owner.id, field.id, 'an edge drop must create a new tabset')
    assert.equal(allTabs(next).length, 5)
  })

  it('does not lose the panel when the source tabset is also the target', () => {
    const solo = tabs([panel('field')])
    const root = split('row', [solo, tabs([panel('tasks')])])
    const next = moveTab(root, solo.tabs[0].id, solo.id, 'right')

    assert.equal(allTabs(next).length, 2)
  })
})

describe('addTab and openPanel', () => {
  it('focuses an existing instance rather than opening a second one', () => {
    const { root } = liveOps()
    const next = openPanel(root, 'field')

    assert.equal(allTabs(next).filter((tab) => tab.panel === 'field').length, 1)
  })

  it('prefers a non-rail tabset when opening a new panel', () => {
    const { rail, root } = liveOps()
    const next = openPanel(root, 'diagnostics')
    const owner = findTabsetOfTab(next, allTabs(next).find((t) => t.panel === 'diagnostics')!.id)

    assert.ok(owner)
    assert.notEqual(owner.id, rail.id)
  })

  it('inserts at the requested index', () => {
    const { bottom, root } = liveOps()
    const added = panel('events')
    const next = addTab(root, bottom.id, added, 0)

    assert.equal(findTabsetOfTab(next, added.id)?.tabs[0].id, added.id)
  })
})

describe('setActiveTab and setTabPopped', () => {
  it('collapses a rail when its active tab is deselected', () => {
    const { rail, root } = liveOps()
    const opened = setActiveTab(root, rail.id, rail.tabs[0].id)
    const closed = setActiveTab(opened, rail.id, null)

    assert.equal(findTabsetOfTab(closed, rail.tabs[0].id)?.activeTabId, null)
  })

  it('marks and clears the popped flag without moving the panel', () => {
    const { field, root } = liveOps()
    const popped = setTabPopped(root, field.tabs[0].id, true)

    assert.equal(allTabs(popped).find((tab) => tab.id === field.tabs[0].id)?.popped, true)
    assert.equal(findTabsetOfTab(popped, field.tabs[0].id)?.id, field.id)

    const restored = setTabPopped(popped, field.tabs[0].id, false)
    assert.equal(allTabs(restored).find((tab) => tab.id === field.tabs[0].id)?.popped, false)
  })
})

describe('isValidNode', () => {
  it('accepts a real layout and rejects corrupt ones', () => {
    assert.equal(isValidNode(liveOps().root), true)
    assert.equal(isValidNode(null), false)
    assert.equal(isValidNode({ kind: 'tabs' }), false)
    assert.equal(isValidNode({ kind: 'split', id: 'x', direction: 'row', children: [] }), false)
    assert.equal(isValidNode({ kind: 'tabs', id: 'x', tabs: [{ id: 'a' }] }), false)
  })
})

describe('dropInto', () => {
  it('appends on a centre drop and splits on an edge drop', () => {
    const target = tabs([panel('field')])
    const root = split('row', [target, tabs([panel('tasks')])])

    const added = panel('events')
    const appended = dropInto(root, target.id, added, 'center')
    assert.equal(findTabsetOfTab(appended, added.id)?.id, target.id)
    assert.equal(findTabsetOfTab(appended, added.id)?.tabs.length, 2)

    const belowTarget = dropInto(root, target.id, panel('events'), 'bottom')
    assert.equal(allTabs(belowTarget).length, 3)
  })
})
