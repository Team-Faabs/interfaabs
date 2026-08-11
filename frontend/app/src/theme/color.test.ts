import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import {
  BLACK,
  WHITE,
  contrastRatio,
  ensureContrast,
  isDark,
  luminance,
  mix,
  parseColor,
  parseColorOr,
  readableInk,
  toHex,
  withAlpha,
} from './color'

describe('parseColor', () => {
  it('reads the notations a colour input or a person produces', () => {
    assert.deepEqual(parseColor('#fff'), WHITE)
    assert.deepEqual(parseColor('#FFFFFF'), WHITE)
    assert.deepEqual(parseColor('  #000000  '), BLACK)
    assert.deepEqual(parseColor('#5f76ff'), { r: 0x5f, g: 0x76, b: 0xff })
    assert.deepEqual(parseColor('rgb(12, 34, 56)'), { r: 12, g: 34, b: 56 })
    assert.deepEqual(parseColor('rgba(12 34 56 / 0.5)'), { r: 12, g: 34, b: 56 })
  })

  it('discards alpha rather than folding it into the channels', () => {
    assert.deepEqual(parseColor('#5f76ff80'), { r: 0x5f, g: 0x76, b: 0xff })
    assert.deepEqual(parseColor('#fff8'), WHITE)
  })

  it('returns null for anything it does not understand', () => {
    // A stored colour that fails to parse must be distinguishable from black,
    // or a typo in the config would silently repaint the interface.
    for (const value of ['', 'rebeccapurple', '#gg0000', '#12345', 'not a colour']) {
      assert.equal(parseColor(value), null, value)
    }
  })

  it('falls back only when there is nothing usable', () => {
    assert.deepEqual(parseColorOr('#000000', WHITE), BLACK)
    assert.deepEqual(parseColorOr(null, WHITE), WHITE)
    assert.deepEqual(parseColorOr('junk', WHITE), WHITE)
  })
})

describe('toHex and withAlpha', () => {
  it('round-trips through hex', () => {
    assert.equal(toHex({ r: 0x5f, g: 0x76, b: 0xff }), '#5f76ff')
    assert.equal(toHex(parseColor('#0d1829')!), '#0d1829')
  })

  it('clamps and rounds out-of-range channels from mixing', () => {
    assert.equal(toHex({ r: -20, g: 300, b: 127.6 }), '#00ff80')
  })

  it('emits alpha CSS the stylesheets can use directly', () => {
    assert.equal(withAlpha({ r: 95, g: 118, b: 255 }, 0.5), 'rgba(95, 118, 255, 0.5)')
    assert.equal(withAlpha(WHITE, 2), 'rgba(255, 255, 255, 1)')
  })
})

describe('mix', () => {
  it('interpolates towards the second colour', () => {
    assert.deepEqual(mix(BLACK, WHITE, 0), BLACK)
    assert.deepEqual(mix(BLACK, WHITE, 1), WHITE)
    assert.equal(toHex(mix(BLACK, WHITE, 0.5)), '#808080')
  })

  it('clamps the amount instead of extrapolating', () => {
    assert.deepEqual(mix(BLACK, WHITE, -1), BLACK)
    assert.deepEqual(mix(BLACK, WHITE, 5), WHITE)
  })
})

describe('luminance and contrast', () => {
  it('matches the WCAG anchors', () => {
    assert.equal(luminance(BLACK), 0)
    assert.equal(luminance(WHITE), 1)
    assert.equal(contrastRatio(BLACK, WHITE), 21)
    assert.equal(contrastRatio(WHITE, WHITE), 1)
  })

  it('is symmetric', () => {
    const a = parseColor('#5f76ff')!
    const b = parseColor('#0d1829')!
    assert.equal(contrastRatio(a, b), contrastRatio(b, a))
  })

  it('classifies the theme backgrounds correctly', () => {
    assert.equal(isDark(parseColor('#07111f')!), true)
    assert.equal(isDark(parseColor('#f6f4ef')!), false)
  })
})

describe('readableInk', () => {
  it('picks dark ink on a bright fill and light ink on a dark one', () => {
    assert.deepEqual(readableInk(parseColor('#ffb020')!), BLACK)
    assert.deepEqual(readableInk(parseColor('#1f5f4d')!), WHITE)
  })

  it('always clears 4.5:1 for the accents a user is likely to pick', () => {
    const candidates = ['#5f76ff', '#ffb020', '#4a8cff', '#d9a441', '#1f5f4d', '#32d7c4', '#ff3b30']
    for (const value of candidates) {
      const fill = parseColor(value)!
      assert.ok(
        contrastRatio(fill, readableInk(fill)) >= 4.5,
        `${value} ink contrast ${contrastRatio(fill, readableInk(fill)).toFixed(2)}`,
      )
    }
  })
})

describe('ensureContrast', () => {
  const darkSurface = parseColor('#111f35')!
  const lightSurface = parseColor('#efece4')!

  it('leaves a colour that already passes untouched', () => {
    const colour = parseColor('#5f76ff')!
    assert.deepEqual(ensureContrast(colour, darkSurface, 3), colour)
  })

  it('lightens against a dark surface and darkens against a light one', () => {
    // Navy on navy, and pale yellow on cream: the two ways a picked colour
    // disappears into the chrome.
    const navy = parseColor('#16264a')!
    const lifted = ensureContrast(navy, darkSurface, 4.5)
    assert.ok(luminance(lifted) > luminance(navy))
    assert.ok(contrastRatio(lifted, darkSurface) >= 4.5)

    const pale = parseColor('#f7e9a0')!
    const dropped = ensureContrast(pale, lightSurface, 4.5)
    assert.ok(luminance(dropped) < luminance(pale))
    assert.ok(contrastRatio(dropped, lightSurface) >= 4.5)
  })

  it('reaches 4.5:1 from any hue on either surface', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      // A saturated ring at mid lightness — the hardest case, since roughly
      // half of it starts too dark and half too light.
      const colour = hslToRgb(hue, 0.9, 0.45)
      for (const surface of [darkSurface, lightSurface]) {
        const fixed = ensureContrast(colour, surface, 4.5)
        assert.ok(
          contrastRatio(fixed, surface) >= 4.5,
          `hue ${hue} on ${toHex(surface)} reached ${contrastRatio(fixed, surface).toFixed(2)}`,
        )
      }
    }
  })

  it('returns the closest it can manage when the target is unreachable', () => {
    const colour = parseColor('#808080')!
    const surface = parseColor('#808080')!
    const result = ensureContrast(colour, surface, 21)
    assert.ok(contrastRatio(result, surface) > 1, 'it still moved as far as it could')
  })
})

/** Test-only helper: the module under test never needs to go HSL -> RGB. */
function hslToRgb(hue: number, saturation: number, lightness: number) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}
