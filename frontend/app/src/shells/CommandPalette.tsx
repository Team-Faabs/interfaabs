import { useEffect, useMemo, useRef, useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import { availablePanels } from '../panels/registry'
import { useMeta, useStore } from '../store/hooks'
import { THEME_LIST } from '../theme/themes'
import { canMutate, systemIdOfKind } from '../util/systems'
import { useOpenPanel } from './useShellActions'
import './palette.css'

interface Command {
  id: string
  label: string
  group: string
  hint?: string
  run: () => void
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore()
  const meta = useMeta()
  const { config, update, updateField, setActiveWorkspace, resetWorkspace, workspace } =
    useConfig()
  const openPanel = useOpenPanel()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      // Focus after the element exists, so the first keystroke is never lost.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const simharkId = systemIdOfKind(meta, 'simhark')
    const crashPilotId = systemIdOfKind(meta, 'crash_pilot')
    const mutable = canMutate(meta)
    const list: Command[] = []

    for (const panel of Object.values(availablePanels(meta))) {
      list.push({
        id: `panel:${panel.id}`,
        label: `Open ${panel.title}`,
        group: 'Panel',
        hint: panel.description,
        run: () => openPanel(panel.id),
      })
    }

    for (const entry of config.workspaces) {
      list.push({
        id: `workspace:${entry.id}`,
        label: `Go to ${entry.label}`,
        group: 'Workspace',
        run: () => setActiveWorkspace(entry.id),
      })
    }

    list.push({
      id: 'shell:evolved',
      label: 'Shell: Evolved',
      group: 'Appearance',
      run: () => update({ shell: 'evolved' }),
    })
    list.push({
      id: 'shell:brief',
      label: 'Shell: Brief',
      group: 'Appearance',
      run: () => update({ shell: 'brief' }),
    })
    for (const theme of THEME_LIST) {
      list.push({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.label}`,
        group: 'Appearance',
        hint: theme.description,
        run: () => update({ theme: theme.id }),
      })
    }
    for (const [scheme, label, hint] of [
      ['light', 'Light', 'Force the light scheme'],
      ['dark', 'Dark', 'Force the dark scheme'],
      ['system', 'Follow the system', 'Track the operating system’s appearance setting'],
    ] as const) {
      list.push({
        id: `scheme:${scheme}`,
        label: `Colour scheme: ${label}`,
        group: 'Appearance',
        hint,
        run: () => update({ colorScheme: scheme }),
      })
    }

    if (crashPilotId && mutable) {
      list.push({
        id: 'halt',
        label: 'Halt All',
        group: 'Emergency',
        run: () =>
          store.send('palette', {
            type: 'system',
            data: {
              system_id: crashPilotId,
              command: { type: 'crash_pilot', data: { type: 'halt_all' } },
            },
          }),
      })
      list.push({
        id: 'stop',
        label: 'Stop All',
        group: 'Emergency',
        run: () =>
          store.send('palette', {
            type: 'system',
            data: {
              system_id: crashPilotId,
              command: { type: 'crash_pilot', data: { type: 'stop_all' } },
            },
          }),
      })
    }

    if (simharkId && mutable) {
      for (const action of ['start', 'pause', 'stop', 'restart'] as const) {
        list.push({
          id: `sim:${action}`,
          label: `Simulation: ${action}`,
          group: 'Transport',
          run: () =>
            store.send('palette', {
              type: 'system',
              data: {
                system_id: simharkId,
                command: { type: 'simhark', data: { type: action } },
              },
            }),
        })
      }
    }

    list.push({
      id: 'field:mirrorX',
      label: `${config.field.mirrorX ? 'Disable' : 'Enable'} mirror X`,
      group: 'Field',
      run: () => updateField({ mirrorX: !config.field.mirrorX }),
    })
    list.push({
      id: 'field:mirrorY',
      label: `${config.field.mirrorY ? 'Disable' : 'Enable'} mirror Y`,
      group: 'Field',
      run: () => updateField({ mirrorY: !config.field.mirrorY }),
    })
    list.push({
      id: 'field:debug',
      label: `${config.field.showDebugOverlays ? 'Hide' : 'Show'} debug layers`,
      group: 'Field',
      run: () => updateField({ showDebugOverlays: !config.field.showDebugOverlays }),
    })
    list.push({
      id: 'field:follow',
      label: `${config.field.followBall ? 'Stop following' : 'Follow'} the ball`,
      group: 'Field',
      run: () => updateField({ followBall: !config.field.followBall }),
    })

    if (meta.cursor && !meta.cursor.live) {
      list.push({
        id: 'cursor:live',
        label: 'Return to live',
        group: 'Review',
        run: () => store.setLive('palette', true),
      })
    }

    if (workspace.builtin) {
      list.push({
        id: 'layout:reset',
        label: `Reset ${workspace.label} layout`,
        group: 'Workspace',
        run: () => resetWorkspace(workspace.id),
      })
    }

    return list
  }, [
    config,
    meta,
    openPanel,
    resetWorkspace,
    setActiveWorkspace,
    store,
    update,
    updateField,
    workspace,
  ])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands.slice(0, 40)
    return commands
      .map((command) => ({ command, score: score(command, needle) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((entry) => entry.command)
  }, [commands, query])

  if (!open) return null

  const choose = (command: Command | undefined) => {
    if (!command) return
    command.run()
    onClose()
  }

  return (
    <div className="pal-backdrop" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="Type a command…"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((current) => Math.min(matches.length - 1, current + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((current) => Math.max(0, current - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(matches[index])
            } else if (event.key === 'Escape') {
              onClose()
            }
          }}
        />
        <div className="pal-list">
          {matches.length === 0 && <div className="pal-empty">No matching command.</div>}
          {matches.map((command, position) => (
            <button
              key={command.id}
              className={`pal-item ${position === index ? 'is-active' : ''}`}
              onMouseEnter={() => setIndex(position)}
              onClick={() => choose(command)}
            >
              <span className="pal-group">{command.group}</span>
              <span className="pal-label">{command.label}</span>
              {command.hint && <span className="pal-hint">{command.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Subsequence match, favouring prefix and word-boundary hits. */
function score(command: Command, needle: string): number {
  const haystack = `${command.group} ${command.label}`.toLowerCase()
  const direct = haystack.indexOf(needle)
  if (direct === 0) return 100
  if (direct > 0) return haystack[direct - 1] === ' ' ? 80 : 60

  let index = 0
  for (const character of needle) {
    index = haystack.indexOf(character, index)
    if (index === -1) return 0
    index += 1
  }
  return 20
}
