import { createContext, useContext, useEffect, useState, useCallback } from 'react'

type ThemeMode = 'auto' | 'light' | 'dark'
type AppliedTheme = 'light' | 'dark'

type ThemeContext = {
  themeMode: ThemeMode
  appliedTheme: AppliedTheme
  setThemeMode: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContext | undefined>(undefined)

const getSystemTheme = (): AppliedTheme => {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const getAppliedTheme = (mode: ThemeMode): AppliedTheme => {
  return mode === 'auto' ? getSystemTheme() : mode
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('themeMode') as ThemeMode | null
    return stored || 'auto'
  })

  const [appliedTheme, setAppliedTheme] = useState<AppliedTheme>(() => getAppliedTheme(themeMode))

  // Listen to system theme changes when in auto mode
  useEffect(() => {
    if (themeMode !== 'auto') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      setAppliedTheme(getSystemTheme())
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [themeMode])

  // Apply theme to document and save preference
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(appliedTheme)
    localStorage.setItem('themeMode', themeMode)
  }, [appliedTheme, themeMode])

  // Update applied theme when mode changes
  useEffect(() => {
    setAppliedTheme(getAppliedTheme(themeMode))
  }, [themeMode])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeModeState(prev => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  return (
    <ThemeContext.Provider value={{ themeMode, appliedTheme, setThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
