import { readLocalStorageValue, useColorScheme, useLocalStorage } from '@mantine/hooks'

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

const ANTHROPIC_KEY_KEY = 'motif-forge:anthropic-key'

/**
 * User-supplied Anthropic API key, stored only in this browser. When set,
 * the client calls api.anthropic.com directly; when empty, dev builds fall
 * back to the Vite proxy (see src/api/client.ts).
 */
export function useAnthropicKey() {
  return useLocalStorage<string>({ key: ANTHROPIC_KEY_KEY, defaultValue: '' })
}

/** Same value for non-React code — reads through Mantine's serializer. */
export function getAnthropicKey(): string {
  return readLocalStorageValue<string>({ key: ANTHROPIC_KEY_KEY, defaultValue: '' })
}

/**
 * Whether Claude-powered features can run: a user-supplied key, or the dev
 * server's proxy fallback. Reactive — flips as soon as the key is saved.
 * `?no-dev-proxy` suppresses the fallback so e2e specs can exercise the
 * keyless production gating on the dev server; the whole branch is compiled
 * out of prod builds (import.meta.env.DEV is statically false there).
 */
export function useClaudeReady(): boolean {
  const [key] = useAnthropicKey()
  if (key.trim() !== '') return true
  return import.meta.env.DEV && !new URLSearchParams(window.location.search).has('no-dev-proxy')
}
