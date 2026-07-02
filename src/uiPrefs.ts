import { useLocalStorage } from '@mantine/hooks'

/**
 * Global toggle for explanatory hover tooltips. Persisted per browser;
 * multiple hook instances stay in sync within the tab.
 */
export function useTooltipsEnabled() {
  return useLocalStorage<boolean>({ key: 'motif-forge:tooltips', defaultValue: true })
}
