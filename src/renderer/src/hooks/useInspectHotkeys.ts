import { useEffect } from 'react'
import { useLayout } from '@renderer/stores/layout'
import { usePanels } from '@renderer/stores/panels'

/**
 * Whether a key event is `mod+i` — ctrl on Windows and Linux, cmd on macOS.
 *
 * `event.key` rather than `code`, so the shortcut follows the letter the user's
 * layout actually produces. Alt and shift are excluded: `mod+shift+i` is the
 * browser gesture for "open DevTools", and answering it with a different
 * feature would be worse than not answering it.
 */
function isInspectChord(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
  return event.key === 'i' || event.key === 'I'
}

/** Fields that own the keys they are typed into. */
function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * `mod+i` arms the element picker; Escape puts it away.
 *
 * Two guards, both learned from the device library: Escape belongs to whatever
 * surface is layered on top — a Radix dialog dismisses on it, a field being
 * typed in drops its draft on it — so the picker only claims Escape when it is
 * the thing that is actually on, and never when a dialog is open. Ad-hoc rather
 * than a keybinding library: two chords do not pay for a dependency, and this
 * matches how the manager already listens.
 */
export function useInspectHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleInspectKey)
    return () => {
      window.removeEventListener('keydown', handleInspectKey)
    }
  }, [])
}

/**
 * The whole of the behaviour, as a plain listener.
 *
 * Separate from the hook so it can be driven directly by its test — the stores
 * it reads are the same ones in either case, and mounting React to press two
 * keys would test the mounting.
 */
export function handleInspectKey(event: KeyboardEvent): void {
  const panels = usePanels.getState()

  if (isInspectChord(event)) {
    // The picker points at device pages, and the library replaces them.
    if (useLayout.getState().view !== 'canvas') return
    event.preventDefault()
    panels.toggleInspecting()
    return
  }

  if (event.key !== 'Escape' || !panels.inspecting) return
  // One Escape dismisses one surface, and a dialog above the canvas is the one
  // the user is looking at.
  if (document.querySelector('[data-slot="dialog-content"]') !== null) return
  if (isEditing(event.target)) return
  panels.setInspecting(false)
}
