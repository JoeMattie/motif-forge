import { useColorScheme, useLocalStorage } from '@mantine/hooks'

/**
 * Global toggle for explanatory hover tooltips. Persisted per browser;
 * multiple hook instances stay in sync within the tab.
 */
export function useTooltipsEnabled() {
  return useLocalStorage<boolean>({ key: 'motif-forge:tooltips', defaultValue: true })
}

export type ThemePref = 'day' | 'nite' | 'system'

/** Workbench theme: Day (light hardware), Nite (dark), or follow the OS. */
export function useThemePref() {
  return useLocalStorage<ThemePref>({ key: 'motif-forge:theme', defaultValue: 'day' })
}

/** Resolve the preference to the concrete theme driving `:root[data-theme]`. */
export function useResolvedTheme(pref: ThemePref): 'day' | 'nite' {
  const os = useColorScheme()
  return pref === 'system' ? (os === 'dark' ? 'nite' : 'day') : pref
}
