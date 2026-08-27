import { create } from 'zustand'
import type { ThemeSource } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/** Same three values Electron's `nativeTheme.themeSource` accepts. */
export type Theme = ThemeSource
export type ResolvedTheme = 'light' | 'dark'

export interface SettingsState {
  /** User choice. `system` follows the OS preference. */
  theme: Theme
  /** `theme` with `system` collapsed to the value actually applied to the DOM. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

/** `matchMedia` is missing in jsdom and in a non-browser context; degrade to light. */
function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DARK_MEDIA_QUERY)
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme
  return darkMediaQuery()?.matches === true ? 'dark' : 'light'
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

/** Keep the native window chrome (title bar, menus, scrollbars) in step. */
function syncNativeTheme(theme: Theme): void {
  const bridge = ipcBridge()
  if (bridge === null) return
  void bridge.invoke('theme:set-source', theme).catch((error: unknown) => {
    console.error('failed to sync native theme', error)
  })
}

const INITIAL_THEME: Theme = 'system'
const initialResolvedTheme = resolveTheme(INITIAL_THEME)
applyResolvedTheme(initialResolvedTheme)

export const useSettings = create<SettingsState>((set) => ({
  theme: INITIAL_THEME,
  resolvedTheme: initialResolvedTheme,
  setTheme: (theme) => {
    const resolvedTheme = resolveTheme(theme)
    applyResolvedTheme(resolvedTheme)
    syncNativeTheme(theme)
    set({ theme, resolvedTheme })
  }
}))

// Keep `system` following the OS for the lifetime of the window.
darkMediaQuery()?.addEventListener('change', () => {
  if (useSettings.getState().theme !== 'system') return
  const resolvedTheme = resolveTheme('system')
  applyResolvedTheme(resolvedTheme)
  useSettings.setState({ resolvedTheme })
})
