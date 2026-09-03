import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clearBrowsingData } = vi.hoisted(() => ({
  clearBrowsingData: vi.fn(async () => undefined)
}))
vi.mock('@renderer/lib/browsing', () => ({ clearBrowsingData, openLocalFile: vi.fn() }))

import { clearTargetFor, handleClearKey } from '../useClearHotkeys'

/** Press a key at the document, the way the window listener would see it. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  handleClearKey(event)
  return event
}

describe('the clear hotkeys', () => {
  beforeEach(() => {
    clearBrowsingData.mockClear()
    document.body.replaceChildren()
  })

  it.each([
    ['q', 'storage'],
    ['a', 'cookies'],
    ['z', 'cache'],
    ['Delete', 'all']
  ] as const)('mod+alt+%s clears %s', (key, target) => {
    const event = press(key, { ctrlKey: true, altKey: true })

    expect(clearBrowsingData).toHaveBeenCalledWith(target)
    expect(event.defaultPrevented).toBe(true)
  })

  it('answers cmd+alt too, for the same keyboard on macOS', () => {
    press('q', { metaKey: true, altKey: true })
    expect(clearBrowsingData).toHaveBeenCalledWith('storage')
  })

  it.each([
    ['й', 'storage'],
    ['ф', 'cookies'],
    ['я', 'cache']
  ] as const)('follows the letter on the user’s own layout: %s', (key, target) => {
    press(key, { ctrlKey: true, altKey: true })
    expect(clearBrowsingData).toHaveBeenCalledWith(target)
  })

  it.each([
    ['without alt — that is select-all', { ctrlKey: true }],
    ['without mod', { altKey: true }],
    ['with shift', { ctrlKey: true, altKey: true, shiftKey: true }],
    ['on its own', {}]
  ])('leaves %s alone', (_label, init) => {
    const event = press('a', init)

    expect(clearBrowsingData).not.toHaveBeenCalled()
    // Not ours to claim, so not ours to swallow either.
    expect(event.defaultPrevented).toBe(false)
  })

  it('claims no other letter', () => {
    press('k', { ctrlKey: true, altKey: true })
    expect(clearBrowsingData).not.toHaveBeenCalled()
  })

  it('defers to a dialog layered over the canvas', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    document.body.append(dialog)

    press('q', { ctrlKey: true, altKey: true })
    expect(clearBrowsingData).not.toHaveBeenCalled()
  })
})

describe('clearTargetFor', () => {
  it('reads the chord without acting on it', () => {
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, altKey: true })
    expect(clearTargetFor(event)).toBe('cache')
  })

  it('answers null for anything else', () => {
    expect(clearTargetFor(new KeyboardEvent('keydown', { key: 'z' }))).toBeNull()
  })
})
