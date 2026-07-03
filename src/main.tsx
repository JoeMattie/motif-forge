import { StrictMode, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, mergeThemeOverrides } from '@mantine/core'
import { App } from './App'
import { AppProvider } from './store/AppContext'
import { idbAdapter } from './store/idbAdapter'
import { theme } from './theme'
import { useThemePref, useResolvedTheme, useTooltipsEnabled } from './uiPrefs'
import { initNeural } from './generation/neural/client'
import '@mantine/core/styles.css'
import './styles.css'

// Neural tier gate: unsupported / idle / auto-load when already cached.
void initNeural()

// App-shell offline capability; model bytes live in OPFS, not the SW cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}

/**
 * Theme root: resolves the Day/Nite/System preference to `:root[data-theme]`
 * (which swaps the panel tokens) and Mantine's color scheme in lockstep, and
 * re-merges the theme when the tooltip preference flips.
 */
function Root() {
  const [tooltipsEnabled] = useTooltipsEnabled()
  const [themePref] = useThemePref()
  const resolved = useResolvedTheme(themePref)

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const merged = useMemo(
    () =>
      mergeThemeOverrides(theme, {
        components: { Tooltip: { defaultProps: { disabled: !tooltipsEnabled } } },
      }),
    [tooltipsEnabled],
  )
  return (
    <MantineProvider theme={merged} forceColorScheme={resolved === 'nite' ? 'dark' : 'light'}>
      <AppProvider adapter={idbAdapter}>
        <App />
      </AppProvider>
    </MantineProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
