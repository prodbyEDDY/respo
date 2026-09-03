import { beforeEach, describe, expect, it, vi } from 'vitest'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

const { openLocalFile } = vi.hoisted(() => ({ openLocalFile: vi.fn(async () => undefined) }))
vi.mock('@renderer/lib/browsing', () => ({ openLocalFile }))

import { useBookmarks } from '@renderer/stores/bookmarks'
import { useNavigation } from '@renderer/stores/navigation'
import { useNotices } from '@renderer/stores/notices'
import { handleAddressKey } from '../useAddressHotkeys'

/** Press a key at the document, the way the window listener would see it. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  handleAddressKey(event)
  return event
}

/** The address field, as the toolbar renders it. */
function addressInput(): HTMLInputElement {
  const input = document.createElement('input')
  input.setAttribute('data-slot', 'address-input')
  document.body.append(input)
  return input
}

describe('the address hotkeys', () => {
  beforeEach(() => {
    openLocalFile.mockClear()
    savePersistedState.mockClear()
    document.body.replaceChildren()
    useBookmarks.setState({ items: [], homeUrl: '' })
    useNotices.setState({ notice: null })
    useNavigation.setState({
      url: 'https://example.com/',
      perDevice: { a: { deviceId: 'a', state: 'ready', url: 'https://example.com/', title: 'Ex' } },
      leadDeviceId: 'a'
    })
  })

  describe('mod+d', () => {
    it('saves the page under the title it is showing', () => {
      const event = press('d', { ctrlKey: true })

      expect(useBookmarks.getState().items).toHaveLength(1)
      expect(useBookmarks.getState().items[0]).toMatchObject({
        url: 'https://example.com/',
        title: 'Ex'
      })
      expect(event.defaultPrevented).toBe(true)
    })

    it('says what it did, because the star is small', () => {
      press('d', { ctrlKey: true })
      expect(useNotices.getState().notice?.text).toBe('Bookmark added')

      press('d', { ctrlKey: true })
      expect(useNotices.getState().notice?.text).toBe('Bookmark removed')
    })

    it('unsaves a page that is saved', () => {
      press('d', { ctrlKey: true })
      press('d', { ctrlKey: true })

      expect(useBookmarks.getState().items).toEqual([])
    })

    it('says nothing about a canvas that has not been anywhere', () => {
      useNavigation.setState({ url: '' })
      press('d', { ctrlKey: true })

      expect(useBookmarks.getState().items).toEqual([])
      expect(useNotices.getState().notice).toBeNull()
    })

    it('answers cmd+d the same way, for the same keyboard on macOS', () => {
      press('d', { metaKey: true })
      expect(useBookmarks.getState().items).toHaveLength(1)
    })

    it('follows the letter on the user’s own layout', () => {
      press('в', { ctrlKey: true })
      expect(useBookmarks.getState().items).toHaveLength(1)
    })
  })

  describe('mod+l', () => {
    it('puts the cursor in the address bar', () => {
      const input = addressInput()
      const event = press('l', { ctrlKey: true })

      expect(document.activeElement).toBe(input)
      expect(event.defaultPrevented).toBe(true)
    })

    it('leaves mod+shift+l to the layout cycle', () => {
      const input = addressInput()
      const event = press('l', { ctrlKey: true, shiftKey: true })

      expect(document.activeElement).not.toBe(input)
      expect(event.defaultPrevented).toBe(false)
    })

    it('swallows nothing when there is no address bar to focus', () => {
      const event = press('l', { ctrlKey: true })
      expect(event.defaultPrevented).toBe(false)
    })
  })

  describe('mod+o', () => {
    it('opens the file dialog', () => {
      const event = press('o', { ctrlKey: true })

      expect(openLocalFile).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })
  })

  it('leaves a bare letter alone', () => {
    press('d')
    press('o')

    expect(useBookmarks.getState().items).toEqual([])
    expect(openLocalFile).not.toHaveBeenCalled()
  })

  it('defers to a dialog layered over the canvas', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    document.body.append(dialog)

    press('d', { ctrlKey: true })
    press('o', { ctrlKey: true })

    expect(useBookmarks.getState().items).toEqual([])
    expect(openLocalFile).not.toHaveBeenCalled()
  })
})
