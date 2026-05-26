import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const themeStorageKey = 'mdv-theme-mode'

export function readLegacyThemeMode(): ThemeMode | null {
  const storedValue = window.localStorage.getItem(themeStorageKey)

  if (storedValue === 'light' || storedValue === 'dark' || storedValue === 'system') {
    return storedValue
  }

  return null
}

export function clearLegacyThemeMode() {
  window.localStorage.removeItem(themeStorageKey)
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(themeMode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return themeMode === 'system' ? systemTheme : themeMode
}

function getBootstrapThemeMode(): ThemeMode {
  const bootstrap = window.mdvDesktop?.settings.getBootstrapSettings()
  const persistedThemeMode = bootstrap?.hasPersistedSettings
    ? bootstrap.hasReadableSettings
      ? bootstrap.settings.general.themeMode
      : bootstrap.settings.general.themeMode
    : null

  return persistedThemeMode ?? readLegacyThemeMode() ?? bootstrap?.settings.general.themeMode ?? 'system'
}

export function applyBootstrapTheme() {
  const themeMode = getBootstrapThemeMode()
  const resolvedTheme = resolveTheme(themeMode, getSystemTheme())

  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.dataset.themeMode = themeMode
}

export function useDesktopTheme() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getBootstrapThemeMode())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    handleChange()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    let active = true
    const settingsApi = window.mdvDesktop?.settings
    const unsubscribe = settingsApi?.onSettingsChanged((settings) => {
      setThemeModeState(settings.general.themeMode)
    })

    const hydrateTheme = async () => {
      if (!settingsApi) {
        const legacyTheme = readLegacyThemeMode()
        if (legacyTheme) {
          setThemeModeState(legacyTheme)
        }
        return
      }

      try {
        const settings = await settingsApi.getSettings()

        if (active) {
          setThemeModeState(settings.general.themeMode)
        }
      } catch {
        const legacyTheme = readLegacyThemeMode()
        if (active && legacyTheme) {
          setThemeModeState(legacyTheme)
        }
      }
    }

    void hydrateTheme()

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  const resolvedTheme = resolveTheme(themeMode, systemTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themeMode = themeMode

    if (!window.mdvDesktop?.settings) {
      window.localStorage.setItem(themeStorageKey, themeMode)
    }
  }, [resolvedTheme, themeMode])

  const setThemeMode = async (nextThemeMode: ThemeMode) => {
    if (!window.mdvDesktop?.settings) {
      setThemeModeState(nextThemeMode)
      window.localStorage.setItem(themeStorageKey, nextThemeMode)
      return
    }

    const updatedSettings = await window.mdvDesktop.settings.updateSettings({
      general: {
        themeMode: nextThemeMode,
      },
    })

    setThemeModeState(updatedSettings.general.themeMode)
  }

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
  }
}