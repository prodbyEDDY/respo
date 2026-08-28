import { beforeEach, describe, expect, it, vi } from 'vitest'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useLayout } from '@renderer/stores/layout'
import { usePanels } from '@renderer/stores/panels'
import { handleInspectKey } from '../useInspectHotkeys'

/** Press a key at the document, the way the window listener would see it. */
function press(
  key: string,
  init: Partial<KeyboardEventInit> = {},
  target: EventTarget | null = null
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  if (target !== null) Object.defineProperty(event, 'target', { value: target })
  handleInspectKey(event)
  return event
}

describe('the inspect hotkeys', () => {
  beforeEach(() => {
    usePanels.setState({ inspecting: false })
    useLayout.setState({ view: 'canvas' })
    document.body.replaceChildren()
  })

  it('mod+i arms the picker, and again puts it away', () => {
    const armed = press('i', { ctrlKey: true })
    expect(usePanels.getState().inspecting).toBe(true)
    // Claimed, so nothing else answers the same chord.
    expect(armed.defaultPrevented).toBe(true)

    press('i', { ctrlKey: true })
    expect(usePanels.getState().inspecting).toBe(false)
  })

  it('answers cmd+i too, for the mac build', () => {
    press('I', { metaKey: true })
    expect(usePanels.getState().inspecting).toBe(true)
  })

  it('leaves mod+shift+i alone — that chord means "open DevTools" everywhere else', () => {
    press('i', { ctrlKey: true, shiftKey: true })
    expect(usePanels.getState().inspecting).toBe(false)
  })

  it('leaves a bare i alone, so nobody arms a picker by typing', () => {
    press('i')
    expect(usePanels.getState().inspecting).toBe(false)
  })

  it('does not arm a picker over the device library, which has no pages in it', () => {
    useLayout.setState({ view: 'devices' })
    press('i', { ctrlKey: true })
    expect(usePanels.getState().inspecting).toBe(false)
  })

  it('Escape puts the picker away', () => {
    usePanels.setState({ inspecting: true })
    press('Escape')
    expect(usePanels.getState().inspecting).toBe(false)
  })

  it('leaves Escape to the dialog on top of the canvas', () => {
    usePanels.setState({ inspecting: true })
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    document.body.append(dialog)

    press('Escape')
    expect(usePanels.getState().inspecting).toBe(true)
  })

  it('leaves Escape to the field being typed in', () => {
    usePanels.setState({ inspecting: true })
    const input = document.createElement('input')
    document.body.append(input)

    press('Escape', {}, input)
    expect(usePanels.getState().inspecting).toBe(true)
  })

  it('ignores Escape when the picker is not on', () => {
    const event = press('Escape')
    expect(event.defaultPrevented).toBe(false)
    expect(usePanels.getState().inspecting).toBe(false)
  })
})
