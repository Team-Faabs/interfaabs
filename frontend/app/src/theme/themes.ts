// Themes carry colour, radius, density and chrome weight — everything that
// made the six mockups look different, minus their layout. A theme is a flat
// bag of CSS custom properties plus a field palette handed to the canvas
// renderer, so both shells can wear any of them.

import type { ThemeId } from '../config/types'

export interface FieldPalette {
  pitch: string
  boundary: string
  line: string
  grid: string
  blue: string
  yellow: string
  ball: string
  target: string
  kick: string
  select: string
  uncertain: string
  velocity: string
  robotEdge: string
  robotLabel: string
  heat: string
  zone: string
  keepout: string
  fieldText: string
  alert: string
  debug: string
}

export interface Theme {
  id: ThemeId
  label: string
  description: string
  /** `dark` or `light`, for the colour-scheme hint and canvas defaults. */
  scheme: 'dark' | 'light'
  density: 'comfortable' | 'compact'
  vars: Record<string, string>
  field: FieldPalette
}

const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"

const EVOLVED: Theme = {
  id: 'evolved',
  label: 'Evolved',
  description:
    'Deep navy, rounded surfaces, gradients and glow accents. The refined descendant of the current interface.',
  scheme: 'dark',
  density: 'comfortable',
  vars: {
    '--bg': '#07111f',
    '--surface': '#0d1829',
    '--surface-2': '#111f35',
    '--surface-3': '#16263f',
    '--line': 'rgba(160, 189, 255, 0.13)',
    '--line-soft': 'rgba(160, 189, 255, 0.07)',
    '--text': '#edf4ff',
    '--muted': '#8ea3c7',
    '--dim': '#62759a',
    '--accent': '#5f76ff',
    '--accent-ink': '#ffffff',
    '--accent-2': '#32d7c4',
    '--danger': '#ff5f6d',
    '--danger-ink': '#ffffff',
    '--warn': '#ffb74d',
    '--warn-ink': '#241701',
    '--ok': '#4ade80',
    '--radius': '9px',
    '--radius-sm': '6px',
    '--radius-lg': '14px',
    '--control-h': '28px',
    '--row-h': '26px',
    '--font': SANS,
    '--font-mono': MONO,
    '--font-size': '13px',
    '--font-size-sm': '11.5px',
    '--font-size-xs': '10px',
    '--chrome-bg':
      'linear-gradient(180deg, rgba(16, 29, 51, 0.95), rgba(9, 17, 30, 0.95))',
    '--app-bg':
      'radial-gradient(circle at 12% -10%, rgba(93, 135, 255, 0.16), transparent 34%),' +
      'radial-gradient(circle at 92% -6%, rgba(57, 227, 186, 0.1), transparent 32%),' +
      'linear-gradient(180deg, #08111f 0%, #07111a 40%, #050b14 100%)',
    '--shadow': '0 4px 14px rgba(0, 0, 0, 0.35)',
    '--focus': '0 0 0 2px rgba(95, 118, 255, 0.55)',
  },
  field: {
    pitch: '#0d3b2a',
    boundary: '#071a13',
    line: 'rgba(223,243,234,0.82)',
    grid: 'rgba(223,243,234,0.12)',
    blue: '#4d8dff',
    yellow: '#ffd23f',
    ball: '#ff7a3c',
    target: '#a78bfa',
    kick: '#32d7c4',
    select: '#ffffff',
    uncertain: '#ffd23f',
    velocity: 'rgba(255,255,255,0.62)',
    robotEdge: 'rgba(3,12,8,0.5)',
    robotLabel: '#08131f',
    heat: '#ff5f6d',
    zone: '#5f76ff',
    keepout: 'rgba(255,255,255,0.5)',
    fieldText: 'rgba(226,240,235,0.85)',
    alert: '#ff5f6d',
    debug: '#a78bfa',
  },
}

const CONSOLE: Theme = {
  id: 'console',
  label: 'Console',
  description:
    'Flat industrial ops console. Near-black, zero radius, hairlines, tabular monospace, one amber accent, red reserved for Halt. Maximum density.',
  scheme: 'dark',
  density: 'compact',
  vars: {
    '--bg': '#0a0a0b',
    '--surface': '#101012',
    '--surface-2': '#151517',
    '--surface-3': '#1c1c20',
    '--line': '#232326',
    '--line-soft': '#1a1a1d',
    '--text': '#d8d8dc',
    '--muted': '#8a8a93',
    '--dim': '#5d5d66',
    '--accent': '#ffb020',
    '--accent-ink': '#1a1200',
    '--accent-2': '#4fd6c4',
    '--danger': '#ff3b30',
    '--danger-ink': '#ffffff',
    '--warn': '#ffb020',
    '--warn-ink': '#1a1200',
    '--ok': '#35c759',
    '--radius': '0px',
    '--radius-sm': '0px',
    '--radius-lg': '0px',
    '--control-h': '22px',
    '--row-h': '19px',
    '--font': SANS,
    '--font-mono': MONO,
    '--font-size': '12px',
    '--font-size-sm': '11px',
    '--font-size-xs': '9px',
    '--chrome-bg': '#101012',
    '--app-bg': '#0a0a0b',
    '--shadow': 'none',
    '--focus': '0 0 0 1px #ffb020',
  },
  field: {
    pitch: '#0f1512',
    boundary: '#080a09',
    line: 'rgba(255,255,255,0.5)',
    grid: 'rgba(255,255,255,0.08)',
    blue: '#3d7fd6',
    yellow: '#e8c33a',
    ball: '#ff8c2b',
    target: '#ffb020',
    kick: '#4fd6c4',
    select: '#ffffff',
    uncertain: '#ffb020',
    velocity: 'rgba(255,255,255,0.48)',
    robotEdge: '#05070a',
    robotLabel: '#07090b',
    heat: '#ff3b30',
    zone: '#5a7fa8',
    keepout: 'rgba(255,255,255,0.32)',
    fieldText: 'rgba(255,255,255,0.6)',
    alert: '#ff3b30',
    debug: '#ffb020',
  },
}

const STUDIO: Theme = {
  id: 'studio',
  label: 'Studio',
  description:
    'IDE and DAW chrome. Two-tone neutral surfaces, small radii, accent-coloured status bar, panels that read as dockable.',
  scheme: 'dark',
  density: 'comfortable',
  vars: {
    '--bg': '#1e1e22',
    '--surface': '#26262b',
    '--surface-2': '#2a2a30',
    '--surface-3': '#303038',
    '--line': '#3a3a42',
    '--line-soft': '#33333a',
    '--text': '#e6e6ea',
    '--muted': '#9a9aa6',
    '--dim': '#70707c',
    '--accent': '#4a8cff',
    '--accent-ink': '#071223',
    '--accent-2': '#3fb950',
    '--danger': '#f85149',
    '--danger-ink': '#ffffff',
    '--warn': '#d29922',
    '--warn-ink': '#1d1400',
    '--ok': '#3fb950',
    '--radius': '5px',
    '--radius-sm': '4px',
    '--radius-lg': '8px',
    '--control-h': '24px',
    '--row-h': '24px',
    '--font': SANS,
    '--font-mono': MONO,
    '--font-size': '13px',
    '--font-size-sm': '11.5px',
    '--font-size-xs': '10.5px',
    '--chrome-bg': '#26262b',
    '--app-bg': '#1e1e22',
    '--shadow': '0 2px 8px rgba(0, 0, 0, 0.3)',
    '--focus': '0 0 0 1px #4a8cff',
  },
  field: {
    pitch: '#1c2620',
    boundary: '#141a17',
    line: 'rgba(226,232,240,0.68)',
    grid: 'rgba(226,232,240,0.1)',
    blue: '#4a8cff',
    yellow: '#e3b341',
    ball: '#f0883e',
    target: '#bc8cff',
    kick: '#3fb950',
    select: '#ffffff',
    uncertain: '#e3b341',
    velocity: 'rgba(255,255,255,0.5)',
    robotEdge: '#11151a',
    robotLabel: '#0d1117',
    heat: '#f85149',
    zone: '#4a8cff',
    keepout: 'rgba(255,255,255,0.38)',
    fieldText: 'rgba(230,237,243,0.72)',
    alert: '#f85149',
    debug: '#bc8cff',
  },
}

const BRIEF: Theme = {
  id: 'brief',
  label: 'Brief',
  description:
    'Warm neutral chrome, generous radii and comfortable sizing. Nothing on screen is ever smaller than comfortable.',
  scheme: 'dark',
  density: 'comfortable',
  vars: {
    '--bg': '#16150f',
    '--surface': '#1e1c16',
    '--surface-2': '#26241c',
    '--surface-3': '#322f26',
    '--line': '#322f26',
    '--line-soft': '#26241c',
    '--text': '#f0ece3',
    '--muted': '#b0a998',
    '--dim': '#7d776a',
    '--accent': '#d9a441',
    '--accent-ink': '#241704',
    '--accent-2': '#6fbf8b',
    '--danger': '#e0705c',
    '--danger-ink': '#1a0906',
    '--warn': '#d9a441',
    '--warn-ink': '#241704',
    '--ok': '#6fbf8b',
    '--radius': '9px',
    '--radius-sm': '7px',
    '--radius-lg': '12px',
    '--control-h': '32px',
    '--row-h': '30px',
    '--font': SANS,
    '--font-mono': MONO,
    '--font-size': '13.5px',
    '--font-size-sm': '12.5px',
    '--font-size-xs': '10.5px',
    '--chrome-bg': '#1e1c16',
    '--app-bg': '#16150f',
    '--shadow': '0 6px 20px rgba(0, 0, 0, 0.4)',
    '--focus': '0 0 0 2px rgba(217, 164, 65, 0.5)',
  },
  field: {
    pitch: '#252c26',
    boundary: '#191e1a',
    line: 'rgba(240,236,227,0.4)',
    grid: 'rgba(240,236,227,0.09)',
    blue: '#7aa5e8',
    yellow: '#dfb05c',
    ball: '#e8834a',
    target: '#b295e0',
    kick: '#6fbf8b',
    select: '#f5f1e8',
    uncertain: '#dfb05c',
    velocity: 'rgba(245,241,232,0.32)',
    robotEdge: '#12140f',
    robotLabel: '#12140f',
    heat: '#e0705c',
    zone: '#7aa5e8',
    keepout: 'rgba(245,241,232,0.24)',
    fieldText: 'rgba(240,236,227,0.5)',
    alert: '#e0705c',
    debug: '#b295e0',
  },
}

const LEDGER: Theme = {
  id: 'ledger',
  label: 'Ledger',
  description:
    'Paper and ink. The one light theme — hairline rules, hierarchy from type size and whitespace. Readable under a bright hall light.',
  scheme: 'light',
  density: 'comfortable',
  vars: {
    '--bg': '#f6f4ef',
    '--surface': '#fffdf8',
    '--surface-2': '#efece4',
    '--surface-3': '#e5e1d6',
    '--line': '#d9d4c7',
    '--line-soft': '#e8e4da',
    '--text': '#1d1b16',
    '--muted': '#5c574c',
    '--dim': '#8a8375',
    '--accent': '#1f5f4d',
    '--accent-ink': '#ffffff',
    '--accent-2': '#7a4a17',
    '--danger': '#a5281c',
    '--danger-ink': '#ffffff',
    '--warn': '#8a5b06',
    '--warn-ink': '#ffffff',
    '--ok': '#1f5f4d',
    '--radius': '3px',
    '--radius-sm': '2px',
    '--radius-lg': '5px',
    '--control-h': '28px',
    '--row-h': '26px',
    '--font': SANS,
    '--font-mono': MONO,
    '--font-size': '13px',
    '--font-size-sm': '11.5px',
    '--font-size-xs': '10.5px',
    '--chrome-bg': '#fffdf8',
    '--app-bg': '#f6f4ef',
    '--shadow': '0 1px 3px rgba(29, 27, 22, 0.12)',
    '--focus': '0 0 0 2px rgba(31, 95, 77, 0.4)',
  },
  field: {
    pitch: '#e7e9df',
    boundary: '#d5d8cc',
    line: 'rgba(29,27,22,0.55)',
    grid: 'rgba(29,27,22,0.08)',
    blue: '#2f5fa8',
    yellow: '#a5761b',
    ball: '#c2521f',
    target: '#5a3f96',
    kick: '#1f5f4d',
    select: '#1d1b16',
    uncertain: '#a5761b',
    velocity: 'rgba(29,27,22,0.45)',
    robotEdge: 'rgba(255,255,255,0.7)',
    robotLabel: '#ffffff',
    heat: '#a5281c',
    zone: '#2f5fa8',
    keepout: 'rgba(29,27,22,0.3)',
    fieldText: 'rgba(29,27,22,0.7)',
    alert: '#a5281c',
    debug: '#5a3f96',
  },
}

export const THEMES: Record<ThemeId, Theme> = {
  evolved: EVOLVED,
  console: CONSOLE,
  studio: STUDIO,
  brief: BRIEF,
  ledger: LEDGER,
}

export const THEME_LIST: Theme[] = [EVOLVED, CONSOLE, STUDIO, BRIEF, LEDGER]

/** Density overrides only touch the sizing tokens, never the palette. */
const DENSITY_OVERRIDES: Record<'comfortable' | 'compact', Record<string, string>> = {
  comfortable: {
    '--control-h': '30px',
    '--row-h': '28px',
    '--font-size': '13px',
    '--font-size-sm': '12px',
  },
  compact: {
    '--control-h': '22px',
    '--row-h': '19px',
    '--font-size': '12px',
    '--font-size-sm': '10.5px',
  },
}

export function resolveVars(
  themeId: ThemeId,
  density: 'theme' | 'comfortable' | 'compact',
): Record<string, string> {
  const theme = THEMES[themeId] ?? EVOLVED
  return density === 'theme'
    ? theme.vars
    : { ...theme.vars, ...DENSITY_OVERRIDES[density] }
}
