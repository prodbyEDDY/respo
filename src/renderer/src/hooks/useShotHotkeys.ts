import { useEffect } from 'react'
import { useLayout } from '@renderer/stores/layout'
import { useShots } from '@renderer/stores/shots'

/**
 * Whether a key event is `mod+s` — ctrl on Windows and Linux, cmd on macOS.
 *
 * Shift is excluded so `mod+shift+s` stays free, and alt is *not*: it is the
 * same modifier the per-device camera reads, and it means the same thing here —
 * the whole page rather than the viewport.
 */
function isShotChord(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return false
  return event.key === 's' || event.key === 'S' || event.key === 'ы' || event.key === 'Ы'
}

/**
 * `mod+s` screenshots every device; hold alt for their whole pages.
 *
 * The gesture a browser spends on "save this page", which Respo has no use for
 * — and screenshotting the canvas is the thing people do here over and over.
 * Ad-hoc, like the inspect chord: two shortcuts do not pay for a dependency.
 */
export function useShotHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleShotKey)
    return () => {
      window.removeEventListener('keydown', handleShotKey)
    }
  }, [])
}

/**
 * The whole of the behaviour, as a plain listener.
 *
 * Separate from the hook so its test can drive it directly — mounting React to
 * press one chord would be testing the mounting.
 */
export function handleShotKey(event: KeyboardEvent): void {
  if (!isShotChord(event)) return
  // There are no device frames to photograph while the library has the window.
  if (useLayout.getState().view !== 'canvas') return
  // One surface at a time: a dialog above the canvas owns the keyboard.
  if (typeof document !== 'undefined' && document.querySelector('[data-slot="dialog-content"]')) {
    return
  }

  // Chromium would otherwise open its own "save page" dialog over the canvas.
  event.preventDefault()
  useShots.getState().captureAll({ fullPage: event.altKey })
}
