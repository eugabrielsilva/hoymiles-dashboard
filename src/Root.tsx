import { useCallback, useEffect, useState } from 'react'
import Login from './Login'
import Dashboard from './Dashboard'
import { getToken } from './api/hoymiles'
import { THEME_STORAGE_KEY, type ThemePreference } from '@/lib/theme'

export default function Root() {
  const [logged, setLogged] = useState(!!getToken())
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  })
  const onLogout = useCallback(() => setLogged(false), [])

  const cycleTheme = useCallback(() => {
    const next: ThemePreference = themePreference === 'system' ? 'light' : themePreference === 'light' ? 'dark' : 'system'
    localStorage.setItem(THEME_STORAGE_KEY, next)
    setThemePreference(next)
  }, [themePreference])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const dark = themePreference === 'dark' || (themePreference === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }

    applyTheme()
    if (themePreference !== 'system') return
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    window.addEventListener('hoymiles:logout', onLogout)
    return () => window.removeEventListener('hoymiles:logout', onLogout)
  }, [onLogout])

  return logged ? (
    <Dashboard onLogout={onLogout} themePreference={themePreference} onCycleTheme={cycleTheme} />
  ) : (
    <Login onLogin={() => setLogged(true)} />
  )
}
