import { panel, split, tabs, type DockNode } from '../docking/model'
import type {
  AppConfig,
  FieldSettings,
  ShortcutAction,
  ShortcutMap,
  TopBarItemConfig,
  TopBarItemId,
  WorkspaceConfig,
} from './types'

export const CONFIG_VERSION = 1

export const DEFAULT_FIELD_SETTINGS: FieldSettings = {
  mirrorX: false,
  mirrorY: false,
  followBall: false,
  showLabels: true,
  showRobotIds: true,
  showVelocities: true,
  showHeatmaps: true,
  showDebugOverlays: true,
  showConfidence: true,
  showGoalHighlights: true,
  showCoordinateHints: true,
  showFieldGrid: false,
  ballTrailFrames: 24,
  multiWorld: 'focus',
  focusWorldId: null,
  compareWorldIds: [],
  gridMaxTiles: 24,
  maxFps: 60,
  showDrawStats: false,
  hiddenLayerIds: [],
  soloLayerId: null,
  layerOpacity: 1,
}

function bar(...ids: TopBarItemId[]): TopBarItemConfig[] {
  return ids.map((id) => ({ id, visible: true }))
}

function startCenterLayout(): DockNode {
  return split(
    'row',
    [
      tabs([panel('start-center')]),
      tabs([panel('recordings'), panel('sessions'), panel('systems')], {
        rail: 'right',
        railWidth: 340,
      }),
    ],
    [1, 0],
  )
}

function liveOpsLayout(): DockNode {
  return split(
    'row',
    [
      // Starts collapsed: the rail is visible, the panel body is not.
      // Referris is deliberately absent — it must not appear at all unless the
      // host advertises it, so it is reached through the add-panel menu.
      tabs(
        [
          panel('systems'),
          panel('worlds'),
          panel('sessions'),
          panel('layers'),
          panel('developer'),
          panel('recordings'),
        ],
        { rail: 'left', activeTabId: null, railWidth: 260 },
      ),
      split(
        'column',
        [
          tabs([panel('field')]),
          tabs([panel('command-feed'), panel('tasks'), panel('referee'), panel('events')]),
        ],
        [0.74, 0.26],
      ),
      tabs([panel('properties'), panel('tasks'), panel('referee'), panel('debug-values')], {
        rail: 'right',
        railWidth: 316,
      }),
    ],
    [0, 1, 0],
  )
}

function replayLayout(): DockNode {
  return split(
    'row',
    [
      tabs([panel('recordings'), panel('sessions'), panel('worlds'), panel('layers')], {
        rail: 'left',
        railWidth: 280,
      }),
      split(
        'column',
        [
          // Live beside history, so scrubbing shows both at once. This is the
          // side-by-side comparison the plan asks for, built out of two
          // ordinary panels rather than a special layout.
          split('row', [tabs([panel('field')]), tabs([panel('field-history')])], [0.5, 0.5]),
          tabs([panel('timeline')]),
          tabs([panel('events'), panel('command-feed')]),
        ],
        [0.6, 0.16, 0.24],
      ),
      tabs([panel('properties'), panel('debug-values'), panel('referee')], {
        rail: 'right',
        activeTabId: null,
        railWidth: 316,
      }),
    ],
    [0, 1, 0],
  )
}

export function defaultWorkspaces(): WorkspaceConfig[] {
  return [
    {
      id: 'start-center',
      label: 'Start Center',
      kind: 'start',
      builtin: true,
      layout: startCenterLayout(),
      topBar: bar(
        'brand',
        'workspace-switcher',
        'spacer',
        'health',
        'alerts',
        'clients',
        'command-palette',
        'settings',
      ),
    },
    {
      id: 'live-ops',
      label: 'Live Operations',
      kind: 'live',
      builtin: true,
      layout: liveOpsLayout(),
      topBar: bar(
        'brand',
        'session',
        'workspace-switcher',
        'transport',
        'speed',
        'live-toggle',
        'return-to-live',
        'field-mode',
        'recording',
        'export',
        'spacer',
        'health',
        'alerts',
        'command-palette',
        'settings',
        'emergency',
      ),
    },
    {
      id: 'replay-analysis',
      label: 'Replay Analysis',
      kind: 'replay',
      builtin: true,
      layout: replayLayout(),
      topBar: bar(
        'brand',
        'session',
        'workspace-switcher',
        'transport',
        'speed',
        'live-toggle',
        'return-to-live',
        'export',
        'spacer',
        'frame',
        'sim-time',
        'debug-token',
        'command-palette',
        'settings',
      ),
    },
  ]
}

/**
 * Emergency actions are deliberately left unbound: a stray keystroke must not
 * halt a live match. Bind them explicitly if you want them.
 */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  'command-palette': 'ctrl+k',
  'halt-all': '',
  'stop-all': '',
  'toggle-live': '',
  'transport-toggle': 'space',
  'step-back': 'arrowleft',
  'step-forward': 'arrowright',
  'fit-field': 'f',
  'mirror-x': 'shift+x',
  'mirror-y': 'shift+y',
  'toggle-debug-layers': 'd',
  'workspace-1': 'ctrl+1',
  'workspace-2': 'ctrl+2',
  'workspace-3': 'ctrl+3',
  'open-settings': 'ctrl+,',
}

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  'command-palette': 'Command palette',
  'halt-all': 'Halt All',
  'stop-all': 'Stop All',
  'toggle-live': 'Toggle live / review',
  'transport-toggle': 'Start / pause simulation',
  'step-back': 'Step back one frame',
  'step-forward': 'Step forward one frame',
  'fit-field': 'Fit field to viewport',
  'mirror-x': 'Mirror X',
  'mirror-y': 'Mirror Y',
  'toggle-debug-layers': 'Toggle debug layers',
  'workspace-1': 'First workspace',
  'workspace-2': 'Second workspace',
  'workspace-3': 'Third workspace',
  'open-settings': 'Open settings',
}

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    shell: 'evolved',
    theme: 'evolved',
    shortcuts: { ...DEFAULT_SHORTCUTS },
    presets: [],
    density: 'theme',
    workstationLabel: null,
    activeWorkspaceId: 'live-ops',
    workspaces: defaultWorkspaces(),
    field: { ...DEFAULT_FIELD_SETTINGS },
    confirmEmergency: false,
    showAlertToasts: true,
  }
}

export const TOP_BAR_ITEM_LABELS: Record<TopBarItemId, string> = {
  brand: 'Brand mark',
  session: 'Session',
  'workspace-switcher': 'Workspace switcher',
  transport: 'Transport controls',
  speed: 'Simulation speed',
  'live-toggle': 'Live / review toggle',
  'return-to-live': 'Return to live',
  'field-mode': 'Focus / grid / compare',
  recording: 'Recording',
  export: 'Export',
  health: 'System health',
  alerts: 'Alerts',
  clients: 'Connected clients',
  latency: 'Latency',
  frame: 'Frame counter',
  'sim-time': 'Simulation time',
  'debug-token': 'Debug token',
  'command-palette': 'Command palette',
  settings: 'Settings',
  emergency: 'Halt / Stop',
  spacer: 'Flexible gap',
}
