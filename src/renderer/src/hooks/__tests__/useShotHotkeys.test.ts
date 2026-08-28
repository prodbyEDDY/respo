import { beforeEach, describe, expect, it, vi } from 'vitest'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useLayout } from '@renderer/stores/layout'
import { useShots } from '@renderer/stores/shots'
import { handleShotKey } from '../useShotHotkeys'

const captureAll = vi.fn()

/** Press a key at the document, the way the window listener would see it. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  handleShotKey(event)
  return event
}

describe('the screenshot hotkey', () => {
  beforeEach(() => {
    captureAll.mockClear()
    useShots.setState({ captureAll })
    useLayout.setState({ view: 'canvas' })
    document.body.replaceChildren()
  })

  it('mod+s photographs every device, and keeps the browser from saving the page', () => {
    const event = press('s', { ctrlKey: true })

    expect(captureAll).toHaveBeenCalledWith({ fullPage: false })
    expect(event.defaultPrevented).toBe(true)
  })

  it('answers cmd+s the same way, for the same keyboard on macOS', () => {
    press('s', { metaKey: true })
    expect(captureAll).toHaveBeenCalledTimes(1)
  })

  it('holding alt asks for the whole pages', () => {
    press('s', { ctrlKey: true, altKey: true })
    expect(captureAll).toHaveBeenCalledWith({ fullPage: true })
  })

  it('follows the letter on the user’s own layout', () => {
    press('ы', { ctrlKey: true })
    expect(captureAll).toHaveBeenCalledTimes(1)
  })

  it('leaves mod+shift+s alone, and a bare s with it', () => {
    press('s', { ctrlKey: true, shiftKey: true })
    press('s')
    expect(captureAll).not.toHaveBeenCalled()
  })

  it('does nothing while the device library has the window', () => {
    useLayout.setState({ view: 'devices' })
    const event = press('s', { ctrlKey: true })

    expect(captureAll).not.toHaveBeenCalled()
    // Not ours to claim, so not ours to swallow either.
    expect(event.defaultPrevented).toBe(false)
  })

  it('defers to a dialog layered over the canvas', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    document.body.append(dialog)

    press('s', { ctrlKey: true })
    expect(captureAll).not.toHaveBeenCalled()
  })
})
