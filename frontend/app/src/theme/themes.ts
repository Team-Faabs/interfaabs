// Themes carry colour, radius, density and chrome weight — everything that
// made the six mockups look different, minus their layout. A theme is a flat
// bag of CSS custom properties plus a field palette handed to the canvas
// renderer, so both shells can wear any of them.
//
// A theme is split three ways, so the three things an operator can change move
// independently:
//
//   shape   the geometry and type that make a theme recognisable — shared by
//           both colour schemes, because Console is Console whether it is dark
//           or light.
//   skin    the neutrals, the status colours and the field palette, authored
//           twice: once for dark, once for light.
//   colours the primary and the accent, which the operator picks. They are not
//           stored in the skin at all; `buildTheme` derives every accent token
//           from them and guarantees the result stays legible on that skin.

import type { ThemeId } from '../config/types'
import {
  contrastRatio,
  darken,
  ensureContrast,
  lighten,
  mix,
  parseColor,
  parseColorOr,
  readableInk,
  toHex,
  withAlpha,
  BLACK,
  WHITE,
  type Rgb,
} from './color'

export type Scheme = 'dark' | 'light'

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

/** One colour scheme's worth of a theme. Carries no geometry and no accent. */
export interface Skin {
  /** Neutrals and status colours. Accent tokens are derived, never authored. */
  vars: Record<string, string>
  field: FieldPalette
  /** What the theme reaches for when the operator has not chosen. */
  primary: string
  accent: string
  /** Lets a skin tint its backdrop with the operator's colours. */
  appBg?: (primary: Rgb, accent: Rgb) => string
}

export interface Theme {
  id: ThemeId
  label: string
  description: string
  density: 'comfortable' | 'compact'
  /** Geometry and type: identical in both schemes. */
  shape: Record<string, string>
  /** Chrome weight shows in the focus ring, so the theme composes its own. */
  focus?: (primary: Rgb) => string
  dark: Skin
  light: Skin
}

const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"

// ── Evolved ──────────────────────────────────────────────────────────────

const EVOLVED: Theme = {
  id: 'evolved',
  label: 'Evolved',
  description:
    'Deep navy or cool paper, rounded surfaces, gradients and glow accents. The refined descendant of the current interface.',
  density: 'comfortable',
  shape: {
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
  },
  focus: (primary) => `0 0 0 2px ${withAlpha(primary, 0.55)}`,
  dark: {
    primary: '#5f76ff',
    accent: '#32d7c4',
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
      '--danger': '#ff5f6d',
      '--warn': '#ffb74d',
      '--ok': '#4ade80',
      '--chrome-bg':
        'linear-gradient(180deg, rgba(16, 29, 51, 0.95), rgba(9, 17, 30, 0.95))',
      '--shadow': '0 4px 14px rgba(0, 0, 0, 0.35)',
    },
    appBg: (primary, accent) =>
      `radial-gradient(circle at 12% -10%, ${withAlpha(lighten(primary, 0.2), 0.16)}, transparent 34%),` +
      `radial-gradient(circle at 92% -6%, ${withAlpha(lighten(accent, 0.1), 0.1)}, transparent 32%),` +
      'linear-gradient(180deg, #08111f 0%, #07111a 40%, #050b14 100%)',
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
  },
  light: {
    primary: '#3b5bdb',
    accent: '#0d9488',
    vars: {
      '--bg': '#eef2f9',
      '--surface': '#ffffff',
      '--surface-2': '#e9eef8',
      '--surface-3': '#dde5f2',
      '--line': 'rgba(31, 58, 110, 0.16)',
      '--line-soft': 'rgba(31, 58, 110, 0.08)',
      '--text': '#0f1b30',
      '--muted': '#4a5b7a',
      '--dim': '#6f7f9c',
      '--danger': '#c41f2f',
      '--warn': '#965f00',
      '--ok': '#0f8a52',
      '--chrome-bg': 'linear-gradient(180deg, #ffffff, #f1f5fc)',
      '--shadow': '0 3px 12px rgba(15, 27, 48, 0.12)',
    },
    appBg: (primary, accent) =>
      `radial-gradient(circle at 12% -10%, ${withAlpha(primary, 0.12)}, transparent 34%),` +
      `radial-gradient(circle at 92% -6%, ${withAlpha(accent, 0.09)}, transparent 32%),` +
      'linear-gradient(180deg, #f4f7fd 0%, #eef2f9 40%, #e7ecf6 100%)',
    field: {
      pitch: '#dbeee2',
      boundary: '#c8ddd0',
      line: 'rgba(12, 42, 28, 0.55)',
      grid: 'rgba(12, 42, 28, 0.11)',
      blue: '#2563eb',
      yellow: '#b07d00',
      ball: '#e2590c',
      target: '#7c3aed',
      kick: '#0d9488',
      select: '#0f1b30',
      uncertain: '#b07d00',
      velocity: 'rgba(15, 27, 48, 0.5)',
      robotEdge: 'rgba(255,255,255,0.75)',
      robotLabel: '#ffffff',
      heat: '#dc2626',
      zone: '#3b5bdb',
      keepout: 'rgba(15, 27, 48, 0.32)',
      fieldText: 'rgba(15, 27, 48, 0.72)',
      alert: '#dc2626',
      debug: '#7c3aed',
    },
  },
}

// ── Console ──────────────────────────────────────────────────────────────

const CONSOLE: Theme = {
  id: 'console',
  label: 'Console',
  description:
    'Flat industrial ops console. Zero radius, hairlines, tabular monospace, red reserved for Halt. Maximum density.',
  density: 'compact',
  shape: {
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
  },
  // A hard hairline rather than a glow: nothing in this theme is soft.
  focus: (primary) => `0 0 0 1px ${toHex(primary)}`,
  dark: {
    primary: '#ffb020',
    accent: '#4fd6c4',
    vars: {
      '--bg': '#0a0a0b',
      '--surface': '#101012',
      '--surface-2': '#151517',
      '--surface-3': '#1c1c20',
      '--line': '#232326',
      '--line-soft': '#1a1a1d',
      '--text': '#d8d8dc',
      '--muted': '#8a8a93',
      '--dim': '#6c6c76',
      '--danger': '#ff3b30',
      '--warn': '#ffb020',
      '--ok': '#35c759',
      '--chrome-bg': '#101012',
      '--app-bg': '#0a0a0b',
      '--shadow': 'none',
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
  },
  light: {
    // Amber survives the move to a light surface only once it is taken down to
    // a burnt tone; `ensureContrast` would do it anyway, but starting there
    // keeps the theme's own default stable.
    primary: '#b45309',
    accent: '#0f766e',
    vars: {
      '--bg': '#f2f2f3',
      '--surface': '#fbfbfc',
      '--surface-2': '#ededef',
      '--surface-3': '#e2e2e5',
      '--line': '#d0d0d4',
      '--line-soft': '#e2e2e5',
      '--text': '#17171a',
      '--muted': '#55555d',
      '--dim': '#7c7c85',
      '--danger': '#c62828',
      '--warn': '#985300',
      '--ok': '#1b7a35',
      '--chrome-bg': '#fbfbfc',
      '--app-bg': '#f2f2f3',
      '--shadow': 'none',
    },
    field: {
      pitch: '#e4e8e4',
      boundary: '#d4d8d4',
      line: 'rgba(0,0,0,0.45)',
      grid: 'rgba(0,0,0,0.08)',
      blue: '#2b6cb0',
      yellow: '#9a7000',
      ball: '#c2530f',
      target: '#b45309',
      kick: '#0f766e',
      select: '#17171a',
      uncertain: '#b45309',
      velocity: 'rgba(0,0,0,0.45)',
      robotEdge: 'rgba(255,255,255,0.8)',
      robotLabel: '#ffffff',
      heat: '#c62828',
      zone: '#4a6c8f',
      keepout: 'rgba(0,0,0,0.3)',
      fieldText: 'rgba(0,0,0,0.62)',
      alert: '#c62828',
      debug: '#b45309',
    },
  },
}

// ── Studio ───────────────────────────────────────────────────────────────

const STUDIO: Theme = {
  id: 'studio',
  label: 'Studio',
  description:
    'IDE and DAW chrome. Two-tone neutral surfaces, small radii, accent-coloured status bar, panels that read as dockable.',
  density: 'comfortable',
  shape: {
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
  },
  focus: (primary) => `0 0 0 1px ${toHex(primary)}`,
  dark: {
    primary: '#4a8cff',
    accent: '#3fb950',
    vars: {
      '--bg': '#1e1e22',
      '--surface': '#26262b',
      '--surface-2': '#2a2a30',
      '--surface-3': '#303038',
      '--line': '#3a3a42',
      '--line-soft': '#33333a',
      '--text': '#e6e6ea',
      '--muted': '#9a9aa6',
      '--dim': '#7d7d8a',
      '--danger': '#ff6b62',
      '--warn': '#d29922',
      '--ok': '#3fb950',
      '--chrome-bg': '#26262b',
      '--app-bg': '#1e1e22',
      '--shadow': '0 2px 8px rgba(0, 0, 0, 0.3)',
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
  },
  light: {
    primary: '#0969da',
    accent: '#1a7f37',
    vars: {
      '--bg': '#f3f3f3',
      '--surface': '#ffffff',
      '--surface-2': '#ececee',
      '--surface-3': '#e0e0e3',
      '--line': '#d4d4d8',
      '--line-soft': '#e4e4e7',
      '--text': '#1f1f24',
      '--muted': '#565660',
      '--dim': '#7b7b85',
      '--danger': '#cf222e',
      '--warn': '#8a5c00',
      '--ok': '#1a7f37',
      '--chrome-bg': '#ffffff',
      '--app-bg': '#f3f3f3',
      '--shadow': '0 2px 8px rgba(0, 0, 0, 0.12)',
    },
    field: {
      pitch: '#e1ebe4',
      boundary: '#d1ddd5',
      line: 'rgba(31,31,36,0.52)',
      grid: 'rgba(31,31,36,0.09)',
      blue: '#0969da',
      yellow: '#9a6700',
      ball: '#bc4c00',
      target: '#8250df',
      kick: '#1a7f37',
      select: '#1f1f24',
      uncertain: '#9a6700',
      velocity: 'rgba(31,31,36,0.46)',
      robotEdge: 'rgba(255,255,255,0.8)',
      robotLabel: '#ffffff',
      heat: '#cf222e',
      zone: '#0969da',
      keepout: 'rgba(31,31,36,0.3)',
      fieldText: 'rgba(31,31,36,0.68)',
      alert: '#cf222e',
      debug: '#8250df',
    },
  },
}

// ── Brief ────────────────────────────────────────────────────────────────

const BRIEF: Theme = {
  id: 'brief',
  label: 'Brief',
  description:
    'Warm neutral chrome, generous radii and comfortable sizing. Nothing on screen is ever smaller than comfortable.',
  density: 'comfortable',
  shape: {
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
  },
  focus: (primary) => `0 0 0 2px ${withAlpha(primary, 0.5)}`,
  dark: {
    primary: '#d9a441',
    accent: '#6fbf8b',
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
      '--danger': '#e0705c',
      '--warn': '#d9a441',
      '--ok': '#6fbf8b',
      '--chrome-bg': '#1e1c16',
      '--app-bg': '#16150f',
      '--shadow': '0 6px 20px rgba(0, 0, 0, 0.4)',
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
  },
  light: {
    primary: '#a06a12',
    accent: '#2f7d51',
    vars: {
      '--bg': '#f7f3ea',
      '--surface': '#fffdf7',
      '--surface-2': '#f0eade',
      '--surface-3': '#e6dfd0',
      '--line': '#ddd4c2',
      '--line-soft': '#ebe4d7',
      '--text': '#241f16',
      '--muted': '#63594a',
      '--dim': '#8b8171',
      '--danger': '#b03a24',
      '--warn': '#8a5b06',
      '--ok': '#2f7d51',
      '--chrome-bg': '#fffdf7',
      '--app-bg': '#f7f3ea',
      '--shadow': '0 4px 16px rgba(60, 48, 28, 0.14)',
    },
    field: {
      pitch: '#e4e8d9',
      boundary: '#d4d9c8',
      line: 'rgba(36,31,22,0.45)',
      grid: 'rgba(36,31,22,0.08)',
      blue: '#3c6bb0',
      yellow: '#9c761c',
      ball: '#c05a20',
      target: '#6b4fa3',
      kick: '#2f7d51',
      select: '#241f16',
      uncertain: '#9c761c',
      velocity: 'rgba(36,31,22,0.42)',
      robotEdge: 'rgba(255,255,255,0.75)',
      robotLabel: '#fffdf7',
      heat: '#b03a24',
      zone: '#3c6bb0',
      keepout: 'rgba(36,31,22,0.28)',
      fieldText: 'rgba(36,31,22,0.64)',
      alert: '#b03a24',
      debug: '#6b4fa3',
    },
  },
}

// ── Ledger ───────────────────────────────────────────────────────────────

const LEDGER: Theme = {
  id: 'ledger',
  label: 'Ledger',
  description:
    'Paper and ink. Hairline rules, hierarchy from type size and whitespace, readable under a bright hall light — and the same restraint after dark.',
  density: 'comfortable',
  shape: {
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
  },
  focus: (primary) => `0 0 0 2px ${withAlpha(primary, 0.4)}`,
  light: {
    primary: '#1f5f4d',
    accent: '#7a4a17',
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
      '--danger': '#a5281c',
      '--warn': '#8a5b06',
      '--ok': '#1f5f4d',
      '--chrome-bg': '#fffdf8',
      '--app-bg': '#f6f4ef',
      '--shadow': '0 1px 3px rgba(29, 27, 22, 0.12)',
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
  },
  dark: {
    primary: '#4fb79a',
    accent: '#d3a05e',
    vars: {
      '--bg': '#131311',
      '--surface': '#1a1a17',
      '--surface-2': '#201f1c',
      '--surface-3': '#292824',
      '--line': '#34332d',
      '--line-soft': '#26251f',
      '--text': '#ece8df',
      '--muted': '#a49e91',
      '--dim': '#7a7468',
      '--danger': '#ea6a5d',
      '--warn': '#d8a341',
      '--ok': '#64bd97',
      '--chrome-bg': '#1a1a17',
      '--app-bg': '#131311',
      '--shadow': '0 1px 4px rgba(0, 0, 0, 0.5)',
    },
    field: {
      pitch: '#16241d',
      boundary: '#101a15',
      line: 'rgba(236,232,223,0.55)',
      grid: 'rgba(236,232,223,0.09)',
      blue: '#5b8ed6',
      yellow: '#d9b04a',
      ball: '#e3743a',
      target: '#a08ad8',
      kick: '#4fb79a',
      select: '#ece8df',
      uncertain: '#d9b04a',
      velocity: 'rgba(236,232,223,0.45)',
      robotEdge: 'rgba(10,14,11,0.55)',
      robotLabel: '#0f1310',
      heat: '#e0574a',
      zone: '#5b8ed6',
      keepout: 'rgba(236,232,223,0.3)',
      fieldText: 'rgba(236,232,223,0.7)',
      alert: '#e0574a',
      debug: '#a08ad8',
    },
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

/**
 * Offered in the colour pickers. They are starting points, not a closed set —
 * the picker also takes any hex — chosen to stay distinguishable from the team
 * colours on the field and to survive both schemes.
 */
export const COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Indigo', value: '#5f76ff' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Sky', value: '#0ea5e9' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Lime', value: '#84cc16' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Magenta', value: '#d946ef' },
  { label: 'Slate', value: '#64748b' },
]

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

/**
 * A colour used as a fill or a border only has to clear the 3:1 that WCAG asks
 * of a non-text interface component. The same colour set as *text* has to clear
 * 4.5:1, which for a saturated hue usually means a different shade — hence the
 * separate `--primary-text` and `--accent-text` tokens.
 */
const FILL_CONTRAST = 3
const TEXT_CONTRAST = 4.5

/**
 * The label on a coloured fill. Pure black and pure white would both clear the
 * bar, but they read as stamped on; a near-black or near-white mixed out of the
 * fill itself belongs to it. Whichever of the two has more contrast wins, so
 * the 4.5:1 guarantee holds for any fill.
 */
function inkFor(fill: Rgb): Rgb {
  const tinted = readableInk(fill, lighten(fill, 0.94), darken(fill, 0.88))
  if (contrastRatio(fill, tinted) >= TEXT_CONTRAST) return tinted
  // A fill sitting near the middle of the range — grey being the worst case —
  // leaves no room for a tinted ink. Then only the extremes will do, and being
  // read beats looking considered.
  return readableInk(fill)
}

export interface ResolvedTheme {
  id: ThemeId
  label: string
  scheme: Scheme
  density: 'comfortable' | 'compact'
  vars: Record<string, string>
  field: FieldPalette
  /** What the operator asked for, parsed and defaulted but not yet adjusted. */
  chosen: { primary: string; accent: string }
  /** What is actually on screen after the legibility adjustment. */
  effective: { primary: string; accent: string }
}

export interface BuildThemeOptions {
  themeId: ThemeId
  scheme: Scheme
  density: 'theme' | 'comfortable' | 'compact'
  /** `null` or unparseable falls back to the theme's own suggestion. */
  primary?: string | null
  accent?: string | null
}

/**
 * Assembles one theme, one scheme and the operator's two colours into the flat
 * variable bag the document wears, plus the palette the canvas renderer draws
 * with. This is the only place accent tokens are produced: nothing downstream
 * has to think about contrast.
 */
export function buildTheme({
  themeId,
  scheme,
  density,
  primary,
  accent,
}: BuildThemeOptions): ResolvedTheme {
  const theme = THEMES[themeId] ?? EVOLVED
  const skin = theme[scheme]

  // Chips, rows and cards sit on surface-2, so that is what a colour has to
  // hold up against — not the darker page background, which would flatter it.
  const surface = parseColorOr(skin.vars['--surface-2'], scheme === 'dark' ? BLACK : WHITE)

  const chosenPrimary = parseColorOr(primary, parseColor(skin.primary) ?? BLACK)
  const chosenAccent = parseColorOr(accent, parseColor(skin.accent) ?? BLACK)

  const primaryFill = ensureContrast(chosenPrimary, surface, FILL_CONTRAST)
  const accentFill = ensureContrast(chosenAccent, surface, FILL_CONTRAST)
  const primaryText = ensureContrast(primaryFill, surface, TEXT_CONTRAST)
  const accentText = ensureContrast(accentFill, surface, TEXT_CONTRAST)

  // Hover moves away from the surface so the control reads as coming forward
  // in both schemes; active moves back towards it.
  const forward = scheme === 'dark' ? WHITE : BLACK
  const focus = theme.focus ?? ((colour: Rgb) => `0 0 0 2px ${withAlpha(colour, 0.5)}`)

  const vars: Record<string, string> = {
    ...theme.shape,
    ...(density === 'theme' ? {} : DENSITY_OVERRIDES[density]),
    ...skin.vars,
    '--primary': toHex(primaryFill),
    '--primary-ink': toHex(inkFor(primaryFill)),
    '--primary-text': toHex(primaryText),
    '--primary-hover': toHex(mix(primaryFill, forward, 0.16)),
    '--primary-active': toHex(mix(primaryFill, surface, 0.2)),
    '--primary-soft': withAlpha(primaryFill, scheme === 'dark' ? 0.2 : 0.14),
    '--primary-line': withAlpha(primaryFill, 0.45),
    '--accent': toHex(accentFill),
    '--accent-ink': toHex(inkFor(accentFill)),
    '--accent-text': toHex(accentText),
    '--accent-soft': withAlpha(accentFill, scheme === 'dark' ? 0.2 : 0.14),
    '--focus': focus(primaryFill),
    // Derived for the same reason the accent inks are: a skin that authors its
    // own ends up with white on a bright coral Halt button, which is exactly
    // the label you cannot afford to lose.
    '--danger-ink': toHex(inkFor(parseColorOr(skin.vars['--danger'], BLACK))),
    '--warn-ink': toHex(inkFor(parseColorOr(skin.vars['--warn'], BLACK))),
  }

  // Evolved tints its backdrop with the operator's colours, so it cannot be a
  // static token like every other theme's.
  if (skin.appBg) vars['--app-bg'] = skin.appBg(primaryFill, accentFill)

  return {
    id: theme.id,
    label: theme.label,
    scheme,
    density: density === 'theme' ? theme.density : density,
    vars,
    field: {
      ...skin.field,
      // The two field colours that are chrome rather than physical reality.
      // Team blue, team yellow and the ball keep their real-world colours.
      zone: toHex(primaryFill),
      kick: toHex(accentFill),
    },
    chosen: { primary: toHex(chosenPrimary), accent: toHex(chosenAccent) },
    effective: { primary: toHex(primaryFill), accent: toHex(accentFill) },
  }
}
