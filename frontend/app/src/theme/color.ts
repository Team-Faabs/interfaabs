// Colour maths for the theme layer. Everything here is pure and operates on
// plain sRGB triples: the theme builder needs to mix and tint, but above all it
// needs to measure contrast, because an operator may pick any primary colour
// they like and the interface still has to be readable under a bright hall
// light. Mixing is done in sRGB so it agrees with the `color-mix(in srgb, …)`
// the stylesheets already use.

export interface Rgb {
  r: number
  g: number
  b: number
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 }
export const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const HEX_SHORT = /^#([\da-f])([\da-f])([\da-f])([\da-f])?$/i
const HEX_LONG = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i
const RGB_FN = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/**
 * Understands the notations a person might reasonably type or a colour input
 * might produce: `#abc`, `#aabbcc`, `#aabbccdd` and `rgb()` / `rgba()`. Alpha
 * is parsed but discarded — themes carry opacity in the token, not the colour.
 * Anything else returns `null` rather than a black fallback, so callers can
 * tell a bad value from a deliberate one.
 */
export function parseColor(value: string): Rgb | null {
  const text = value.trim()

  const short = HEX_SHORT.exec(text)
  if (short) {
    return {
      r: Number.parseInt(short[1] + short[1], 16),
      g: Number.parseInt(short[2] + short[2], 16),
      b: Number.parseInt(short[3] + short[3], 16),
    }
  }

  const long = HEX_LONG.exec(text)
  if (long) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
    }
  }

  const fn = RGB_FN.exec(text)
  if (fn) {
    return {
      r: clamp(Math.round(Number(fn[1])), 0, 255),
      g: clamp(Math.round(Number(fn[2])), 0, 255),
      b: clamp(Math.round(Number(fn[3])), 0, 255),
    }
  }

  return null
}

/** Parses, or falls back — for the places where a colour is not optional. */
export function parseColorOr(value: string | null | undefined, fallback: Rgb): Rgb {
  return (value ? parseColor(value) : null) ?? fallback
}

function channel(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function withAlpha({ r, g, b }: Rgb, alpha: number): string {
  const a = Math.round(clamp(alpha, 0, 1) * 1000) / 1000
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
}

/** `amount` is how much of `b` ends up in the result: 0 is all `a`, 1 all `b`. */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp(amount, 0, 1)
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

export function lighten(colour: Rgb, amount: number): Rgb {
  return mix(colour, WHITE, amount)
}

export function darken(colour: Rgb, amount: number): Rgb {
  return mix(colour, BLACK, amount)
}

function linearise(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 relative luminance, 0 for black through 1 for white. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

/** WCAG 2.1 contrast ratio, between 1 (identical) and 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function isDark(colour: Rgb): boolean {
  return luminance(colour) < 0.5
}

/**
 * The text colour to lay over `background`. Both candidates are tried and the
 * one with more contrast wins, which is what makes a user-chosen accent safe as
 * a button fill: pick lime and you get dark ink, pick navy and you get white.
 */
export function readableInk(background: Rgb, light: Rgb = WHITE, dark: Rgb = BLACK): Rgb {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark
}

/**
 * Nudges `colour` until it reaches `target` contrast against `background`,
 * moving away from the background's own lightness so a dark surface gets a
 * lighter colour and a light surface a darker one. The hue is left alone, so
 * the operator's choice stays recognisably theirs; only its lightness gives.
 *
 * Returns the input unchanged when it already passes, and the nearest extreme
 * when the target is unreachable — which only happens for targets above about
 * 12:1, well past anything the interface asks for.
 */
export function ensureContrast(colour: Rgb, background: Rgb, target: number): Rgb {
  if (contrastRatio(colour, background) >= target) return colour

  const towards = isDark(background) ? WHITE : BLACK
  let best = colour
  let bestRatio = contrastRatio(colour, background)

  // Twenty steps is finer than the eye resolves and cheap enough to run on
  // every theme rebuild.
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(colour, towards, step / 20)
    const ratio = contrastRatio(candidate, background)
    if (ratio >= target) return candidate
    if (ratio > bestRatio) {
      best = candidate
      bestRatio = ratio
    }
  }

  return best
}
