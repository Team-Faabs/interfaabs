import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import type { PanelInstance } from '../docking/model'
import { FieldCanvas } from '../renderer/FieldCanvas'
import { useMeta } from '../store/hooks'
import { useOpenPanel } from '../shells/useShellActions'
import {
  Button,
  Field,
  IconButton,
  Popover,
  Segmented,
  Select,
  TextInput,
  Toggle,
} from '../ui/primitives'
import './field-panel.css'

const PANEL_ID = 'field'

export function FieldPanel({ instance }: { instance: PanelInstance }) {
  const meta = useMeta()
  const { config } = useConfig()
  const settings = config.field
  const [fitToken, setFitToken] = useState(0)

  // The fit shortcut is a window event rather than a prop, so every field
  // panel — including popped-out ones — refits without the shell needing to
  // know how many exist.
  useEffect(() => {
    const refit = () => setFitToken((token) => token + 1)
    window.addEventListener('interfaabs:fit-field', refit)
    return () => window.removeEventListener('interfaabs:fit-field', refit)
  }, [])

  const worldIds = useMemo(() => {
    const pinned = instance.params?.worldId
    if (typeof pinned === 'number') return [pinned]
    if (settings.multiWorld === 'compare') {
      return settings.compareWorldIds.filter((id) => meta.worldIds.includes(id))
    }
    // Focus honours an explicitly chosen world, and falls back to the lowest id
    // when that world disappears rather than showing nothing.
    if (settings.focusWorldId !== null && meta.worldIds.includes(settings.focusWorldId)) {
      return [settings.focusWorldId]
    }
    return meta.worldIds.slice(0, 1)
  }, [
    instance.params,
    meta.worldIds,
    settings.compareWorldIds,
    settings.focusWorldId,
    settings.multiWorld,
  ])

  if (meta.worldIds.length === 0) {
    return (
      <div className="fp">
        <FieldToolbar onFit={() => setFitToken((token) => token + 1)} />
        <div className="fp-empty">
          <b>No world</b>
          <span>
            The host has no world to show. Start a match or open a recording from Start
            Center; a viewer with no session shows nothing rather than a placeholder field.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="fp">
      <FieldToolbar onFit={() => setFitToken((token) => token + 1)} />
      {settings.multiWorld === 'grid' ? (
        <WorldGrid worldIds={meta.worldIds} />
      ) : (
        <FieldCanvas
          worldIds={worldIds}
          panelId={PANEL_ID}
          compare={settings.multiWorld === 'compare'}
          showStats={settings.showDrawStats}
          fitToken={fitToken}
        />
      )}
      {settings.multiWorld === 'compare' &&
        (worldIds.length === 0 ? (
          <div className="fp-overlay-note">
            Compare mode is never entered implicitly — choose worlds in field options.
          </div>
        ) : (
          <div className="fp-legend">
            {worldIds.map((worldId, index) => (
              <span key={worldId}>
                <i style={{ background: compareHue(index) }} />
                world {worldId}
              </span>
            ))}
          </div>
        ))}
    </div>
  )
}

/**
 * The history half of a live-versus-history pair. It renders whatever the host
 * has returned for the detached viewer cursor, so docking one of these beside
 * an ordinary Field panel gives the side-by-side comparison the plan asks for
 * without any special-case layout.
 */
export function HistoryFieldPanel() {
  const meta = useMeta()
  const { config } = useConfig()
  const cursor = meta.cursor

  const worldIds =
    config.field.multiWorld === 'compare'
      ? config.field.compareWorldIds
      : config.field.focusWorldId !== null
        ? [config.field.focusWorldId]
        : meta.worldIds.slice(0, 1)

  if (!cursor || cursor.live) {
    return (
      <div className="fp">
        <div className="fp-history-bar">
          <b>History</b>
          <span>following live</span>
        </div>
        <div className="fp-empty">
          <b>Nothing to compare against</b>
          <span>
            Scrub the timeline or detach the viewer cursor, and the state at that frame
            appears here beside the live field.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="fp">
      <div className="fp-history-bar">
        <b>History</b>
        <span className="ui-mono">frame {cursor.frame ?? 0}</span>
        <div className="fp-bar-grow" />
        <span className="ui-dim">read-only</span>
      </div>
      <FieldCanvas
        worldIds={worldIds}
        panelId="field-history"
        cursorId={cursor.id}
        interactive={false}
      />
    </div>
  )
}

/** Must match `comparePalette` in the renderer, so the legend does not lie. */
export function compareHue(index: number): string {
  if (index === 0) return 'var(--text)'
  return `hsl(${[200, 320, 90, 40, 260][(index - 1) % 5]} 70% 60%)`
}

function FieldToolbar({ onFit }: { onFit: () => void }) {
  const { config, updateField } = useConfig()
  const settings = config.field
  const meta = useMeta()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const burgerRef = useRef<HTMLButtonElement | null>(null)
  const openPanel = useOpenPanel()

  return (
    <div className="fp-bar">
      <Segmented
        size="sm"
        value={settings.multiWorld}
        onChange={(multiWorld) => updateField({ multiWorld })}
        options={[
          { value: 'focus', label: 'Focus', title: 'One world fills the field' },
          {
            value: 'grid',
            label: `Grid${meta.worldIds.length > 1 ? ` ${meta.worldIds.length}` : ''}`,
            title: 'Virtualised mini-fields',
          },
          {
            value: 'compare',
            label: 'Compare',
            title: 'Explicitly selected worlds, overlaid',
          },
        ]}
      />

      <div className="fp-bar-grow" />

      <span
        className="fp-hint"
        title="Drag a robot or the ball to move it · Alt-drag a robot to rotate it · Right-click for actions · Double-click to fit"
      >
        drag · alt-drag rotates · right-click
      </span>

      <span className="fp-readout ui-mono">
        {meta.cursor && !meta.cursor.live ? 'review' : 'live'}
        {settings.mirrorX || settings.mirrorY
          ? ` · mirrored ${settings.mirrorX ? 'X' : ''}${settings.mirrorY ? 'Y' : ''}`
          : ''}
      </span>

      <Button size="sm" onClick={onFit} title="Fit the field to the viewport (double-click)">
        Fit
      </Button>

      <IconButton
        ref={burgerRef}
        title="Field options"
        className={optionsOpen ? 'on' : ''}
        onClick={() => setOptionsOpen((open) => !open)}
      >
        ☰
      </IconButton>

      <Popover
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        anchor={burgerRef.current}
        align="end"
        width={300}
      >
        <FieldOptions
          onOpenSettings={() => {
            setOptionsOpen(false)
            openPanel('settings')
          }}
        />
      </Popover>
    </div>
  )
}

/**
 * The frequently-toggled subset. Everything here also lives in the Settings
 * panel, so nothing is reachable only through a popover.
 */
export function FieldOptions({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { config, updateField } = useConfig()
  const meta = useMeta()
  const settings = config.field

  return (
    <div className="fp-options">
      <div className="fp-options-group">
        <div className="fp-options-title">View</div>
        <Toggle
          checked={settings.mirrorX}
          onChange={(mirrorX) => updateField({ mirrorX })}
          label="Mirror X"
          hint="Viewport only — canonical and recorded state are untouched"
        />
        <Toggle
          checked={settings.mirrorY}
          onChange={(mirrorY) => updateField({ mirrorY })}
          label="Mirror Y"
          hint="Viewport only — canonical and recorded state are untouched"
        />
        <Toggle
          checked={settings.followBall}
          onChange={(followBall) => updateField({ followBall })}
          label="Follow ball"
        />
        <Toggle
          checked={settings.showFieldGrid}
          onChange={(showFieldGrid) => updateField({ showFieldGrid })}
          label="Metre grid"
        />
      </div>

      <div className="fp-options-group">
        <div className="fp-options-title">Overlays</div>
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
          label="Velocities"
        />
        <Toggle
          checked={settings.showConfidence}
          onChange={(showConfidence) => updateField({ showConfidence })}
          label="Confidence rings"
        />
        <Toggle
          checked={settings.showLabels}
          onChange={(showLabels) => updateField({ showLabels })}
          label="Labels"
        />
        <Toggle
          checked={settings.showRobotIds}
          onChange={(showRobotIds) => updateField({ showRobotIds })}
          label="Robot numbers"
        />
      </div>

      {settings.multiWorld === 'focus' && meta.worldIds.length > 1 && (
        <div className="fp-options-group">
          <div className="fp-options-title">Focused world</div>
          <Select
            value={settings.focusWorldId === null ? 'auto' : String(settings.focusWorldId)}
            onChange={(event) =>
              updateField({
                focusWorldId:
                  event.currentTarget.value === 'auto'
                    ? null
                    : Number(event.currentTarget.value),
              })
            }
          >
            <option value="auto">Lowest world id</option>
            {meta.worldIds.map((worldId) => (
              <option key={worldId} value={worldId}>
                World {worldId}
              </option>
            ))}
          </Select>
        </div>
      )}

      {config.field.multiWorld === 'compare' && (
        <div className="fp-options-group">
          <div className="fp-options-title">Compared worlds</div>
          {meta.worldIds.length === 0 && <span className="ui-dim">No worlds.</span>}
          {meta.worldIds.map((worldId) => (
            <Toggle
              key={worldId}
              checked={settings.compareWorldIds.includes(worldId)}
              onChange={(checked) =>
                updateField({
                  compareWorldIds: checked
                    ? [...settings.compareWorldIds, worldId]
                    : settings.compareWorldIds.filter((id) => id !== worldId),
                })
              }
              label={`World ${worldId}`}
            />
          ))}
        </div>
      )}

      <div className="fp-options-group">
        <div className="fp-options-title">Performance</div>
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
        <Toggle
          checked={settings.showDrawStats}
          onChange={(showDrawStats) => updateField({ showDrawStats })}
          label="Draw statistics"
        />
      </div>

      {onOpenSettings && (
        <div className="fp-options-foot">
          <Button size="sm" onClick={onOpenSettings}>
            All field settings…
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Grid mode. Tiles outside the scroll viewport are unmounted, so a batch with
 * many worlds costs only the render loops that are actually visible.
 */
function WorldGrid({ worldIds }: { worldIds: number[] }) {
  const { config, updateField } = useConfig()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState<Set<number>>(new Set())
  const shown = worldIds.slice(0, config.field.gridMaxTiles)

  const observe = useCallback((element: HTMLElement | null, worldId: number) => {
    if (!element) return
    element.dataset.worldId = String(worldId)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current)
          for (const entry of entries) {
            const worldId = Number((entry.target as HTMLElement).dataset.worldId)
            if (entry.isIntersecting) next.add(worldId)
            else next.delete(worldId)
          }
          return next
        })
      },
      { root: host, rootMargin: '160px' },
    )
    for (const tile of host.querySelectorAll('[data-world-id]')) observer.observe(tile)
    return () => observer.disconnect()
  }, [shown.length])

  return (
    <div className="fp-grid" ref={hostRef}>
      {shown.map((worldId) => (
        <div className="fp-tile" key={worldId} ref={(element) => observe(element, worldId)}>
          <div className="fp-tile-head">
            <span className="ui-mono">world {worldId}</span>
            <button
              onClick={() =>
                updateField({ multiWorld: 'focus', focusWorldId: worldId })
              }
              title="Focus this world"
            >
              ⤢
            </button>
          </div>
          {visible.has(worldId) ? (
            <FieldCanvas worldIds={[worldId]} panelId={PANEL_ID} interactive={false} />
          ) : (
            <div className="fp-tile-placeholder" />
          )}
        </div>
      ))}
    </div>
  )
}
