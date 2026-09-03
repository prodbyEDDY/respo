import { beforeEach, describe, expect, it, vi } from 'vitest'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useLayout } from '@renderer/stores/layout'
import { usePanels } from '@renderer/stores/panels'
import { handleLayoutKey } from '../useLayoutHotkeys'

/** Press a key at the document, the way the window listener would see it. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  handleLayoutKey(event)
  return event
}

function mode(): string {
  return useLayout.getState().mode
}

describe('the layout hotkeys', () => {
  beforeEach(() => {
    useLayout.setState({
      view: 'canvas',
      mode: 'flex',
      individualDeviceId: null,
      beforeIndividual: null,
      zoom: 1
    })
    usePanels.setState({ inspecting: false })
    document.body.replaceChildren()
  })

  it('mod+shift+l steps to the next arrangement, and keeps the key from the page', () => {
    const event = press('L', { ctrlKey: true, shiftKey: true })

    expect(mode()).toBe('masonry')
    expect(event.defaultPrevented).toBe(true)
  })

  it('answers cmd+shift+l the same way, for the same keyboard on macOS', () => {
    press('l', { metaKey: true, shiftKey: true })
    expect(mode()).toBe('masonry')
  })

  it('follows the letter on the key, not the layout the OS is in', () => {
    press('д', { ctrlKey: true, shiftKey: true })
    expect(mode()).toBe('masonry')
  })

  it('leaves mod+l alone — that is the address bar in every browser there is', () => {
    press('l', { ctrlKey: true })
    expect(mode()).toBe('flex')
  })

  it('does nothing while the device library has the window', () => {
    useLayout.setState({ view: 'devices' })
    const event = press('l', { ctrlKey: true, shiftKey: true })

    expect(mode()).toBe('flex')
    expect(event.defaultPrevented).toBe(false)
  })

  it('Escape leaves individual mode for the arrangement it came from', () => {
    useLayout.setState({ mode: 'column' })
    useLayout.getState().enterIndividual('ipad-mini')

    press('Escape')
    expect(mode()).toBe('column')
  })

  it('ignores Escape in every other arrangement, so nothing else is stolen', () => {
    press('Escape')
    expect(mode()).toBe('flex')
  })

  it('leaves Escape to a dialog layered over the canvas', () => {
    useLayout.getState().enterIndividual('ipad-mini')
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    document.body.append(dialog)

    press('Escape')
    expect(mode()).toBe('individual')
  })

  it('leaves Escape to an open menu', () => {
    useLayout.getState().enterIndividual('ipad-mini')
    const menu = document.createElement('div')
    menu.setAttribute('data-slot', 'dropdown-menu-content')
    document.body.append(menu)

    press('Escape')
    expect(mode()).toBe('individual')
  })

  it('leaves Escape to the element picker, which is the inner surface', () => {
    useLayout.getState().enterIndividual('ipad-mini')
    usePanels.setState({ inspecting: true })

    press('Escape')
    expect(mode()).toBe('individual')
  })

  it('leaves Escape to a field that is being typed in', () => {
    useLayout.getState().enterIndividual('ipad-mini')
    const input = document.createElement('input')
    document.body.append(input)

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    Object.defineProperty(event, 'target', { value: input })
    handleLayoutKey(event)

    expect(mode()).toBe('individual')
  })
})
