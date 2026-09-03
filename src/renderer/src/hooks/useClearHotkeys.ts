import { useEffect } from 'react'
import type { ClearTarget } from '@shared/ipc'
import { clearBrowsingData } from '@renderer/lib/browsing'

/**
 * `mod+alt+q/a/z/del` clear storage, cookies, the cache, or all three.
 *
 * One column of adjacent keys, in the order the menu lists them, because these
 * are the shortcuts of someone iterating: clear, reload, look, clear again.
 * `alt` is what keeps them out of the way of `mod+a` (select all) and `mod+z`
 * (undo) in the fields Respo's own UI has.
 */
const TARGETS: readonly { latin: string; cyrillic: string; target: ClearTarget }[] = [
  { latin: 'q', cyrillic: 'й', target: 'storage' },
  { latin: 'a', cyrillic: 'ф', target: 'cookies' },
  { latin: 'z', cyrillic: 'я', target: 'cache' }
]

/** Which clear this event asks for, or `null`. */
export function clearTargetFor(event: KeyboardEvent): ClearTarget | null {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return null
  if (event.key === 'Delete') return 'all'

  const key = event.key.toLowerCase()
  return TARGETS.find((entry) => key === entry.latin || key === entry.cyrillic)?.target ?? null
}

export function useClearHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleClearKey)
    return () => {
      window.removeEventListener('keydown', handleClearKey)
    }
  }, [])
}

/**
 * The whole of the behaviour, as a plain listener.
 *
 * Separate from the hook so its test can drive it directly — mounting React to
 * press one chord would be testing the mounting.
 */
export function handleClearKey(event: KeyboardEvent): void {
  const target = clearTargetFor(event)
  if (target === null) return
  // One surface at a time: a dialog above the canvas owns the keyboard.
  if (typeof document !== 'undefined' && document.querySelector('[data-slot="dialog-content"]')) {
    return
  }

  event.preventDefault()
  void clearBrowsingData(target)
}
