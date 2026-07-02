import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './store/AppContext'
import { idbAdapter } from './store/idbAdapter'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider adapter={idbAdapter}>
      <App />
    </AppProvider>
  </StrictMode>,
)
