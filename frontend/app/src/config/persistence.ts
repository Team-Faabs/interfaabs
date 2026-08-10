// Versioned local-storage persistence with migration, corrupt-state recovery
// and workspace import/export.

import { isValidNode, normaliseLayout } from '../docking/model'
import { parseColor, toHex } from '../theme/color'
import {
  CONFIG_VERSION,
  DEFAULT_FIELD_SETTINGS,
  DEFAULT_SHORTCUTS,
  defaultConfig,
} from './defaults'
import type { AppConfig, WorkspaceConfig } from './types'

const STORAGE_KEY = 'interfaabs.config'
const QUARANTINE_KEY = 'interfaabs.config.corrupt'

export interface LoadResult {
  config: AppConfig
  /** Set when the stored value could not be used and defaults were restored. */
  recovered: string | null
}

type Migration = (value: Record<string, unknown>) => Record<string, unknown>

/**
 * Indexed by the version being migrated *from*. Add one entry per bump; never
 * edit an existing one, or already-stored configs will migrate differently to
 * how they did in the field.
 */
const MIGRATIONS: Record<number, Migration> = {}

export function loadConfig(): LoadResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private-mode or blocked storage: run from defaults without persisting.
    return { config: defaultConfig(), recovered: null }
  }
  if (!raw) return { config: defaultConfig(), recovered: null }

  try {
    let value = JSON.parse(raw) as Record<string, unknown>
    let version = typeof value.version === 'number' ? value.version : 0

    while (version < CONFIG_VERSION) {
      const migrate = MIGRATIONS[version]
      if (!migrate) throw new Error(`no migration from config version ${version}`)
      value = migrate(value)
      version += 1
      value.version = version
    }
    if (version > CONFIG_VERSION) {
      throw new Error(
        `stored config is version ${version}, this build understands ${CONFIG_VERSION}`,
      )
    }

    return { config: reconcile(value), recovered: null }
  } catch (error) {
    // Keep the bad value so it can be inspected rather than silently lost.
    try {
      localStorage.setItem(QUARANTINE_KEY, raw)
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* nothing more we can do */
    }
    return {
      config: defaultConfig(),
      recovered: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Merges a parsed value onto the defaults, dropping anything structurally
 * unusable. A layout that fails validation falls back to the built-in one for
 * that workspace rather than taking the whole config down with it.
 */
function reconcile(value: Record<string, unknown>): AppConfig {
  const base = defaultConfig()
  const stored = value as Partial<AppConfig>

  const workspaces = Array.isArray(stored.workspaces)
    ? stored.workspaces
        .filter(
          (workspace): workspace is WorkspaceConfig =>
            typeof workspace?.id === 'string' && typeof workspace?.label === 'string',
        )
        .map((workspace) => {
          const builtinDefault = base.workspaces.find((w) => w.id === workspace.id)
          return {
            ...workspace,
            // Tidied on the way in: a layout stored by an older build may hold a
            // pane with no share of its split, which renders zero pixels wide
            // and cannot be dragged back into view.
            layout: isValidNode(workspace.layout)
              ? normaliseLayout(workspace.layout)
              : (builtinDefault?.layout ?? base.workspaces[1].layout),
            topBar: Array.isArray(workspace.topBar)
              ? workspace.topBar.filter((item) => typeof item?.id === 'string')
              : (builtinDefault?.topBar ?? []),
          }
        })
    : base.workspaces

  // Never let a stored config remove a built-in workspace entirely.
  for (const builtin of base.workspaces) {
    if (!workspaces.some((workspace) => workspace.id === builtin.id)) {
      workspaces.push(builtin)
    }
  }

  const activeWorkspaceId = workspaces.some((w) => w.id === stored.activeWorkspaceId)
    ? (stored.activeWorkspaceId as string)
    : workspaces[0].id

  return {
    ...base,
    ...stored,
    version: CONFIG_VERSION,
    shell: stored.shell === 'brief' ? 'brief' : 'evolved',
    theme: isThemeId(stored.theme) ? stored.theme : base.theme,
    colorScheme: isColorScheme(stored.colorScheme) ? stored.colorScheme : base.colorScheme,
    // Normalised on the way in, so a colour hand-edited into storage either
    // becomes a hex the theme builder understands or reverts to the theme's
    // own — never a string that reaches the document and paints nothing.
    primaryColor: sanitiseColor(stored.primaryColor),
    accentColor: sanitiseColor(stored.accentColor),
    workspaces,
    activeWorkspaceId,
    field: { ...DEFAULT_FIELD_SETTINGS, ...(stored.field ?? {}) },
    // Unknown actions are dropped and new ones pick up their default, so a
    // release that adds a shortcut does not need a config migration.
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(stored.shortcuts ?? {}) },
    presets: Array.isArray(stored.presets) ? stored.presets : [],
  }
}

function isColorScheme(value: unknown): value is AppConfig['colorScheme'] {
  return value === 'system' || value === 'dark' || value === 'light'
}

function sanitiseColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = parseColor(value)
  return parsed ? toHex(parsed) : null
}

function isThemeId(value: unknown): value is AppConfig['theme'] {
  return (
    value === 'evolved' ||
    value === 'console' ||
    value === 'studio' ||
    value === 'brief' ||
    value === 'ledger'
  )
}

let writeTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced: layout drags and splitter moves would otherwise write per frame. */
export function saveConfig(config: AppConfig): void {
  if (writeTimer !== null) globalThis.clearTimeout(writeTimer)
  writeTimer = globalThis.setTimeout(() => {
    writeTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      /* quota or blocked storage — the session keeps working in memory */
    }
  }, 300)
}

export function clearStoredConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// ── import / export ──────────────────────────────────────────────────────

export interface WorkspaceBundle {
  interfaabsWorkspaceBundle: 1
  exportedAt: string
  workspaces: WorkspaceConfig[]
}

export function exportWorkspaces(workspaces: WorkspaceConfig[]): string {
  const bundle: WorkspaceBundle = {
    interfaabsWorkspaceBundle: 1,
    exportedAt: new Date().toISOString(),
    workspaces,
  }
  return JSON.stringify(bundle, null, 2)
}

export function importWorkspaces(text: string): WorkspaceConfig[] {
  const parsed = JSON.parse(text) as Partial<WorkspaceBundle>
  if (parsed.interfaabsWorkspaceBundle !== 1 || !Array.isArray(parsed.workspaces)) {
    throw new Error('not an interfaabs workspace bundle')
  }
  const usable = parsed.workspaces.filter(
    (workspace) =>
      typeof workspace?.id === 'string' &&
      typeof workspace?.label === 'string' &&
      isValidNode(workspace.layout),
  )
  if (usable.length === 0) throw new Error('bundle contains no usable workspace')
  // Imported workspaces are always custom, so importing can never overwrite a
  // built-in layout the operator still relies on.
  return usable.map((workspace) => ({
    ...workspace,
    id: `${workspace.id}-imported-${Math.random().toString(36).slice(2, 7)}`,
    label: `${workspace.label} (imported)`,
    kind: 'custom' as const,
    builtin: false,
  }))
}

export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
