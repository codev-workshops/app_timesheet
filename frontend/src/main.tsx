import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * Browser entry point: mounts the app into the `#root` element from
 * `index.html`.
 *
 * `StrictMode` intentionally double-invokes effects in development, so the
 * initial auth check in `AuthProvider` runs twice locally; that is expected and
 * harmless (it is an idempotent GET), not a bug to work around.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
