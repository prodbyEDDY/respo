import { useEffect } from 'react'
import { openLocalFile } from '@renderer/lib/browsing'
import { useBookmarks } from '@renderer/stores/bookmarks'
import { selectPageTitle, useNavigation } from '@renderer/stores/navigation'
import { useNotices } from '@renderer/stores/notices'

/**
 * The three chords the address cluster owns: `mod+d` saves the page, `mod+l`
 * puts the cursor in the address bar, `mod+o` opens a local file.
 *
 * All three are the gestures these keys already have in every browser, which is
 * the whole argument for them: someone who has used a browser knows them
 * already, and Respo has an address bar and a bookmark star for them to mean
 * something against.
 *
 * `event.key` rather than `code`, with the Cyrillic letters alongside, for the
 * same reason the screenshot and layout chords accept `ы` and `д`: the shortcut
 * follows the letter printed on the key the user is actually pressing.
 */
function chord(event: KeyboardEvent, latin: string, cyrillic: string): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false
  const key = event.key.toLowerCase()
  return key === latin || key === cyrillic
}

/** The address field, wherever it is. See `handleAddressKey`. */
const ADDRESS_INPUT = '[data-slot="address-input"]'

export function useAddressHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleAddressKey)
    return () => {
      window.removeEventListener('keydown', handleAddressKey)
    }
  }, [])
}

/**
 * The whole of the behaviour, as a plain listener.
 *
 * Separate from the hook so its test can drive it directly — mounting React to
 * press one chord would be testing the mounting. The address field is reached
 * through the DOM rather than a ref for the same reason: this listener belongs
 * to the window, not to any component, and threading a ref up to it would tie
 * three global shortcuts to one component's lifetime.
 */
export function handleAddressKey(event: KeyboardEvent): void {
  // One surface at a time: a dialog above the canvas owns the keyboard.
  if (typeof document !== 'undefined' && document.querySelector('[data-slot="dialog-content"]')) {
    return
  }

  if (chord(event, 'l', 'д')) {
    const input = document.querySelector<HTMLInputElement>(ADDRESS_INPUT)
    if (input === null) return
    // Chromium would otherwise focus its own (hidden) address bar.
    event.preventDefault()
    // Focusing selects the whole url — that is the field's own behaviour, and
    // it is what makes this chord "replace where I am" rather than "click here".
    input.focus()
    return
  }

  if (chord(event, 'd', 'в')) {
    event.preventDefault()
    const navigation = useNavigation.getState()
    const result = useBookmarks.getState().toggle(navigation.url, selectPageTitle(navigation))
    if (result === null) return
    // The star changes with it, but the star is small and the keyboard user is
    // not looking at it: say what happened.
    useNotices.getState().say('ok', result === 'added' ? 'Bookmark added' : 'Bookmark removed')
    return
  }

  if (chord(event, 'o', 'щ')) {
    event.preventDefault()
    void openLocalFile()
  }
}
