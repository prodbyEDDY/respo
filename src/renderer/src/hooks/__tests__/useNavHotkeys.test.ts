import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigation } from '@renderer/stores/navigation'
import { handleNavKey } from '../useNavHotkeys'

const reload = vi.fn()

/** Press a key at the document, the way the window listener would see it. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  handleNavKey(event)
  return event
}

describe('the reload hotkeys', () => {
  beforeEach(() => {
    reload.mockClear()
    useNavigation.setState({ reload })
    document.body.replaceChildren()
  })

  it('mod+r reloads every device from cache, and keeps Chromium from reloading the window', () => {
    const event = press('r', { ctrlKey: true })
    expect(reload).toHaveBeenCalledWith(undefined)
    expect(event.defaultPrevented).toBe(true)
  })

  it('mod+shift+r reloads ignoring the cache', () => {
    press('R', { ctrlKey: true, shiftKey: true })
    expect(reload).toHaveBeenCalledWith({ ignoreCache: true })
  })

  it('answers cmd+r the same way, and follows the letter on the user’s own layout', () => {
    press('r', { metaKey: true })
    press('к', { ctrlKey: true })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('leaves a bare r and mod+alt+r alone', () => {
    press('r')
    press('r', { ctrlKey: true, altKey: true })
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing while a dialog owns the keyboard', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    document.body.append(dialog)

    const event = press('r', { ctrlKey: true })
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
