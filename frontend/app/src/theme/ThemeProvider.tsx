import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'

import { useConfig } from '../config/ConfigContext'
import { THEMES, resolveVars, type Theme } from './themes'

const ThemeContext = createContext<Theme | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig()
  const theme = THEMES[config.theme] ?? THEMES.evolved
  const vars = useMemo(
    () => resolveVars(config.theme, config.density),
    [config.theme, config.density],
  )

  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    root.style.colorScheme = theme.scheme
    root.dataset.theme = theme.id
    root.dataset.shell = config.shell
  }, [vars, theme, config.shell])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('useTheme outside ThemeProvider')
  return theme
}
