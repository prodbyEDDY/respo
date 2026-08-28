import { beforeEach, describe, expect, it } from 'vitest'
import type { DevtoolsStatePayload } from '@shared/ipc'
import type { Rect } from '@shared/types'
import {
  DevtoolsManager,
  type CreateDevtoolsPanel,
  type DevtoolsHost,
  type DevtoolsPanel,
  type PanelMode
} from '../devtools-manager'

type FakeHost = DevtoolsHost & {
  /** What `openDevTools` was last called with, in order. */
  opens: { activate: boolean | undefined }[]
  closes: number
  /** Frontend ids handed to `setDevToolsWebContents`, in order. */
  bound: number[]
  inspected: [number, number][]
  destroyed: boolean
  devtoolsOpen: boolean
}

function fakeHost(): FakeHost {
  const host: FakeHost = {
    opens: [],
    closes: 0,
    bound: [],
    inspected: [],
    destroyed: false,
    devtoolsOpen: false,
    isDestroyed: () => host.destroyed,
    openDevTools: (options) => {
      host.devtoolsOpen = true
      host.opens.push({ activate: options.activate })
    },
    closeDevTools: () => {
      host.devtoolsOpen = false
      host.closes += 1
    },
    setDevToolsWebContents: (frontend) => {
      host.bound.push(frontend.id)
    },
    inspectElement: (x, y) => {
      host.inspected.push([x, y])
    }
  }
  return host
}

type FakePanel = DevtoolsPanel & {
  mode: PanelMode
  deviceId: string
  title: string
  bounds: Rect | null
  destroyed: boolean
  /** Panels the frontend was asked to bring to the front, in order. */
  panelsShown: string[]
  /** Simulate the user closing this panel's own window. */
  userClose: () => void
}

function makeFactory(): { create: CreateDevtoolsPanel; panels: FakePanel[] } {
  const panels: FakePanel[] = []
  let nextId = 1

  const create: CreateDevtoolsPanel = ({ mode, deviceId, title }) => {
    const listeners: (() => void)[] = []
    const panel: FakePanel = {
      frontend: { id: nextId++ },
      mode,
      deviceId,
      title,
      bounds: null,
      destroyed: false,
      panelsShown: [],
      setBounds: (bounds) => {
        panel.bounds = bounds
      },
      showPanel: (name) => {
        panel.panelsShown.push(name)
      },
      onClosed: (listener) => {
        listeners.push(listener)
      },
      destroy: () => {
        panel.destroyed = true
      },
      userClose: () => {
        for (const listener of listeners) listener()
      }
    }
    panels.push(panel)
    return panel
  }

  return { create, panels }
}

describe('DevtoolsManager', () => {
  let factory: ReturnType<typeof makeFactory>
  let states: DevtoolsStatePayload[]
  let phone: FakeHost
  let tablet: FakeHost
  let manager: DevtoolsManager

  function build(dock: 'bottom' | 'right' | 'undocked' = 'bottom'): DevtoolsManager {
    const made = new DevtoolsManager({
      createPanel: factory.create,
      dock,
      deviceName: (id) => (id === 'phone' ? 'iPhone 15' : undefined),
      onState: (state) => states.push(state)
    })
    made.registerDevice('phone', phone)
    made.registerDevice('tablet', tablet)
    return made
  }

  beforeEach(() => {
    factory = makeFactory()
    states = []
    phone = fakeHost()
    tablet = fakeHost()
    manager = build()
  })

  it('docks a device by binding a frontend it built and then opening DevTools', () => {
    manager.openFor('phone')

    const panel = factory.panels[0]
    expect(panel?.mode).toBe('docked')
    // Order matters: Electron binds the frontend at open time.
    expect(phone.bound).toEqual([panel?.frontend.id])
    expect(phone.opens).toHaveLength(1)
    expect(manager.state()).toEqual({
      dockedDeviceId: 'phone',
      dock: 'bottom',
      detachedDeviceIds: []
    })
  })

  it('keeps at most one dock: opening another device retargets it', () => {
    manager.openFor('phone')
    manager.openFor('tablet')

    expect(phone.closes).toBe(1)
    expect(factory.panels[0]?.destroyed).toBe(true)
    expect(factory.panels[1]?.mode).toBe('docked')
    expect(manager.state().dockedDeviceId).toBe('tablet')
  })

  it('builds a fresh frontend for every open, because Electron cannot reuse one', () => {
    manager.openFor('phone')
    manager.close('phone')
    manager.openFor('phone')

    expect(factory.panels).toHaveLength(2)
    expect(factory.panels[0]?.destroyed).toBe(true)
    expect(phone.bound).toEqual([factory.panels[0]?.frontend.id, factory.panels[1]?.frontend.id])
  })

  it('re-opening the same docked device changes nothing', () => {
    manager.openFor('phone')
    manager.openFor('phone')

    expect(factory.panels).toHaveLength(1)
    expect(phone.closes).toBe(0)
  })

  it('closes the dock when asked without a device id', () => {
    manager.openFor('phone')
    manager.close(null)

    expect(phone.closes).toBe(1)
    expect(factory.panels[0]?.destroyed).toBe(true)
    expect(manager.state().dockedDeviceId).toBeNull()
  })

  it('moves the docked device into a window of its own', () => {
    manager.openFor('phone')
    manager.setDock('undocked')

    expect(factory.panels[1]?.mode).toBe('window')
    // The device name, so a taskbar full of these is still readable.
    expect(factory.panels[1]?.title).toBe('DevTools — iPhone 15')
    expect(manager.state()).toEqual({
      dockedDeviceId: null,
      dock: 'undocked',
      detachedDeviceIds: ['phone']
    })
  })

  it('takes the newest window back into the dock', () => {
    manager = build('undocked')
    manager.openFor('phone')
    manager.openFor('tablet')
    expect(manager.state().detachedDeviceIds).toEqual(['phone', 'tablet'])

    manager.setDock('right')

    expect(manager.state()).toEqual({
      dockedDeviceId: 'tablet',
      dock: 'right',
      detachedDeviceIds: ['phone']
    })
  })

  it('leaves the panel alone when only the docked edge changes', () => {
    manager.openFor('phone')
    manager.setDock('right')

    expect(factory.panels).toHaveLength(1)
    expect(phone.closes).toBe(0)
    expect(manager.state().dock).toBe('right')
  })

  it('positions only the docked panel, and remembers the strip for the next one', () => {
    const strip: Rect = { x: 0, y: 500, width: 1400, height: 320 }
    manager.setBounds(strip)
    manager.openFor('phone')
    expect(factory.panels[0]?.bounds).toEqual(strip)

    const taller: Rect = { x: 0, y: 400, width: 1400, height: 420 }
    manager.setBounds(taller)
    expect(factory.panels[0]?.bounds).toEqual(taller)

    manager.setDock('undocked')
    manager.setBounds(strip)
    // A window is placed by the user; the strip means nothing to it.
    expect(factory.panels[1]?.bounds).toBeNull()
  })

  it('reconciles when the user closes a DevTools window from its title bar', () => {
    manager = build('undocked')
    manager.openFor('phone')
    states.length = 0

    factory.panels[0]?.userClose()

    expect(manager.state().detachedDeviceIds).toEqual([])
    expect(states.at(-1)?.detachedDeviceIds).toEqual([])
  })

  it('closes and frees the panel when its device leaves the canvas', () => {
    manager.openFor('phone')
    states.length = 0

    manager.retain(new Set(['tablet']))

    expect(phone.closes).toBe(1)
    expect(factory.panels[0]?.destroyed).toBe(true)
    expect(manager.state().dockedDeviceId).toBeNull()
    expect(states.at(-1)?.dockedDeviceId).toBeNull()
  })

  it('ignores a device it has never been told about', () => {
    expect(manager.openFor('watch')).toEqual({
      dockedDeviceId: null,
      dock: 'bottom',
      detachedDeviceIds: []
    })
    expect(factory.panels).toHaveLength(0)
  })

  it('ignores a device whose page is already gone', () => {
    phone.destroyed = true
    manager.openFor('phone')

    expect(factory.panels).toHaveLength(0)
    expect(manager.state().dockedDeviceId).toBeNull()
  })

  it('opens DevTools with the console showing, every time it is asked', () => {
    manager.openConsole('phone')
    expect(factory.panels[0]?.panelsShown).toEqual(['console'])

    // Already open on some other panel: the request is what the user wants.
    manager.openConsole('phone')
    expect(factory.panels).toHaveLength(1)
    expect(factory.panels[0]?.panelsShown).toEqual(['console', 'console'])
  })

  it('opens DevTools before asking it to select an element', () => {
    manager.inspectElement('phone', 12.4, 40.6)

    expect(manager.state().dockedDeviceId).toBe('phone')
    expect(phone.inspected).toEqual([[12, 41]])
  })

  it('reports state changes only when the state actually changed', () => {
    manager.openFor('phone')
    manager.openFor('phone')
    manager.setBounds({ x: 0, y: 0, width: 10, height: 10 })

    expect(states).toHaveLength(1)
  })

  it('tears everything down on dispose and then stays inert', () => {
    manager = build('undocked')
    manager.openFor('phone')
    manager.openFor('tablet')

    manager.dispose()

    expect(factory.panels.every((panel) => panel.destroyed)).toBe(true)
    expect(phone.closes).toBe(1)
    expect(tablet.closes).toBe(1)

    manager.openFor('phone')
    expect(factory.panels).toHaveLength(2)
  })
})
