import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { useConfig } from '../config/ConfigContext'
import { buildTheme, type ResolvedTheme, type Scheme } from './themes'

const ThemeContext = createContext<ResolvedTheme | null>(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

function matcher(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY)
    : null
}

/**
 * The operating system's preference, kept live: an operator who flips their
 * laptop to night mode between halves should not have to touch settings.
 * Falls back to dark where `matchMedia` is unavailable, which matches how the
 * interface has always started.
 */
export function useSystemScheme(): Scheme {
  const subscribe = useCallback((notify: () => void) => {
    const query = matcher()
    if (!query) return () => {}
    query.addEventListener('change', notify)
    return () => query.removeEventListener('change', notify)
  }, [])

  return useSyncExternalStore(
    subscribe,
    () => ((matcher()?.matches ?? true) ? 'dark' : 'light'),
    () => 'dark' as const,
  )
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig()
  const systemScheme = useSystemScheme()
  const scheme = config.colorScheme === 'system' ? systemScheme : config.colorScheme

  const theme = useMemo(
    () =>
      buildTheme({
        themeId: config.theme,
        scheme,
        density: config.density,
        primary: config.primaryColor,
        accent: config.accentColor,
      }),
    [config.theme, scheme, config.density, config.primaryColor, config.accentColor],
  )

  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value)
    root.style.colorScheme = theme.scheme
    root.dataset.theme = theme.id
    root.dataset.scheme = theme.scheme
    root.dataset.shell = config.shell
  }, [theme, config.shell])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): ResolvedTheme {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('useTheme outside ThemeProvider')
  return theme
}
