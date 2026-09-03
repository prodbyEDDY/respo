import { create } from 'zustand'
import type { ThemeSource } from '@shared/ipc'
import type { SecuritySettings } from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'

/** Same three values Electron's `nativeTheme.themeSource` accepts. */
export type Theme = ThemeSource
export type ResolvedTheme = 'light' | 'dark'

export interface SettingsState {
  /** User choice. `system` follows the OS preference. */
  theme: Theme
  /** `theme` with `system` collapsed to the value actually applied to the DOM. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  /**
   * Whether device views accept a certificate Chromium refused.
   *
   * Mirrors the document; main is the side that acts on it, and it only ever
   * applies to the device views — never to Respo's own window
   * (`main/security.ts`).
   */
  allowInsecureCertificates: boolean
  /**
   * Turn the certificate switch on or off.
   *
   * Takes effect on the next request, which for a page already showing an error
   * means a reload — said in the dialog rather than done here, because a reload
   * of every viewport is not a side effect a checkbox should have.
   */
  setAllowInsecureCertificates: (allow: boolean) => void
  /**
   * Apply the theme main restored at boot. Same effect as `setTheme` minus the
   * write-back: re-persisting what we were just handed is pure noise.
   */
  hydrate: (theme: Theme) => void
  /** Install the safety switches main restored at boot. Writes nothing back. */
  hydrateSecurity: (security: SecuritySettings) => void
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

export const useSettings = create<SettingsState>((set, get) => ({
  theme: INITIAL_THEME,
  resolvedTheme: initialResolvedTheme,
  // Off, always, until someone deliberately turns it on.
  allowInsecureCertificates: false,

  setAllowInsecureCertificates: (allow) => {
    if (get().allowInsecureCertificates === allow) return
    set({ allowInsecureCertificates: allow })
    savePersistedState({ security: { allowInsecureCertificates: allow } })
  },

  hydrateSecurity: (security) => {
    set({ allowInsecureCertificates: security.allowInsecureCertificates })
  },

  setTheme: (theme) => {
    const resolvedTheme = resolveTheme(theme)
    applyResolvedTheme(resolvedTheme)
    syncNativeTheme(theme)
    set({ theme, resolvedTheme })
    savePersistedState({ ui: { theme } })
  },

  hydrate: (theme) => {
    const resolvedTheme = resolveTheme(theme)
    applyResolvedTheme(resolvedTheme)
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
