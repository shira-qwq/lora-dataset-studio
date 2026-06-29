import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme/theme.css'
import { initTheme } from './theme/applyTheme'
import { initCustomTheme } from './theme/customTheme'
import App from './App.tsx'

/* Apply persisted/default theme before React renders to prevent flash */
initTheme()
/* Restore custom theme overlay if active */
initCustomTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
