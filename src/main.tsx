import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, mergeThemeOverrides } from '@mantine/core'
import { App } from './App'
import { AppProvider } from './store/AppContext'
import { idbAdapter } from './store/idbAdapter'
import { theme } from './theme'
import { useTooltipsEnabled } from './uiPrefs'
import '@mantine/core/styles.css'
import './styles.css'

/** Theme root: re-merges the theme when the tooltip preference flips. */
function Root() {
  const [tooltipsEnabled] = useTooltipsEnabled()
  const merged = useMemo(
    () =>
      mergeThemeOverrides(theme, {
        components: { Tooltip: { defaultProps: { disabled: !tooltipsEnabled } } },
      }),
    [tooltipsEnabled],
  )
  return (
    <MantineProvider theme={merged} defaultColorScheme="dark">
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
