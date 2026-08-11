import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import type { ThemeId } from '../config/types'
import { contrastRatio, parseColor } from './color'
import { THEMES, THEME_LIST, buildTheme, type Scheme } from './themes'

const THEME_IDS = Object.keys(THEMES) as ThemeId[]
const SCHEMES: Scheme[] = ['dark', 'light']

/**
 * The colours an operator can realistically inflict on the interface: the two
 * extremes, a mid grey that is invisible on either scheme, and a saturated ring
 * that includes hues no theme was designed around.
 */
const HOSTILE = [
  '#000000',
  '#ffffff',
  '#808080',
  '#ffff00',
  '#00ff00',
  '#0000ff',
  '#ff00ff',
  '#123456',
  '#fdf6b2',
]

function ratio(a: string, b: string): number {
  const left = parseColor(a)
  const right = parseColor(b)
  assert.ok(left, `unparseable colour ${a}`)
  assert.ok(right, `unparseable colour ${b}`)
  return contrastRatio(left, right)
}

describe('theme definitions', () => {
  it('offers every theme in both schemes', () => {
    for (const theme of THEME_LIST) {
      for (const scheme of SCHEMES) {
        assert.ok(theme[scheme], `${theme.id} has no ${scheme} skin`)
        assert.ok(theme[scheme].primary, `${theme.id} ${scheme} has no default primary`)
        assert.ok(theme[scheme].accent, `${theme.id} ${scheme} has no default accent`)
      }
    }
  })

  // Reported all at once rather than one assertion at a time: authoring ten
  // palettes by hand, you want the whole list of offenders in one run.
  function audit(check: (vars: Record<string, string>) => Array<[string, number, number]>) {
    const failures: string[] = []
    for (const theme of THEME_LIST) {
      for (const scheme of SCHEMES) {
        for (const [what, got, want] of check(theme[scheme].vars)) {
          if (got < want) {
            failures.push(`${theme.id}/${scheme} ${what}: ${got.toFixed(2)}:1, wants ${want}:1`)
          }
        }
      }
    }
    assert.deepEqual(failures, [])
  }

  it('keeps body text readable on every hand-authored skin', () => {
    audit((vars) => [
      ['body text on the page', ratio(vars['--text'], vars['--bg']), 7],
      // Muted carries real content — hints, secondary values — so it is held
      // to the normal-text bar, not the large-text one.
      ['muted on a surface', ratio(vars['--muted'], vars['--surface-2']), 4.5],
      // Dim is section labelling, large and uppercase, so 3:1 is its bar.
      ['dim on a surface', ratio(vars['--dim'], vars['--surface-2']), 3],
    ])
  })

  it('keeps the status colours readable as text on a surface', () => {
    // Every one of these is set as `color:` somewhere — .set-error on danger,
    // .set-recovered b on warn — not only as a button fill.
    audit((vars) => [
      ['danger on a surface', ratio(vars['--danger'], vars['--surface-2']), 4.5],
      ['warn on a surface', ratio(vars['--warn'], vars['--surface-2']), 4.5],
      ['ok on a surface', ratio(vars['--ok'], vars['--surface-2']), 3],
    ])
  })

  it('derives status inks that can be read on their own fill', () => {
    const failures: string[] = []
    for (const themeId of THEME_IDS) {
      for (const scheme of SCHEMES) {
        const { vars } = buildTheme({ themeId, scheme, density: 'theme' })
        for (const tone of ['danger', 'warn'] as const) {
          const got = ratio(vars[`--${tone}`], vars[`--${tone}-ink`])
          if (got < 4.5) failures.push(`${themeId}/${scheme} ${tone}: ${got.toFixed(2)}:1`)
        }
      }
    }
    assert.deepEqual(failures, [])
  })
})

describe('buildTheme', () => {
  it('produces a complete variable bag for every theme and scheme', () => {
    const required = [
      '--bg',
      '--surface',
      '--surface-2',
      '--surface-3',
      '--line',
      '--text',
      '--muted',
      '--dim',
      '--danger',
      '--warn',
      '--ok',
      '--radius',
      '--control-h',
      '--font',
      '--font-size',
      '--app-bg',
      '--chrome-bg',
      '--shadow',
      '--focus',
      '--primary',
      '--primary-ink',
      '--primary-text',
      '--primary-hover',
      '--primary-active',
      '--primary-soft',
      '--primary-line',
      '--accent',
      '--accent-ink',
      '--accent-text',
      '--accent-soft',
    ]

    for (const themeId of THEME_IDS) {
      for (const scheme of SCHEMES) {
        const { vars } = buildTheme({ themeId, scheme, density: 'theme' })
        for (const name of required) {
          const value = vars[name]
          assert.ok(value, `${themeId}/${scheme} is missing ${name}`)
          assert.ok(!value.includes('undefined'), `${themeId}/${scheme} ${name} is ${value}`)
          assert.ok(!value.includes('NaN'), `${themeId}/${scheme} ${name} is ${value}`)
        }
      }
    }
  })

  it('leaves any colour readable, whatever the operator picks', () => {
    for (const themeId of THEME_IDS) {
      for (const scheme of SCHEMES) {
        for (const colour of HOSTILE) {
          const { vars } = buildTheme({
            themeId,
            scheme,
            density: 'theme',
            primary: colour,
            accent: colour,
          })
          const where = `${themeId}/${scheme} with ${colour}`
          const surface = vars['--surface-2']

          // A fill or a border only owes 3:1; the same colour set as text owes
          // the full 4.5:1, which is why they are separate tokens.
          assert.ok(
            ratio(vars['--primary'], surface) >= 2.99,
            `${where}: primary fill ${ratio(vars['--primary'], surface).toFixed(2)}:1`,
          )
          assert.ok(
            ratio(vars['--primary-text'], surface) >= 4.49,
            `${where}: primary text ${ratio(vars['--primary-text'], surface).toFixed(2)}:1`,
          )
          assert.ok(
            ratio(vars['--accent-text'], surface) >= 4.49,
            `${where}: accent text ${ratio(vars['--accent-text'], surface).toFixed(2)}:1`,
          )
          // A label on a button has to survive too, or picking lime gives a
          // button nobody can read.
          assert.ok(
            ratio(vars['--primary-ink'], vars['--primary']) >= 4.5,
            `${where}: primary ink ${ratio(vars['--primary-ink'], vars['--primary']).toFixed(2)}:1`,
          )
          assert.ok(
            ratio(vars['--accent-ink'], vars['--accent']) >= 4.5,
            `${where}: accent ink ${ratio(vars['--accent-ink'], vars['--accent']).toFixed(2)}:1`,
          )
        }
      }
    }
  })

  it('reports what was asked for alongside what was applied', () => {
    // Black on a dark console will not do, and the operator should be told so
    // rather than left wondering why the interface ignored them.
    const dark = buildTheme({
      themeId: 'console',
      scheme: 'dark',
      density: 'theme',
      primary: '#000000',
    })
    assert.equal(dark.chosen.primary, '#000000')
    assert.notEqual(dark.effective.primary, '#000000')

    // A colour that already works is passed through untouched.
    const fine = buildTheme({
      themeId: 'console',
      scheme: 'dark',
      density: 'theme',
      primary: '#5f76ff',
    })
    assert.equal(fine.chosen.primary, '#5f76ff')
    assert.equal(fine.effective.primary, '#5f76ff')
  })

  it('falls back to the theme colours for null and for nonsense', () => {
    for (const primary of [null, undefined, '', 'rebeccapurple', '#zzz']) {
      const built = buildTheme({ themeId: 'studio', scheme: 'light', density: 'theme', primary })
      assert.equal(built.effective.primary, THEMES.studio.light.primary, String(primary))
    }
  })

  it('tracks the scheme rather than the theme it was authored in', () => {
    const dark = buildTheme({ themeId: 'ledger', scheme: 'dark', density: 'theme' })
    const light = buildTheme({ themeId: 'ledger', scheme: 'light', density: 'theme' })

    assert.equal(dark.scheme, 'dark')
    assert.equal(light.scheme, 'light')
    assert.notEqual(dark.vars['--bg'], light.vars['--bg'])
    // Geometry is shared: Ledger is Ledger in either scheme.
    assert.equal(dark.vars['--radius'], light.vars['--radius'])
    assert.equal(dark.vars['--font-size-xs'], light.vars['--font-size-xs'])
  })

  it('lets density override the theme without touching the palette', () => {
    const own = buildTheme({ themeId: 'brief', scheme: 'dark', density: 'theme' })
    const compact = buildTheme({ themeId: 'brief', scheme: 'dark', density: 'compact' })

    assert.equal(own.vars['--control-h'], '32px')
    assert.equal(compact.vars['--control-h'], '22px')
    assert.equal(own.density, 'comfortable')
    assert.equal(compact.density, 'compact')
    assert.equal(own.vars['--bg'], compact.vars['--bg'])
    assert.equal(own.vars['--primary'], compact.vars['--primary'])
  })

  it('tints the field chrome but not the things that are physically that colour', () => {
    const built = buildTheme({
      themeId: 'evolved',
      scheme: 'dark',
      density: 'theme',
      primary: '#ff00ff',
      accent: '#00ffff',
    })

    assert.equal(built.field.zone, built.effective.primary)
    assert.equal(built.field.kick, built.effective.accent)
    // Team colours and the ball describe the world, not the interface.
    assert.equal(built.field.blue, THEMES.evolved.dark.field.blue)
    assert.equal(built.field.yellow, THEMES.evolved.dark.field.yellow)
    assert.equal(built.field.ball, THEMES.evolved.dark.field.ball)
  })

  it('tints the Evolved backdrop with the chosen colours', () => {
    const magenta = buildTheme({
      themeId: 'evolved',
      scheme: 'dark',
      density: 'theme',
      primary: '#ff00ff',
    })
    const stock = buildTheme({ themeId: 'evolved', scheme: 'dark', density: 'theme' })
    assert.notEqual(magenta.vars['--app-bg'], stock.vars['--app-bg'])
    assert.match(magenta.vars['--app-bg'], /^radial-gradient/)
  })

  it('falls back to Evolved for an unknown theme id rather than throwing', () => {
    const built = buildTheme({
      themeId: 'not-a-theme' as ThemeId,
      scheme: 'dark',
      density: 'theme',
    })
    assert.equal(built.id, 'evolved')
  })
})
