import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DevtoolsStatePayload, MainEvent, RespoApi } from '@shared/ipc'
import { DEFAULT_DOCK_SIZE, MAX_DOCK_SIZE, MIN_DOCK_SIZE } from '@shared/persistence-types'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { attachPanelsBridge, selectDockVisible, selectIsOpen, usePanels } from '../panels'

type InvokeCall = { channel: string; args: unknown[] }

const calls: InvokeCall[] = []
let listeners: ((event: MainEvent) => void)[] = []
/** What the next `devtools:*` invoke resolves with. */
let reply: DevtoolsStatePayload = {
  dockedDeviceId: null,
  dock: 'bottom',
  detachedDeviceIds: []
}

/** The store installs what main answers, so a test has to let that land. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  calls.length = 0
  listeners = []
  reply = { dockedDeviceId: null, dock: 'bottom', detachedDeviceIds: [] }

  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(reply)
    },
    onMainEvent: (listener: (event: MainEvent) => void) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    }
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo

  usePanels.setState({
    dock: 'bottom',
    dockedDeviceId: null,
    detached: {},
    size: DEFAULT_DOCK_SIZE
  })
  savePersistedState.mockClear()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'respo')
})

describe('panels store — opening and closing', () => {
  it('asks main to open, and installs the state it answers with', async () => {
    reply = { dockedDeviceId: 'phone', dock: 'bottom', detachedDeviceIds: [] }
    usePanels.getState().open('phone')
    await settle()

    expect(calls).toEqual([{ channel: 'devtools:open', args: ['phone'] }])
    expect(usePanels.getState().dockedDeviceId).toBe('phone')
  })

  it('toggles: a second click on the same device closes it', async () => {
    usePanels.setState({ dockedDeviceId: 'phone' })
    usePanels.getState().toggle('phone')
    await settle()

    expect(calls).toEqual([{ channel: 'devtools:close', args: ['phone'] }])
  })

  it('closes the dock without naming a device', async () => {
    usePanels.getState().close()
    await settle()

    expect(calls).toEqual([{ channel: 'devtools:close', args: [null] }])
  })

  it('counts a detached window as open, so the device button stays lit', () => {
    usePanels.setState({ detached: { tablet: true } })
    expect(selectIsOpen(usePanels.getState(), 'tablet')).toBe(true)
    // ...but there is no strip to reserve for it.
    expect(selectDockVisible(usePanels.getState())).toBe(false)
  })

  it('reserves the strip only for a docked panel', () => {
    usePanels.setState({ dockedDeviceId: 'phone', dock: 'bottom' })
    expect(selectDockVisible(usePanels.getState())).toBe(true)

    usePanels.setState({ dock: 'undocked' })
    expect(selectDockVisible(usePanels.getState())).toBe(false)
  })
})

describe('panels store — the dock', () => {
  it('moves the strip on the click, then tells main and disk', async () => {
    reply = { dockedDeviceId: 'phone', dock: 'right', detachedDeviceIds: [] }
    usePanels.setState({ dockedDeviceId: 'phone' })

    usePanels.getState().setDock('right')
    // Optimistic: the edge is the renderer's own layout decision.
    expect(usePanels.getState().dock).toBe('right')
    expect(savePersistedState).toHaveBeenCalledWith({
      devtools: { dock: 'right', size: DEFAULT_DOCK_SIZE }
    })

    await settle()
    expect(calls).toEqual([{ channel: 'devtools:set-dock', args: ['right'] }])
  })

  it('does nothing when the edge is already the one asked for', () => {
    usePanels.getState().setDock('bottom')
    expect(calls).toEqual([])
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('clamps the dock size and writes it once', () => {
    usePanels.getState().setSize(10)
    expect(usePanels.getState().size).toBe(MIN_DOCK_SIZE)

    usePanels.getState().setSize(99_999)
    expect(usePanels.getState().size).toBe(MAX_DOCK_SIZE)

    savePersistedState.mockClear()
    usePanels.getState().setSize(MAX_DOCK_SIZE)
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('restores the shape of the panel, but never reopens it', () => {
    usePanels.getState().hydrate({ dock: 'right', size: 5 })

    expect(usePanels.getState().dock).toBe('right')
    expect(usePanels.getState().size).toBe(MIN_DOCK_SIZE)
    expect(usePanels.getState().dockedDeviceId).toBeNull()
    // Hydration is an install, not a change: nothing is written back.
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('panels store — main pushing state', () => {
  it('follows a DevTools window the user closed from its own title bar', () => {
    const release = attachPanelsBridge()
    usePanels.setState({ detached: { phone: true } })

    for (const listener of listeners) {
      listener({
        type: 'devtools-state',
        payload: { dockedDeviceId: null, dock: 'undocked', detachedDeviceIds: [] }
      })
    }

    expect(usePanels.getState().detached).toEqual({})
    release()
  })

  it('ignores every other kind of main event', () => {
    const release = attachPanelsBridge()
    usePanels.setState({ dockedDeviceId: 'phone' })

    for (const listener of listeners) listener({ type: 'load-state', payload: [] })

    expect(usePanels.getState().dockedDeviceId).toBe('phone')
    release()
  })

  it('subscribes once however many times it is attached', () => {
    const first = attachPanelsBridge()
    const second = attachPanelsBridge()
    expect(listeners).toHaveLength(1)

    // StrictMode tears the first one down while the second is still live.
    first()
    expect(listeners).toHaveLength(1)
    second()
    expect(listeners).toHaveLength(0)
  })
})
