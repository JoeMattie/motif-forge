import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { App } from './App'
import { AppProvider } from './store/AppContext'
import { idbAdapter } from './store/idbAdapter'
import { theme } from './theme'
import '@mantine/core/styles.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <AppProvider adapter={idbAdapter}>
        <App />
      </AppProvider>
    </MantineProvider>
  </StrictMode>,
)
