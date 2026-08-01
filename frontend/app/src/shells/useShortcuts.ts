// Configurable keyboard shortcuts.
//
// Bindings are chord strings (`ctrl+k`, `shift+x`, `space`) stored in the
// config, so they survive reloads and travel with an exported workspace. An
// empty binding is unbound — which is the default for the emergency actions,
// because a stray keystroke must never halt a live match.

import { useEffect } from 'react'

import { useConfig } from '../config/ConfigContext'
import type { ShortcutAction } from '../config/types'

export function chordOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

const PRETTY: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  space: 'Space',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
}

export function formatChord(chord: string): string {
  if (chord === '') return 'unbound'
  return chord
    .split('+')
    .map((part) => PRETTY[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(' + ')
}

/** True while the user is typing, so shortcuts do not steal their keystrokes. */
function inTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  )
}

export function useShortcuts(handlers: Partial<Record<ShortcutAction, () => void>>): void {
  const { config } = useConfig()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event.target)) return
      const chord = chordOf(event)
      for (const [action, binding] of Object.entries(config.shortcuts)) {
        if (binding === '' || binding !== chord) continue
        const handler = handlers[action as ShortcutAction]
        if (!handler) continue
        event.preventDefault()
        handler()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [config.shortcuts, handlers])
}
