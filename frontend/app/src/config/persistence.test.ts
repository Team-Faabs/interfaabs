import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'vitest'

import { defaultWorkspaces } from './defaults'
import { exportWorkspaces, importWorkspaces, loadConfig, saveConfig } from './persistence'

const STORAGE_KEY = 'interfaabs.config'
const QUARANTINE_KEY = 'interfaabs.config.corrupt'

/** Minimal localStorage, so persistence can be tested outside a browser. */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
})

describe('loadConfig', () => {
  it('returns defaults when nothing is stored', () => {
    const { config, recovered } = loadConfig()
    assert.equal(recovered, null)
    assert.equal(config.shell, 'evolved')
    assert.equal(config.workspaces.length, 3)
  })

  it('quarantines an unparseable value and recovers', () => {
    localStorage.setItem(STORAGE_KEY, '{ this is not json')
    const { config, recovered } = loadConfig()

    assert.ok(recovered, 'the caller must be told the stored config was dropped')
    assert.equal(config.workspaces.length, 3)
    assert.equal(localStorage.getItem(QUARANTINE_KEY), '{ this is not json')
    assert.equal(localStorage.getItem(STORAGE_KEY), null)
  })

  it('refuses a config written by a newer build rather than mangling it', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 999 }))
    const { recovered } = loadConfig()
    assert.match(String(recovered), /version 999/)
  })

  it('replaces a corrupt layout with the built-in one and keeps the rest', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        theme: 'console',
        workspaces: [
          { id: 'live-ops', label: 'Mine', kind: 'live', builtin: true, layout: { junk: true } },
        ],
      }),
    )
    const { config, recovered } = loadConfig()

    assert.equal(recovered, null, 'one bad layout must not discard the whole config')
    assert.equal(config.theme, 'console')
    const liveOps = config.workspaces.find((workspace) => workspace.id === 'live-ops')
    assert.equal(liveOps?.label, 'Mine')
    assert.ok(liveOps && 'kind' in liveOps.layout, 'the layout fell back to a valid tree')
  })

  it('restores a built-in workspace that was deleted from storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, workspaces: [] }))
    const { config } = loadConfig()

    for (const builtin of defaultWorkspaces()) {
      assert.ok(config.workspaces.some((workspace) => workspace.id === builtin.id))
    }
  })

  it('fills in shortcuts and field settings added since the config was written', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, field: { mirrorX: true }, shortcuts: { 'fit-field': 'g' } }),
    )
    const { config } = loadConfig()

    assert.equal(config.field.mirrorX, true, 'stored values survive')
    assert.equal(config.field.focusWorldId, null, 'new settings take their default')
    assert.equal(config.shortcuts['fit-field'], 'g', 'stored bindings survive')
    assert.equal(config.shortcuts['command-palette'], 'ctrl+k', 'new bindings take their default')
  })

  it('falls back to a valid workspace when the stored active id is gone', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, activeWorkspaceId: 'deleted-workspace' }),
    )
    const { config } = loadConfig()
    assert.ok(config.workspaces.some((w) => w.id === config.activeWorkspaceId))
  })
})

describe('workspace bundles', () => {
  it('round-trips through export and import', () => {
    const exported = exportWorkspaces(defaultWorkspaces())
    const imported = importWorkspaces(exported)

    assert.equal(imported.length, 3)
    for (const workspace of imported) {
      assert.equal(workspace.builtin, false, 'imports must never overwrite a built-in')
      assert.equal(workspace.kind, 'custom')
      assert.match(workspace.label, /\(imported\)$/)
    }
  })

  it('rejects a file that is not a workspace bundle', () => {
    assert.throws(() => importWorkspaces('{"hello":1}'), /not an interfaabs workspace bundle/)
    assert.throws(
      () => importWorkspaces(JSON.stringify({ interfaabsWorkspaceBundle: 1, workspaces: [{}] })),
      /no usable workspace/,
    )
  })
})

describe('saveConfig', () => {
  it('survives storage that refuses to write', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded')
        },
        removeItem: () => {},
      },
      configurable: true,
      writable: true,
    })
    // The session must keep working in memory rather than throwing at the user.
    assert.doesNotThrow(() => saveConfig(loadConfig().config))
  })
})
