import type { DockNode } from '../docking/model'

/**
 * The shell is the chrome: how the top bar and the side rails are arranged.
 * It says nothing about colour or density — that is the theme's job, so the
 * two axes combine freely.
 */
export type ShellId = 'evolved' | 'brief'

/**
 * The theme carries colour, radius, density and chrome weight. `console` and
 * `studio` are looks, not layouts: either can be worn by either shell.
 */
export type ThemeId = 'evolved' | 'console' | 'studio' | 'brief' | 'ledger'

/**
 * Every theme is authored twice, so the scheme is a free axis: pick the look
 * you want and the light level the hall demands, independently. `system`
 * follows `prefers-color-scheme`, which is the default — a laptop that dims
 * itself for an evening match should take the interface with it.
 */
export type ColorScheme = 'system' | 'dark' | 'light'

export type WorkspaceKind = 'start' | 'live' | 'replay' | 'custom'

export type TopBarItemId =
  | 'brand'
  | 'session'
  | 'workspace-switcher'
  | 'transport'
  | 'speed'
  | 'live-toggle'
  | 'return-to-live'
  | 'field-mode'
  | 'recording'
  | 'export'
  | 'health'
  | 'alerts'
  | 'clients'
  | 'latency'
  | 'frame'
  | 'sim-time'
  | 'debug-token'
  | 'command-palette'
  | 'settings'
  | 'emergency'
  | 'spacer'

export interface TopBarItemConfig {
  id: TopBarItemId
  visible: boolean
}

export interface WorkspaceConfig {
  id: string
  label: string
  kind: WorkspaceKind
  /** Built-in workspaces can be reset but not deleted. */
  builtin: boolean
  layout: DockNode
  /** Ordered; `spacer` may repeat, everything else appears at most once. */
  topBar: TopBarItemConfig[]
}

export type MultiWorldMode = 'focus' | 'grid' | 'compare'

export interface FieldSettings {
  /** Viewport-only mirroring. Never mutates canonical or recorded state. */
  mirrorX: boolean
  mirrorY: boolean
  followBall: boolean
  showLabels: boolean
  showRobotIds: boolean
  showVelocities: boolean
  showHeatmaps: boolean
  showDebugOverlays: boolean
  showConfidence: boolean
  showGoalHighlights: boolean
  showCoordinateHints: boolean
  showFieldGrid: boolean
  ballTrailFrames: number
  multiWorld: MultiWorldMode
  /** World shown in focus mode. `null` follows the lowest world id. */
  focusWorldId: number | null
  /** Worlds explicitly chosen for compare mode. Never populated implicitly. */
  compareWorldIds: number[]
  gridMaxTiles: number
  /** Render cap; the renderer never draws faster than the display anyway. */
  maxFps: number
  showDrawStats: boolean
  hiddenLayerIds: string[]
  soloLayerId: string | null
  layerOpacity: number
}

/** Actions a shortcut may be bound to. Ids are stable across releases. */
export type ShortcutAction =
  | 'command-palette'
  | 'halt-all'
  | 'stop-all'
  | 'toggle-live'
  | 'transport-toggle'
  | 'step-back'
  | 'step-forward'
  | 'fit-field'
  | 'mirror-x'
  | 'mirror-y'
  | 'toggle-debug-layers'
  | 'workspace-1'
  | 'workspace-2'
  | 'workspace-3'
  | 'open-settings'

/** Chord strings such as `ctrl+k`, `shift+f`, `alt+1`. Empty means unbound. */
export type ShortcutMap = Record<ShortcutAction, string>

/** A saved match configuration, reusable from Start Center. */
export interface SetupPreset {
  id: string
  label: string
  /** Stored as the protocol's `MatchConfiguration`, minus the seed. */
  configuration: Record<string, unknown>
  kind: string
}

export interface AppConfig {
  version: number
  shell: ShellId
  theme: ThemeId
  colorScheme: ColorScheme
  /**
   * The two colours the operator owns, as hex. `null` follows the theme's own
   * suggestion for the active scheme. Both are adjusted for legibility before
   * they reach the document, so an unreadable choice is impossible rather than
   * merely discouraged.
   */
  primaryColor: string | null
  accentColor: string | null
  shortcuts: ShortcutMap
  presets: SetupPreset[]
  /** Overrides the theme's own density when set. */
  density: 'theme' | 'comfortable' | 'compact'
  workstationLabel: string | null
  activeWorkspaceId: string
  workspaces: WorkspaceConfig[]
  field: FieldSettings
  confirmEmergency: boolean
  showAlertToasts: boolean
}
