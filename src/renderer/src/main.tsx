/*
 * Inter, self-hosted (@fontsource, OFL — the coordinator's font ruling).
 *
 * Three weights and no italics: the UI uses regular for body, medium for
 * captions and labels, semibold for headings, and nothing else. Every extra
 * face is a woff2 in the bundle that no rule would ever select.
 *
 * Imported here rather than from the stylesheet so the files go through Vite's
 * asset pipeline and ship with the app — a desktop app must not reach a font
 * CDN, and there is no network to reach it over.
 */
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'

import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
