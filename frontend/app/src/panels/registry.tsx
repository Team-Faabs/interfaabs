import type { PanelDescriptor } from '../docking/Dock'
import type { PanelInstance } from '../docking/model'
import type { MetaState } from '../store/store'
import { AiLabPanel } from './AiLabPanel'
import { FieldPanel, HistoryFieldPanel } from './FieldPanel'
import { ReferrisPanel } from './ReferrisPanel'
import { WorldsPanel } from './WorldsPanel'
import { SettingsPanel } from './SettingsPanel'
import { StartCenterPanel } from './StartCenterPanel'
import { TestsPanel } from './TestsPanel'
import { AlertsList, CommandFeedPanel, EventsPanel, TimelinePanel } from './feeds'
import { DebugValuesPanel, PropertiesPanel, RefereePanel, TasksPanel } from './inspect'
import {
  DiagnosticsPanel,
  LayersPanel,
  RecordingsPanel,
  SessionsPanel,
  SystemsPanel,
} from './nav'

function simple(
  id: string,
  title: string,
  icon: string,
  render: () => React.ReactNode,
  description?: string,
): PanelDescriptor {
  return { id, title, icon, description, render: () => render() }
}

export const PANEL_REGISTRY: Record<string, PanelDescriptor> = {
  field: {
    id: 'field',
    title: 'Field',
    icon: '◎',
    description: 'Canvas field with overlays, picking and multi-world modes',
    render: (instance: PanelInstance) => <FieldPanel instance={instance} />,
  },
  'field-history': simple(
    'field-history',
    'History',
    '◐',
    () => <HistoryFieldPanel />,
    'The field at the detached cursor, for live-versus-history comparison',
  ),
  properties: simple(
    'properties',
    'Properties',
    '⚙',
    () => <PropertiesPanel />,
    'The canonical command builder and global CrashPilot options',
  ),
  tasks: simple('tasks', 'Tasks', '☰', () => <TasksPanel />, 'Per-robot state, task and tracking'),
  referee: simple('referee', 'Referee', '⚑', () => <RefereePanel />, 'Referee stage, command and score'),
  'command-feed': simple(
    'command-feed',
    'Command feed',
    '⇄',
    () => <CommandFeedPanel />,
    'Every command with its origin and acknowledgement',
  ),
  events: simple('events', 'Events', '◇', () => <EventsPanel />, 'Match, lifecycle and problem events'),
  timeline: simple('timeline', 'Timeline', '⏱', () => <TimelinePanel />, 'Scrub, bookmark and return to live'),
  layers: simple('layers', 'Layers', '≡', () => <LayersPanel />, 'Debug layer hierarchy, solo and opacity'),
  'debug-values': simple(
    'debug-values',
    'Debug values',
    '∑',
    () => <DebugValuesPanel />,
    'Scalar debug values with units and ranges',
  ),
  systems: simple('systems', 'Systems', '◈', () => <SystemsPanel />, 'Registered systems, health and capabilities'),
  sessions: simple('sessions', 'Sessions', '▤', () => <SessionsPanel />, 'Sessions and their lifecycle'),
  recordings: simple('recordings', 'Recordings', '◉', () => <RecordingsPanel />, 'Recording control and export'),
  alerts: simple('alerts', 'Alerts', '▲', () => <AlertsList />, 'Health, recording and data-loss alerts'),
  diagnostics: simple(
    'diagnostics',
    'Diagnostics',
    '⚕',
    () => <DiagnosticsPanel />,
    'Protocol, build fingerprints and the debug token',
  ),
  worlds: simple(
    'worlds',
    'Worlds',
    '▦',
    () => <WorldsPanel />,
    'World selection, session lifecycle and cancellation',
  ),
  developer: simple(
    'developer',
    'AI Lab',
    '⚗',
    () => <AiLabPanel />,
    'Browse the skill and play registry, then load and run one entry',
  ),
  tests: simple(
    'tests',
    'Tests',
    '✓',
    () => <TestsPanel />,
    'Test suite status, filtering and failed-world focus',
  ),
  referris: simple(
    'referris',
    'Referris',
    '⚖',
    () => <ReferrisPanel />,
    'Referris state, events and lifecycle control',
  ),
  'start-center': simple(
    'start-center',
    'Start Center',
    '★',
    () => <StartCenterPanel />,
    'Create sessions and inspect available controllers',
  ),
  settings: simple(
    'settings',
    'Settings',
    '⚙',
    () => <SettingsPanel />,
    'Shell, theme, top bar, workspaces and field options',
  ),
}

export const PANEL_LIST = Object.values(PANEL_REGISTRY)

/**
 * Panels that only exist when the host advertises the system behind them. The
 * plan requires all Referris UI to be hidden when Referris is unavailable, so
 * it is dropped from the add-panel menu and the command palette rather than
 * offered and then apologising.
 */
export function availablePanels(meta: MetaState): Record<string, PanelDescriptor> {
  if (meta.systems.some((system) => system.kind === 'referris')) return PANEL_REGISTRY
  const { referris: _hidden, ...rest } = PANEL_REGISTRY
  return rest
}
