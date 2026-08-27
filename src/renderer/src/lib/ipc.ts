import type { RespoApi } from '@shared/ipc'

/**
 * `window.respo` is installed by the preload bridge. It is absent whenever the
 * renderer runs outside Electron — unit tests, or the Vite dev server opened in
 * a plain browser — so callers must handle `null`.
 */
export function ipcBridge(): RespoApi | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { respo?: RespoApi }).respo ?? null
}
