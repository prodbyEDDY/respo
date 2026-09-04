import { useEffect } from 'react'
import { useNavigation } from '@renderer/stores/navigation'

/**
 * Whether a key event is `mod+r` (or `mod+shift+r`) — ctrl on Windows and
 * Linux, cmd on macOS. Alt is excluded so the chord stays a reload and nothing
 * else; the Cyrillic letter on the same key counts, as it does everywhere.
 */
function isReloadChord(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key.toLowerCase()
  return key === 'r' || key === 'к'
}

/**
 * `mod+r` reloads every device; `mod+shift+r` reloads them ignoring the cache.
 *
 * The two chords every browser spends on the same two things, so nobody has
 * to learn them. Ad-hoc like the other hotkey hooks: two shortcuts do not pay
 * for a dependency (the registry is W6's).
 */
export function useNavHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleNavKey)
    return () => {
      window.removeEventListener('keydown', handleNavKey)
    }
  }, [])
}

/**
 * The whole of the behaviour, as a plain listener.
 *
 * Separate from the hook so its test can drive it directly — mounting React to
 * press one chord would be testing the mounting.
 */
export function handleNavKey(event: KeyboardEvent): void {
  if (!isReloadChord(event)) return
  // One surface at a time: a dialog above the canvas owns the keyboard.
  if (typeof document !== 'undefined' && document.querySelector('[data-slot="dialog-content"]')) {
    return
  }
  // Chromium would otherwise reload Respo's own window.
  event.preventDefault()
  useNavigation.getState().reload(event.shiftKey ? { ignoreCache: true } : undefined)
}
