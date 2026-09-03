import { useEffect } from 'react'
import { useLayout } from '@renderer/stores/layout'
import { usePanels } from '@renderer/stores/panels'

/**
 * Whether a key event is `mod+shift+l` — ctrl on Windows and Linux, cmd on
 * macOS.
 *
 * Shift is required rather than merely tolerated: `mod+l` is "focus the address
 * bar" in every browser there is, and Respo has an address bar. Alt is excluded
 * so the chord stays exactly one gesture.
 *
 * `event.key` rather than `code`, and the Cyrillic `д` alongside `l`, for the
 * same reason the screenshot chord accepts `ы`: the shortcut should follow the
 * letter printed on the key the user is actually pressing.
 */
function isLayoutChord(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false
  const key = event.key.toLowerCase()
  return key === 'l' || key === 'д'
}

/** Fields that own the keys they are typed into. */
function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * `mod+shift+l` cycles the canvas layout; Escape leaves individual mode.
 *
 * The same two guards the inspect chord learned: Escape belongs to whatever
 * surface is layered on top — a Radix dialog dismisses on it, a menu closes on
 * it, a field being typed in drops its draft — so this only claims Escape when
 * individual mode is the outermost thing that could answer it, and never over a
 * dialog. Ad-hoc rather than a keybinding library: three chords across the app
 * do not pay for a dependency.
 */
export function useLayoutHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleLayoutKey)
    return () => {
      window.removeEventListener('keydown', handleLayoutKey)
    }
  }, [])
}

/**
 * The whole of the behaviour, as a plain listener.
 *
 * Separate from the hook so its test can drive it directly — mounting React to
 * press one chord would be testing the mounting.
 */
export function handleLayoutKey(event: KeyboardEvent): void {
  const layout = useLayout.getState()

  if (isLayoutChord(event)) {
    // There are no frames to arrange while the device library has the window.
    if (layout.view !== 'canvas') return
    event.preventDefault()
    layout.cycleMode()
    return
  }

  if (event.key !== 'Escape' || layout.mode !== 'individual') return
  // One Escape dismisses one surface, innermost first. A dialog and the element
  // picker both sit above the canvas and both answer to it.
  if (typeof document !== 'undefined') {
    if (document.querySelector('[data-slot="dialog-content"]') !== null) return
    if (document.querySelector('[data-slot="dropdown-menu-content"]') !== null) return
    // The bookmark editor is a popover, and Escape is how it is dismissed.
    if (document.querySelector('[data-slot="popover-content"]') !== null) return
  }
  if (usePanels.getState().inspecting) return
  if (isEditing(event.target)) return
  layout.exitIndividual()
}
