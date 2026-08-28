import { beforeEach, describe, expect, it } from 'vitest'
import type { CdpTarget, Point } from '../cdp-controller'
import { deviceMenuTemplate, Inspector, type InspectCdp, type InspectDevtools } from '../inspector'

/** A device view, as the inspector knows one: an id on a CDP session. */
function fakeTarget(id: number): CdpTarget {
  return {
    id,
    isDestroyed: () => false,
    debugger: {
      isAttached: () => true,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: async () => ({}),
      on: () => undefined
    }
  }
}

type FakeCdp = InspectCdp & {
  /** Every `setInspectMode` call, as `[viewId, enabled]`. */
  modes: [number, boolean][]
  /** Fire an `Overlay.inspectNodeRequested` at one view's listeners. */
  pick: (id: number, params: unknown) => void
  /** What `nodePoint` answers with. `null` means "no box". */
  point: Point | null
  nodePointCalls: [number, number][]
}

function fakeCdp(): FakeCdp {
  const listeners = new Map<number, Set<(method: string, params: unknown) => void>>()

  const cdp: FakeCdp = {
    modes: [],
    point: { x: 10, y: 20 },
    nodePointCalls: [],
    pick: (id, params) => {
      for (const listener of listeners.get(id) ?? []) {
        listener('Overlay.inspectNodeRequested', params)
      }
    },
    setInspectMode: async (target, enabled) => {
      cdp.modes.push([target.id, enabled])
      return true
    },
    onEvent: (target, listener) => {
      const set = listeners.get(target.id) ?? new Set()
      set.add(listener)
      listeners.set(target.id, set)
      return () => set.delete(listener)
    },
    nodePoint: async (target, backendNodeId) => {
      cdp.nodePointCalls.push([target.id, backendNodeId])
      return cdp.point
    }
  }

  return cdp
}

type FakeDevtools = InspectDevtools & {
  inspected: [string, number, number][]
  opened: string[]
}

function fakeDevtools(): FakeDevtools {
  const devtools: FakeDevtools = {
    inspected: [],
    opened: [],
    inspectElement: (deviceId, x, y) => {
      devtools.inspected.push([deviceId, x, y])
    },
    openFor: (deviceId) => {
      devtools.opened.push(deviceId)
    }
  }
  return devtools
}

/** Let the `nodePoint` promise inside `picked` resolve. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Inspector', () => {
  let cdp: FakeCdp
  let devtools: FakeDevtools
  let states: boolean[]
  let inspector: Inspector
  const phone = fakeTarget(1)
  const tablet = fakeTarget(2)

  beforeEach(() => {
    cdp = fakeCdp()
    devtools = fakeDevtools()
    states = []
    inspector = new Inspector({ cdp, devtools, onState: (active) => states.push(active) })
    inspector.registerDevice({ deviceId: 'phone', target: phone })
    inspector.registerDevice({ deviceId: 'tablet', target: tablet })
  })

  it('arms every view at once — the toggle is global, not per device', () => {
    expect(inspector.setActive(true)).toBe(true)
    expect(cdp.modes).toEqual([
      [1, true],
      [2, true]
    ])
    expect(inspector.isActive()).toBe(true)
  })

  it('does nothing when asked for the mode it is already in', () => {
    inspector.setActive(true)
    cdp.modes.length = 0
    inspector.setActive(true)
    expect(cdp.modes).toEqual([])
  })

  it('disarms every view when switched off', () => {
    inspector.setActive(true)
    cdp.modes.length = 0

    expect(inspector.toggle()).toBe(false)
    expect(cdp.modes).toEqual([
      [1, false],
      [2, false]
    ])
  })

  it('arms a device that joins a canvas already in the mode', () => {
    inspector.setActive(true)
    cdp.modes.length = 0

    inspector.registerDevice({ deviceId: 'watch', target: fakeTarget(3) })
    expect(cdp.modes).toEqual([[3, true]])
  })

  it('opens the picked device DevTools on a point inside the picked node', async () => {
    inspector.setActive(true)
    cdp.point = { x: 40, y: 60 }

    cdp.pick(2, { backendNodeId: 12 })
    await settle()

    expect(cdp.nodePointCalls).toEqual([[2, 12]])
    expect(devtools.inspected).toEqual([['tablet', 40, 60]])
  })

  it('scales the point by the canvas zoom, because inspectElement is in widget pixels', async () => {
    inspector.setZoom('tablet', 0.5)
    inspector.setActive(true)
    cdp.point = { x: 40, y: 60 }

    cdp.pick(2, { backendNodeId: 12 })
    await settle()

    expect(devtools.inspected).toEqual([['tablet', 20, 30]])
  })

  it('ends the mode on the pick, and says so', async () => {
    inspector.setActive(true)
    cdp.modes.length = 0

    cdp.pick(1, { backendNodeId: 3 })
    await settle()

    expect(inspector.isActive()).toBe(false)
    expect(cdp.modes).toEqual([
      [1, false],
      [2, false]
    ])
    expect(states).toEqual([false])
  })

  it('still opens DevTools when the node has no usable box', async () => {
    inspector.setActive(true)
    cdp.point = null

    cdp.pick(1, { backendNodeId: 3 })
    await settle()

    expect(devtools.inspected).toEqual([])
    expect(devtools.opened).toEqual(['phone'])
  })

  it('still opens DevTools when the pick names no node at all', async () => {
    inspector.setActive(true)

    cdp.pick(1, { nothing: true })
    await settle()

    expect(devtools.opened).toEqual(['phone'])
  })

  it('stops listening to a device that left the canvas', async () => {
    inspector.setActive(true)
    inspector.retain(new Set(['tablet']))

    cdp.pick(1, { backendNodeId: 3 })
    await settle()

    expect(devtools.inspected).toEqual([])
    expect(devtools.opened).toEqual([])
  })

  it('re-arms a view that committed a new document while the mode was on', () => {
    inspector.setActive(true)
    cdp.modes.length = 0

    inspector.refresh('phone')
    expect(cdp.modes).toEqual([[1, true]])

    // ...and does nothing at all when the mode is off.
    inspector.setActive(false)
    cdp.modes.length = 0
    inspector.refresh('phone')
    expect(cdp.modes).toEqual([])
  })

  it('disarms every view on dispose and then stays inert', async () => {
    inspector.setActive(true)
    cdp.modes.length = 0

    inspector.dispose()
    expect(cdp.modes).toEqual([
      [1, false],
      [2, false]
    ])

    inspector.setActive(true)
    expect(inspector.isActive()).toBe(false)
    cdp.pick(1, { backendNodeId: 3 })
    await settle()
    expect(devtools.opened).toEqual([])
  })
})

describe('deviceMenuTemplate', () => {
  const actions = {
    calls: [] as [string, unknown][],
    inspectElement(x: number, y: number): void {
      actions.calls.push(['inspect', [x, y]])
    },
    openConsole(): void {
      actions.calls.push(['console', null])
    },
    reload(): void {
      actions.calls.push(['reload', null])
    },
    copyUrl(url: string): void {
      actions.calls.push(['copy', url])
    }
  }

  beforeEach(() => {
    actions.calls.length = 0
  })

  it('offers the four entries, in the order a browser does', () => {
    const items = deviceMenuTemplate({ x: 1, y: 2, url: 'https://example.com/' }, actions)
    expect(items.map((item) => item.label)).toEqual([
      'Inspect Element',
      'Open Console',
      'Reload',
      'Copy URL'
    ])
    expect(items.every((item) => item.enabled)).toBe(true)
  })

  it('passes the click point through untouched — Electron already reports it in view pixels', () => {
    const items = deviceMenuTemplate({ x: 37, y: 91, url: 'https://example.com/' }, actions)
    items[0]?.click()
    expect(actions.calls).toEqual([['inspect', [37, 91]]])
  })

  it('copies the page url, and reloads the page', () => {
    const items = deviceMenuTemplate({ x: 0, y: 0, url: 'https://example.com/x' }, actions)
    items[2]?.click()
    items[3]?.click()
    expect(actions.calls).toEqual([
      ['reload', null],
      ['copy', 'https://example.com/x']
    ])
  })

  it('has nothing to reload or copy on a view still sitting on the primer', () => {
    for (const url of ['', 'about:blank']) {
      const items = deviceMenuTemplate({ x: 0, y: 0, url }, actions)
      expect(items.map((item) => item.enabled)).toEqual([true, true, false, false])
    }
  })
})
