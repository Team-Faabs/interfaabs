// One settings surface for everything that is otherwise only reachable from a
// popover: appearance, the configurable top bar, workspaces and layouts, the
// full field option set, and storage.

import { useEffect, useRef, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  TOP_BAR_ITEM_LABELS,
  defaultWorkspaces,
} from '../config/defaults'
import type {
  ColorScheme,
  ShellId,
  ShortcutAction,
  ThemeId,
  TopBarItemId,
  WorkspaceConfig,
} from '../config/types'
import { chordOf, formatChord } from '../shells/useShortcuts'
import {
  clearStoredConfig,
  downloadJson,
  exportWorkspaces,
  importWorkspaces,
} from '../config/persistence'
import { nextId } from '../docking/model'
import { COLOR_PRESETS, THEMES, THEME_LIST } from '../theme/themes'
import { useSystemScheme, useTheme } from '../theme/ThemeProvider'
import { parseColor, toHex } from '../theme/color'
import { useStore } from '../store/hooks'
import {
  Button,
  Field,
  IconButton,
  Segmented,
  Select,
  TextInput,
  Toggle,
} from '../ui/primitives'
import './settings.css'

const SHELLS: Array<{ id: ShellId; label: string; description: string }> = [
  {
    id: 'evolved',
    label: 'Evolved',
    description:
      'Dense top toolbar, collapsing icon rails on both sides, bottom dock and a status bar. Everything is reachable without switching context.',
  },
  {
    id: 'brief',
    label: 'Brief',
    description:
      'One job at a time. A single header line with a segmented workspace control, one companion rail, and a permanent timeline. Density drops by hiding whole jobs.',
  },
]

type Section =
  | 'appearance'
  | 'topbar'
  | 'workspaces'
  | 'shortcuts'
  | 'field'
  | 'connection'
  | 'storage'

export function SettingsPanel() {
  const [section, setSection] = useState<Section>('appearance')

  return (
    <div className="set">
      <nav className="set-nav">
        {(
          [
            ['appearance', 'Appearance'],
            ['topbar', 'Top bar'],
            ['workspaces', 'Workspaces'],
            ['shortcuts', 'Shortcuts'],
            ['field', 'Field'],
            ['connection', 'Connection'],
            ['storage', 'Storage'],
          ] as Array<[Section, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            className={section === id ? 'is-active' : ''}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="set-body ui-scroll">
        {section === 'appearance' && <Appearance />}
        {section === 'topbar' && <TopBarEditor />}
        {section === 'workspaces' && <Workspaces />}
        {section === 'shortcuts' && <Shortcuts />}
        {section === 'field' && <FieldSettingsSection />}
        {section === 'connection' && <Connection />}
        {section === 'storage' && <Storage />}
      </div>
    </div>
  )
}

function Appearance() {
  const { config, update } = useConfig()
  const theme = useTheme()
  const systemScheme = useSystemScheme()
  /** The active theme's own colours for the active scheme — the "default". */
  const skin = THEMES[config.theme][theme.scheme]

  return (
    <>
      <h2>Shell</h2>
      <p className="set-hint">
        The shell decides the chrome — how the top bar and the side rails are arranged. It says
        nothing about colour, so shell and theme combine freely.
      </p>
      <div className="set-cards">
        {SHELLS.map((shell) => (
          <button
            key={shell.id}
            className={`set-card ${config.shell === shell.id ? 'is-active' : ''}`}
            onClick={() => update({ shell: shell.id })}
          >
            <b>{shell.label}</b>
            <span>{shell.description}</span>
          </button>
        ))}
      </div>

      <h2>Colour scheme</h2>
      <p className="set-hint">
        Every theme is authored twice, so the scheme is a free axis: keep the look you know and
        take it light for a bright hall or dark for an evening match.
      </p>
      <div className="set-row">
        <Segmented<ColorScheme>
          value={config.colorScheme}
          onChange={(colorScheme) => update({ colorScheme })}
          options={[
            {
              value: 'system',
              label: `System (${systemScheme})`,
              title: 'Follow the operating system’s appearance setting',
            },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      <h2>Theme</h2>
      <p className="set-hint">
        The theme carries the neutrals, the radius and the chrome weight. Console and Studio are
        looks, not layouts: either shell can wear either one. The swatches preview each theme in
        the scheme that is currently active.
      </p>
      <div className="set-cards">
        {THEME_LIST.map((entry) => {
          const skin = entry[theme.scheme]
          return (
            <button
              key={entry.id}
              className={`set-card ${config.theme === entry.id ? 'is-active' : ''}`}
              onClick={() => update({ theme: entry.id as ThemeId })}
            >
              <span className="set-swatches">
                {[
                  skin.vars['--bg'],
                  skin.vars['--surface-2'],
                  // What this theme would actually wear: the operator's colour
                  // if they have chosen one, the theme's own if they have not.
                  config.primaryColor ?? skin.primary,
                  config.accentColor ?? skin.accent,
                  skin.field.pitch,
                ].map((colour, index) => (
                  <i key={index} style={{ background: colour }} />
                ))}
              </span>
              <b>{entry.label}</b>
              <span>{entry.description}</span>
            </button>
          )
        })}
      </div>

      <h2>Colours</h2>
      <p className="set-hint">
        The primary carries actions and selection; the accent marks secondary values and the kick
        overlay on the field. Both are darkened or lightened as far as legibility on this theme
        requires, so no choice can leave a control unreadable. Team blue, team yellow and the ball
        keep their real colours — they describe the world, not the interface.
      </p>
      <div className="set-colours">
        <ColorControl
          label="Primary"
          value={config.primaryColor}
          themeDefault={skin.primary}
          chosen={theme.chosen.primary}
          effective={theme.effective.primary}
          onChange={(primaryColor) => update({ primaryColor })}
        />
        <ColorControl
          label="Accent"
          value={config.accentColor}
          themeDefault={skin.accent}
          chosen={theme.chosen.accent}
          effective={theme.effective.accent}
          onChange={(accentColor) => update({ accentColor })}
        />
      </div>
      <div className="set-preview">
        <span className="set-preview-chip set-preview-chip--primary">Primary</span>
        <span className="set-preview-chip set-preview-chip--accent">Accent</span>
        <span className="set-preview-chip set-preview-chip--soft">Selected row</span>
        <span className="set-preview-link">Accent as text</span>
      </div>
      <div className="set-actions">
        <Button
          disabled={config.primaryColor === null && config.accentColor === null}
          onClick={() => update({ primaryColor: null, accentColor: null })}
        >
          Use this theme’s colours
        </Button>
      </div>

      <h2>Density</h2>
      <div className="set-row">
        <Field label="Row and control sizing">
          <Select
            value={config.density}
            onChange={(event) =>
              update({ density: event.currentTarget.value as typeof config.density })
            }
          >
            <option value="theme">Follow the theme</option>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </Select>
        </Field>
      </div>

      <div className="set-toggles">
        <Toggle
          checked={config.showAlertToasts}
          onChange={(showAlertToasts) => update({ showAlertToasts })}
          label="Floating alert toasts"
        />
        <Toggle
          checked={config.confirmEmergency}
          onChange={(confirmEmergency) => update({ confirmEmergency })}
          label="Confirm Halt All and Stop All"
          hint="Off by default: an emergency stop should never need a second click"
        />
      </div>
    </>
  )
}

/**
 * One colour: presets for the common choice, a native picker for the arbitrary
 * one, and a hex field for the team colour someone already has written down.
 * `null` means "whatever the theme suggests", which is a real state rather than
 * a synonym for the default hex — it keeps following the theme as the operator
 * tries others.
 */
function ColorControl({
  label,
  value,
  themeDefault,
  chosen,
  effective,
  onChange,
}: {
  label: string
  value: string | null
  themeDefault: string
  /** What was asked for, normalised to hex. */
  chosen: string
  /** What is on screen after the legibility adjustment. */
  effective: string
  onChange: (value: string | null) => void
}) {
  const current = value ?? themeDefault
  const [draft, setDraft] = useState(current)

  // The hex field is free text while it is being typed, so it has to be pulled
  // back into line when the colour changes from anywhere else — a preset, the
  // native picker, a theme switch, or the reset button.
  useEffect(() => setDraft(current), [current])

  const commit = (text: string) => {
    setDraft(text)
    const parsed = parseColor(text)
    if (parsed) onChange(toHex(parsed))
  }

  const adjusted = chosen.toLowerCase() !== effective.toLowerCase()

  return (
    <div className="set-colour">
      <div className="set-colour-head">
        <b>{label}</b>
        <i>{value === null ? 'following the theme' : 'custom'}</i>
      </div>

      <div className="set-presets">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={`set-preset ${
              current.toLowerCase() === preset.value.toLowerCase() ? 'is-active' : ''
            }`}
            style={{ background: preset.value }}
            title={preset.label}
            aria-label={`${label}: ${preset.label}`}
            onClick={() => onChange(preset.value)}
          />
        ))}
      </div>

      <div className="set-colour-row">
        <input
          type="color"
          className="set-swatch-input"
          value={current}
          aria-label={`${label} colour`}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <TextInput
          value={draft}
          spellCheck={false}
          aria-label={`${label} hex value`}
          placeholder={themeDefault}
          onChange={(event) => commit(event.currentTarget.value)}
          onBlur={() => setDraft(current)}
        />
        <Button size="sm" disabled={value === null} onClick={() => onChange(null)}>
          Default
        </Button>
      </div>

      {adjusted && (
        <p className="set-note">
          <b>Adjusted to {effective}</b> — {chosen} does not hold up against this theme’s
          surfaces, so it was {isLightened(chosen, effective) ? 'lightened' : 'darkened'} until it
          did. Pick a stronger shade to keep it exactly as chosen.
        </p>
      )}
    </div>
  )
}

/** Which way `ensureContrast` moved a colour, for the explanation above. */
function isLightened(from: string, to: string): boolean {
  const a = parseColor(from)
  const b = parseColor(to)
  if (!a || !b) return false
  return b.r + b.g + b.b > a.r + a.g + a.b
}

function TopBarEditor() {
  const { config, workspace, updateWorkspace } = useConfig()
  const items = workspace.topBar
  const missing = (Object.keys(TOP_BAR_ITEM_LABELS) as TopBarItemId[]).filter(
    (id) => id === 'spacer' || !items.some((item) => item.id === id),
  )

  const setItems = (next: typeof items) => updateWorkspace(workspace.id, { topBar: next })

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [entry] = next.splice(index, 1)
    next.splice(target, 0, entry)
    setItems(next)
  }

  return (
    <>
      <h2>Top bar · {workspace.label}</h2>
      <p className="set-hint">
        Each workspace owns its own top bar, so Start Center need not carry transport controls
        it cannot use. Reorder with the arrows, hide with the toggle, remove with ×.
      </p>

      <div className="set-list">
        {items.map((item, index) => (
          <div className="set-listrow" key={`${item.id}-${index}`}>
            <span className="set-listlabel">{TOP_BAR_ITEM_LABELS[item.id]}</span>
            <Toggle
              checked={item.visible}
              onChange={(visible) =>
                setItems(items.map((entry, i) => (i === index ? { ...entry, visible } : entry)))
              }
              label=""
            />
            <IconButton title="Move earlier" onClick={() => move(index, -1)}>
              ↑
            </IconButton>
            <IconButton title="Move later" onClick={() => move(index, 1)}>
              ↓
            </IconButton>
            <IconButton
              title="Remove"
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              ×
            </IconButton>
          </div>
        ))}
        {items.length === 0 && <p className="set-hint">The top bar is empty.</p>}
      </div>

      <h2>Add</h2>
      <div className="set-chips">
        {missing.map((id) => (
          <button
            key={id}
            className="set-chip"
            onClick={() => setItems([...items, { id, visible: true }])}
          >
            + {TOP_BAR_ITEM_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="set-actions">
        <Button
          onClick={() => {
            const pristine = defaultWorkspaces().find((entry) => entry.id === workspace.id)
            if (pristine) updateWorkspace(workspace.id, { topBar: pristine.topBar })
          }}
          disabled={!config.workspaces.some((entry) => entry.id === workspace.id && entry.builtin)}
        >
          Reset to default
        </Button>
      </div>
    </>
  )
}

function Workspaces() {
  const {
    config,
    workspace,
    addWorkspace,
    removeWorkspace,
    resetWorkspace,
    setActiveWorkspace,
    updateWorkspace,
  } = useConfig()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <h2>Workspaces</h2>
      <p className="set-hint">
        One layout per workspace. Built-in workspaces can be rearranged and reset but not
        deleted; anything you build yourself can be saved, exported and shared.
      </p>

      <div className="set-list">
        {config.workspaces.map((entry) => (
          <div
            className={`set-listrow ${entry.id === config.activeWorkspaceId ? 'is-active' : ''}`}
            key={entry.id}
          >
            <button className="set-listmain" onClick={() => setActiveWorkspace(entry.id)}>
              <b>{entry.label}</b>
              <i>
                {entry.kind}
                {entry.builtin ? ' · built-in' : ''}
              </i>
            </button>
            {entry.builtin ? (
              <Button size="sm" onClick={() => resetWorkspace(entry.id)}>
                Reset
              </Button>
            ) : (
              <Button size="sm" tone="danger" onClick={() => removeWorkspace(entry.id)}>
                Delete
              </Button>
            )}
          </div>
        ))}
      </div>

      <h2>Current workspace</h2>
      <div className="set-row">
        <Field label="Label">
          <TextInput
            value={workspace.label}
            onChange={(event) =>
              updateWorkspace(workspace.id, { label: event.currentTarget.value })
            }
          />
        </Field>
      </div>

      <div className="set-actions">
        <Button
          onClick={() =>
            addWorkspace({
              ...workspace,
              id: nextId('workspace'),
              label: `${workspace.label} copy`,
              kind: 'custom',
              builtin: false,
            })
          }
        >
          Duplicate as custom
        </Button>
        <Button
          onClick={() =>
            downloadJson(
              `interfaabs-workspaces-${new Date().toISOString().slice(0, 10)}.json`,
              exportWorkspaces(config.workspaces),
            )
          }
        >
          Export all
        </Button>
        <Button onClick={() => fileRef.current?.click()}>Import…</Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            try {
              const imported: WorkspaceConfig[] = importWorkspaces(await file.text())
              for (const entry of imported) addWorkspace(entry)
              setError(null)
            } catch (importError) {
              setError(importError instanceof Error ? importError.message : String(importError))
            }
          }}
        />
      </div>
      {error && <p className="set-error">{error}</p>}
    </>
  )
}

function Shortcuts() {
  const { config, update } = useConfig()
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null)

  const bind = (action: ShortcutAction, chord: string) =>
    update({ shortcuts: { ...config.shortcuts, [action]: chord } })

  // Two actions on the same chord would fire unpredictably, so binding one
  // clears the other rather than silently shadowing it.
  const bindExclusive = (action: ShortcutAction, chord: string) => {
    const next = { ...config.shortcuts }
    for (const key of Object.keys(next) as ShortcutAction[]) {
      if (next[key] === chord) next[key] = ''
    }
    next[action] = chord
    update({ shortcuts: next })
  }

  return (
    <>
      <h2>Shortcuts</h2>
      <p className="set-hint">
        Click a binding and press the keys you want. Halt All and Stop All are unbound by
        default — a stray keystroke should not stop a live match — but you can bind them here.
      </p>

      <div className="set-list">
        {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
          <div className="set-listrow" key={action}>
            <span className="set-listlabel">{SHORTCUT_LABELS[action]}</span>
            <button
              className={`set-chord ${capturing === action ? 'is-capturing' : ''}`}
              onClick={() => setCapturing(capturing === action ? null : action)}
              onKeyDown={(event) => {
                if (capturing !== action) return
                event.preventDefault()
                if (event.key === 'Escape') {
                  setCapturing(null)
                  return
                }
                if (event.key === 'Backspace' || event.key === 'Delete') {
                  bind(action, '')
                  setCapturing(null)
                  return
                }
                const chord = chordOf(event.nativeEvent)
                // Ignore a lone modifier: the operator is still mid-chord.
                if (['ctrl', 'alt', 'shift'].includes(chord)) return
                bindExclusive(action, chord)
                setCapturing(null)
              }}
            >
              {capturing === action ? 'press keys…' : formatChord(config.shortcuts[action])}
            </button>
            <IconButton title="Clear binding" onClick={() => bind(action, '')}>
              ×
            </IconButton>
          </div>
        ))}
      </div>

      <div className="set-actions">
        <Button onClick={() => update({ shortcuts: { ...DEFAULT_SHORTCUTS } })}>
          Reset to defaults
        </Button>
      </div>
    </>
  )
}

function FieldSettingsSection() {
  const { config, updateField } = useConfig()
  const settings = config.field

  return (
    <>
      <h2>Viewport</h2>
      <p className="set-hint">
        Mirroring and field side affect only the viewport transform. They never mutate
        canonical or recorded state.
      </p>
      <div className="set-toggles">
        <Toggle checked={settings.mirrorX} onChange={(mirrorX) => updateField({ mirrorX })} label="Mirror X" />
        <Toggle checked={settings.mirrorY} onChange={(mirrorY) => updateField({ mirrorY })} label="Mirror Y" />
        <Toggle
          checked={settings.followBall}
          onChange={(followBall) => updateField({ followBall })}
          label="Follow the ball"
        />
        <Toggle
          checked={settings.showFieldGrid}
          onChange={(showFieldGrid) => updateField({ showFieldGrid })}
          label="Metre grid"
        />
        <Toggle
          checked={settings.showCoordinateHints}
          onChange={(showCoordinateHints) => updateField({ showCoordinateHints })}
          label="Axis hints"
        />
        <Toggle
          checked={settings.showGoalHighlights}
          onChange={(showGoalHighlights) => updateField({ showGoalHighlights })}
          label="Colour the goals by team"
        />
      </div>

      <h2>Overlays</h2>
      <div className="set-toggles">
        <Toggle
          checked={settings.showDebugOverlays}
          onChange={(showDebugOverlays) => updateField({ showDebugOverlays })}
          label="Debug layers"
        />
        <Toggle
          checked={settings.showHeatmaps}
          onChange={(showHeatmaps) => updateField({ showHeatmaps })}
          label="Heatmaps"
        />
        <Toggle
          checked={settings.showVelocities}
          onChange={(showVelocities) => updateField({ showVelocities })}
          label="Velocity vectors"
        />
        <Toggle
          checked={settings.showConfidence}
          onChange={(showConfidence) => updateField({ showConfidence })}
          label="Confidence rings"
        />
        <Toggle
          checked={settings.showLabels}
          onChange={(showLabels) => updateField({ showLabels })}
          label="Text labels"
        />
        <Toggle
          checked={settings.showRobotIds}
          onChange={(showRobotIds) => updateField({ showRobotIds })}
          label="Robot numbers"
        />
      </div>

      <h2>Multi-world</h2>
      <div className="set-row">
        <Field label="Mode">
          <Select
            value={settings.multiWorld}
            onChange={(event) =>
              updateField({
                multiWorld: event.currentTarget.value as typeof settings.multiWorld,
              })
            }
          >
            <option value="focus">Focus — one world fills the field</option>
            <option value="grid">Grid — virtualised mini-fields</option>
            <option value="compare">Compare — explicitly selected worlds</option>
          </Select>
        </Field>
        <Field label="Maximum grid tiles">
          <TextInput
            type="number"
            min={1}
            max={200}
            value={settings.gridMaxTiles}
            onChange={(event) =>
              updateField({ gridMaxTiles: Number(event.currentTarget.value) || 1 })
            }
          />
        </Field>
      </div>

      <h2>Rendering</h2>
      <div className="set-row">
        <Field label="Frame cap">
          <Select
            value={String(settings.maxFps)}
            onChange={(event) => updateField({ maxFps: Number(event.currentTarget.value) })}
          >
            <option value="30">30 fps</option>
            <option value="60">60 fps</option>
            <option value="120">120 fps</option>
          </Select>
        </Field>
        <Field label="Ball trail (frames)">
          <TextInput
            type="number"
            min={0}
            max={240}
            value={settings.ballTrailFrames}
            onChange={(event) =>
              updateField({ ballTrailFrames: Number(event.currentTarget.value) || 0 })
            }
          />
        </Field>
      </div>
      <div className="set-toggles">
        <Toggle
          checked={settings.showDrawStats}
          onChange={(showDrawStats) => updateField({ showDrawStats })}
          label="Show draw statistics"
          hint="Draw time, call count and batch count, for the performance gate"
        />
      </div>
    </>
  )
}

function Connection() {
  const { config, update } = useConfig()
  const store = useStore()

  return (
    <>
      <h2>This workstation</h2>
      <p className="set-hint">
        The label travels with every command as part of its origin. It is operational
        observability, not authentication — any connected browser may issue any allowed
        command.
      </p>
      <div className="set-row">
        <Field label="Workstation label">
          <TextInput
            value={config.workstationLabel ?? ''}
            placeholder="e.g. bench-left"
            onChange={(event) => {
              const value = event.currentTarget.value
              update({ workstationLabel: value === '' ? null : value })
              store.workstationLabel = value === '' ? null : value
            }}
          />
        </Field>
      </div>

      <h2>Browser instance</h2>
      <div className="ui-kv">
        <div>
          <span>Instance id</span>
          <b>{store.client.browserInstanceId}</b>
        </div>
      </div>
    </>
  )
}

function Storage() {
  const { config, recovered, dismissRecovered, resetAll } = useConfig()

  return (
    <>
      <h2>Local storage</h2>
      <p className="set-hint">
        Shell, theme, workspaces, layouts and field options are stored in this browser under a
        versioned key and migrated on load. A value that cannot be migrated is quarantined
        rather than discarded.
      </p>
      {recovered && (
        <div className="set-recovered">
          <b>Stored configuration was recovered</b>
          <span>{recovered}</span>
          <Button size="sm" onClick={dismissRecovered}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="ui-kv">
        <div>
          <span>Config version</span>
          <b>{config.version}</b>
        </div>
        <div>
          <span>Workspaces</span>
          <b>{config.workspaces.length}</b>
        </div>
      </div>
      <div className="set-actions">
        <Button onClick={resetAll}>Reset all layouts</Button>
        <Button
          tone="danger"
          onClick={() => {
            clearStoredConfig()
            window.location.reload()
          }}
        >
          Clear stored configuration and reload
        </Button>
      </div>
    </>
  )
}
