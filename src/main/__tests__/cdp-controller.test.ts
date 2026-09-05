import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceSpec } from '@shared/types'
import { CDPController, isMobileDevice, type CdpTarget } from '../cdp-controller'

const IPHONE: DeviceSpec = {
  id: 'iphone-15-pro',
  name: 'iPhone 15 Pro',
  width: 393,
  height: 852,
  dpr: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
  touch: true
}

const DESKTOP: DeviceSpec = {
  id: 'desktop-1440',
  name: 'Desktop 1440',
  width: 1440,
  height: 900,
  dpr: 1,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0 Safari/537.36',
  touch: false
}

type FakeTarget = CdpTarget & {
  destroyed: boolean
  attachedVersions: string[]
  calls: Array<[string, object | undefined]>
  detachListener: ((event: unknown, reason: string) => void) | null
  fireDetach: (reason: string) => void
  /** Emit a protocol event, the way a page does through `debugger.on('message')`. */
  fireMessage: (method: string, params: unknown) => void
  failNext: Set<string>
  /** What `sendCommand` answers with, by method. Anything else answers `{}`. */
  replies: Map<string, unknown>
}

let nextId = 1

function fakeTarget(): FakeTarget {
  const state = {
    attached: false,
    destroyed: false,
    attachedVersions: [] as string[],
    calls: [] as Array<[string, object | undefined]>,
    detachListener: null as ((event: unknown, reason: string) => void) | null,
    messageListeners: [] as ((event: unknown, method: string, params: unknown) => void)[],
    failNext: new Set<string>(),
    replies: new Map<string, unknown>()
  }

  const target: FakeTarget = {
    id: nextId++,
    get destroyed(): boolean {
      return state.destroyed
    },
    set destroyed(value: boolean) {
      state.destroyed = value
    },
    get attachedVersions(): string[] {
      return state.attachedVersions
    },
    get calls(): Array<[string, object | undefined]> {
      return state.calls
    },
    get detachListener(): ((event: unknown, reason: string) => void) | null {
      return state.detachListener
    },
    get failNext(): Set<string> {
      return state.failNext
    },
    get replies(): Map<string, unknown> {
      return state.replies
    },
    fireMessage(method: string, params: unknown): void {
      for (const listener of state.messageListeners) listener(null, method, params)
    },
    fireDetach(reason: string): void {
      state.attached = false
      state.detachListener?.(null, reason)
    },
    isDestroyed: () => state.destroyed,
    debugger: {
      isAttached: () => state.attached,
      attach(version?: string): void {
        state.attached = true
        state.attachedVersions.push(version ?? '')
      },
      detach(): void {
        state.attached = false
      },
      async sendCommand(method: string, params?: object): Promise<unknown> {
        if (!state.attached) throw new Error('debugger not attached')
        if (state.failNext.has(method)) {
          state.failNext.delete(method)
          throw new Error(`${method} rejected`)
        }
        state.calls.push([method, params])
        return state.replies.get(method) ?? {}
      },
      on(event: 'detach' | 'message', listener: (...args: never[]) => void): void {
        if (event === 'detach') {
          state.detachListener = listener as unknown as (e: unknown, reason: string) => void
          return
        }
        state.messageListeners.push(
          listener as unknown as (e: unknown, method: string, params: unknown) => void
        )
      }
    }
  }

  return target
}

function methods(target: FakeTarget): string[] {
  return target.calls.map(([method]) => method)
}

function paramsOf(target: FakeTarget, method: string): object | undefined {
  return target.calls.find(([m]) => m === method)?.[1]
}

describe('isMobileDevice', () => {
  it('is true for phones and tablets', () => {
    expect(isMobileDevice(IPHONE)).toBe(true)
    expect(
      isMobileDevice({ ...IPHONE, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8)' })
    ).toBe(true)
  })

  it('is false for a desktop, even a touch one', () => {
    expect(isMobileDevice(DESKTOP)).toBe(false)
    // A Surface Pro is a touch device that still gets the desktop layout.
    expect(isMobileDevice({ ...DESKTOP, touch: true })).toBe(false)
  })
})

describe('CDPController.attach', () => {
  let controller: CDPController

  beforeEach(() => {
    controller = new CDPController()
  })

  it('attaches once, with protocol 1.3', async () => {
    const target = fakeTarget()
    await controller.attach(target)

    expect(target.attachedVersions).toEqual(['1.3'])
  })

  it('is idempotent — one session per view for its whole life', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.attach(target)
    await controller.attach(target)

    expect(target.attachedVersions).toEqual(['1.3'])
    expect(controller.attachedIds()).toEqual([target.id])
  })

  it('ignores a view that is already gone', async () => {
    const target = fakeTarget()
    target.destroyed = true
    await controller.attach(target)

    expect(target.attachedVersions).toEqual([])
  })

  it('degrades instead of throwing when the debugger is taken', async () => {
    const target = fakeTarget()
    vi.spyOn(target.debugger, 'attach').mockImplementation(() => {
      throw new Error('another debugger is already attached')
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(controller.attach(target)).resolves.toBeUndefined()
    expect(controller.attachedIds()).toEqual([])
    logged.mockRestore()
  })
})

describe('CDPController.applyDevice', () => {
  let controller: CDPController

  beforeEach(() => {
    controller = new CDPController()
  })

  it('sends metrics, touch and user agent', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)

    expect(methods(target)).toEqual([
      'Emulation.setDeviceMetricsOverride',
      'Emulation.setTouchEmulationEnabled',
      'Network.setUserAgentOverride'
    ])
    expect(paramsOf(target, 'Emulation.setDeviceMetricsOverride')).toEqual({
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      mobile: true,
      scale: 1
    })
    expect(paramsOf(target, 'Network.setUserAgentOverride')).toEqual({
      userAgent: IPHONE.userAgent
    })
  })

  it('enables touch with more than one touch point', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)

    const touch = paramsOf(target, 'Emulation.setTouchEmulationEnabled') as {
      enabled: boolean
      maxTouchPoints: number
    }
    expect(touch.enabled).toBe(true)
    expect(touch.maxTouchPoints).toBeGreaterThan(0)
  })

  it('turns touch off for a desktop and does not claim mobile', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)

    expect(paramsOf(target, 'Emulation.setTouchEmulationEnabled')).toMatchObject({ enabled: false })
    expect(paramsOf(target, 'Emulation.setDeviceMetricsOverride')).toMatchObject({ mobile: false })
  })

  it('falls back to the Emulation domain when the deprecated Network call is gone', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.failNext.add('Network.setUserAgentOverride')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await controller.applyDevice(target, IPHONE)

    expect(methods(target)).toContain('Emulation.setUserAgentOverride')
    logged.mockRestore()
  })

  it('survives a rejected command', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.failNext.add('Emulation.setDeviceMetricsOverride')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(controller.applyDevice(target, IPHONE)).resolves.toBeUndefined()
    // The rest of the profile still gets applied.
    expect(methods(target)).toContain('Network.setUserAgentOverride')
    logged.mockRestore()
  })

  it('sends nothing when there is no session', async () => {
    const target = fakeTarget()
    await controller.applyDevice(target, IPHONE)

    expect(target.calls).toEqual([])
  })
})

describe('CDPController detach handling', () => {
  let controller: CDPController

  beforeEach(() => {
    controller = new CDPController()
  })

  it('re-attaches and replays the device after an unexpected detach', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    target.calls.length = 0

    target.fireDetach('canceled by user')
    await vi.waitFor(() => expect(methods(target)).toContain('Network.setUserAgentOverride'))

    expect(methods(target)).toContain('Emulation.setDeviceMetricsOverride')
    expect(target.attachedVersions).toEqual(['1.3', '1.3'])
    expect(paramsOf(target, 'Network.setUserAgentOverride')).toEqual({
      userAgent: IPHONE.userAgent
    })
  })

  it('does not chase a closed target', async () => {
    const target = fakeTarget()
    await controller.attach(target)

    target.fireDetach('target closed')

    expect(target.attachedVersions).toEqual(['1.3'])
  })

  it('gives up rather than fighting a debugger that keeps evicting it', async () => {
    const target = fakeTarget()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await controller.attach(target)

    for (let i = 0; i < 10; i++) target.fireDetach('canceled by user')

    expect(target.attachedVersions.length).toBeLessThanOrEqual(4)
    logged.mockRestore()
  })

  it('detachSafe releases the session and stops re-attaching', async () => {
    const target = fakeTarget()
    await controller.attach(target)

    controller.detachSafe(target)
    expect(target.debugger.isAttached()).toBe(false)
    expect(controller.attachedIds()).toEqual([])

    target.fireDetach('canceled by user')
    expect(target.attachedVersions).toEqual(['1.3'])
  })

  it('detachSafe is a no-op for an unknown or destroyed view', () => {
    const target = fakeTarget()
    expect(() => controller.detachSafe(target)).not.toThrow()

    target.destroyed = true
    expect(() => controller.detachSafe(target)).not.toThrow()
  })

  it('detachAll releases every session', async () => {
    const a = fakeTarget()
    const b = fakeTarget()
    await controller.attach(a)
    await controller.attach(b)

    controller.detachAll()

    expect(controller.attachedIds()).toEqual([])
    expect(a.debugger.isAttached()).toBe(false)
    expect(b.debugger.isAttached()).toBe(false)
  })
})

describe('CDPController — the element picker', () => {
  let controller: CDPController

  beforeEach(() => {
    controller = new CDPController()
  })

  it('enables DOM before Overlay, because the picker is refused otherwise', async () => {
    const target = fakeTarget()
    await controller.attach(target)

    expect(await controller.setInspectMode(target, true)).toBe(true)
    expect(methods(target)).toEqual(['DOM.enable', 'Overlay.enable', 'Overlay.setInspectMode'])
    expect(paramsOf(target, 'Overlay.setInspectMode')).toMatchObject({ mode: 'searchForNode' })
  })

  it('turns the picker off with one call, without enabling anything', async () => {
    const target = fakeTarget()
    await controller.attach(target)

    await controller.setInspectMode(target, false)

    expect(methods(target)).toEqual(['Overlay.setInspectMode'])
    expect(paramsOf(target, 'Overlay.setInspectMode')).toEqual({ mode: 'none' })
  })

  it('does not arm a view with no live session', async () => {
    const target = fakeTarget()
    expect(await controller.setInspectMode(target, true)).toBe(false)
    expect(methods(target)).toEqual([])
  })

  it('stops at the first refusal instead of pretending the mode is on', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.failNext.add('DOM.enable')

    expect(await controller.setInspectMode(target, true)).toBe(false)
    expect(methods(target)).toEqual([])
  })

  it('delivers protocol events until unsubscribed', async () => {
    const target = fakeTarget()
    await controller.attach(target)

    const seen: [string, unknown][] = []
    const off = controller.onEvent(target, (method, params) => seen.push([method, params]))
    target.fireMessage('Overlay.inspectNodeRequested', { backendNodeId: 7 })
    off()
    target.fireMessage('Overlay.inspectNodeRequested', { backendNodeId: 8 })

    expect(seen).toEqual([['Overlay.inspectNodeRequested', { backendNodeId: 7 }]])
  })

  it('has nothing to subscribe to before a view is attached', () => {
    const target = fakeTarget()
    expect(() => controller.onEvent(target, () => undefined)()).not.toThrow()
  })
})

describe('CDPController.nodePoint', () => {
  let controller: CDPController

  /** A box model answer for a node occupying `rect`. */
  function boxOf(x: number, y: number, w: number, h: number): unknown {
    return { model: { content: [x, y, x + w, y, x + w, y + h, x, y + h] } }
  }

  beforeEach(() => {
    controller = new CDPController()
  })

  it('returns a point that hit-tests back to the very node that was picked', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.replies.set('DOM.getBoxModel', boxOf(0, 200, 200, 100))
    target.replies.set('DOM.getNodeForLocation', { backendNodeId: 11 })

    expect(await controller.nodePoint(target, 11)).toEqual({ x: 2, y: 202 })
    // The first candidate answered, so only one hit test was needed.
    expect(methods(target).filter((m) => m === 'DOM.getNodeForLocation')).toHaveLength(1)
  })

  it('keeps trying candidates while a child answers instead', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.replies.set('DOM.getBoxModel', boxOf(0, 0, 100, 100))

    let asked = 0
    target.replies.set('DOM.getNodeForLocation', { backendNodeId: 99 })
    const original = target.debugger.sendCommand.bind(target.debugger)
    target.debugger.sendCommand = async (method, params): Promise<unknown> => {
      const answer = await original(method, params)
      if (method !== 'DOM.getNodeForLocation') return answer
      asked += 1
      // Only the third candidate is really the node.
      return asked === 3 ? { backendNodeId: 5 } : { backendNodeId: 99 }
    }

    expect(await controller.nodePoint(target, 5)).toEqual({ x: 2, y: 98 })
    expect(asked).toBe(3)
  })

  it('falls back to the centre when nothing hit-tests back to it', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.replies.set('DOM.getBoxModel', boxOf(10, 10, 100, 40))
    target.replies.set('DOM.getNodeForLocation', { backendNodeId: 99 })

    expect(await controller.nodePoint(target, 5)).toEqual({ x: 60, y: 30 })
  })

  it('gives up on a node with no box — one that is not rendered', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.replies.set('DOM.getBoxModel', { model: { content: [1, 2] } })

    expect(await controller.nodePoint(target, 5)).toBeNull()
  })

  it('gives up when the view has no live session', async () => {
    const target = fakeTarget()
    expect(await controller.nodePoint(target, 5)).toBeNull()
  })
})

describe('CDPController.capture', () => {
  let controller: CDPController

  beforeEach(() => {
    controller = new CDPController()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  /** What a page answers `Page.captureScreenshot` with: base64 image data. */
  function reply(target: FakeTarget, text: string): void {
    target.replies.set('Page.captureScreenshot', { data: Buffer.from(text).toString('base64') })
  }

  it('decodes the protocol answer into image bytes', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    reply(target, 'png-bytes')

    const image = await controller.capture(target, {
      format: 'png',
      fullPage: false,
      dpr: 'device'
    })

    expect(image?.toString()).toBe('png-bytes')
    expect(paramsOf(target, 'Page.captureScreenshot')).toMatchObject({
      format: 'png',
      captureBeyondViewport: false
    })
  })

  it('asks for the whole document when the shot is full-page', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    reply(target, 'tall')

    await controller.capture(target, { format: 'png', fullPage: true, dpr: 'device' })
    expect(paramsOf(target, 'Page.captureScreenshot')).toMatchObject({
      captureBeyondViewport: true
    })
  })

  it('carries a quality for jpeg and none for png', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    reply(target, 'jpg')

    await controller.capture(target, { format: 'jpeg', fullPage: false, dpr: 'device' })
    const params = paramsOf(target, 'Page.captureScreenshot') as Record<string, unknown>
    expect(params['format']).toBe('jpeg')
    expect(typeof params['quality']).toBe('number')
  })

  it('drops to 1x on request and puts the device density back', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    reply(target, 'png')
    target.calls.length = 0

    await controller.capture(target, { format: 'png', fullPage: false, dpr: 1 })

    const overrides = target.calls
      .filter(([method]) => method === 'Emulation.setDeviceMetricsOverride')
      .map(([, params]) => params as Record<string, unknown>)
    expect(overrides).toHaveLength(2)
    // Down to 1x for the capture...
    expect(overrides[0]).toMatchObject({ width: 393, height: 852, deviceScaleFactor: 1 })
    // ...and back to exactly what the device spec says afterwards.
    expect(overrides[1]).toMatchObject({ width: 393, height: 852, deviceScaleFactor: 3 })
    // Order, not position: the density goes down before the picture is taken
    // and comes back after it.
    const order = methods(target)
    expect(order.indexOf('Emulation.setDeviceMetricsOverride')).toBeLessThan(
      order.indexOf('Page.captureScreenshot')
    )
    expect(order.lastIndexOf('Emulation.setDeviceMetricsOverride')).toBeGreaterThan(
      order.indexOf('Page.captureScreenshot')
    )
  })

  it('restores the device density even when the capture throws', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    target.calls.length = 0
    target.failNext.add('Page.captureScreenshot')

    expect(await controller.capture(target, { format: 'png', fullPage: false, dpr: 1 })).toBeNull()

    const overrides = target.calls
      .filter(([method]) => method === 'Emulation.setDeviceMetricsOverride')
      .map(([, params]) => params as Record<string, unknown>)
    expect(overrides.at(-1)).toMatchObject({ deviceScaleFactor: 3 })
  })

  it('does not touch the emulation for a device that is already 1x', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    reply(target, 'png')
    target.calls.length = 0

    await controller.capture(target, { format: 'png', fullPage: false, dpr: 1 })
    expect(methods(target)).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot'])
  })

  it('re-states the emulation after a full-page capture resized the frame', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    reply(target, 'png')
    target.calls.length = 0

    await controller.capture(target, { format: 'png', fullPage: true, dpr: 'device' })
    expect(methods(target)).toEqual([
      'Page.getLayoutMetrics',
      'Page.captureScreenshot',
      'Emulation.setDeviceMetricsOverride'
    ])
  })

  /**
   * Hold `Page.captureScreenshot` open until the test releases it.
   *
   * The fake resolves every command immediately, and everything this pair of
   * tests is about happens *during* a slow capture — a full-page shot of a tall
   * document is the case where the user has time to rotate a device or zoom the
   * canvas underneath it.
   */
  function hangingCapture(target: FakeTarget): (text: string) => void {
    let release: ((answer: unknown) => void) | null = null
    target.replies.set(
      'Page.captureScreenshot',
      new Promise((resolve) => {
        release = resolve
      })
    )
    return (text: string) => {
      release?.({ data: Buffer.from(text).toString('base64') })
    }
  }

  it('restores the zoom the view is at now, not the one it started at', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    target.calls.length = 0

    const release = hangingCapture(target)
    const capturing = controller.capture(target, { format: 'png', fullPage: true, dpr: 'device' })
    // The canvas is zoomed out while the document is still rastering.
    await Promise.resolve()
    controller.setZoom(target, 0.5)

    release('png')
    await capturing

    const overrides = target.calls
      .filter(([method]) => method === 'Emulation.setDeviceMetricsOverride')
      .map(([, params]) => params as Record<string, unknown>)
    // The last word on the emulation is the *new* zoom. Restoring the snapshot
    // taken before the capture would leave the page laying out at twice its
    // device width — and `setZoom` would never correct it, because as far as it
    // is concerned the zoom already is 0.5.
    expect(overrides.at(-1)).toMatchObject({ width: 720, height: 450 })
  })

  it('leaves the emulation alone when the device changed under the capture', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    target.calls.length = 0

    const release = hangingCapture(target)
    const capturing = controller.capture(target, { format: 'png', fullPage: true, dpr: 'device' })
    await Promise.resolve()
    // The user rotated the device mid-capture: `applyDevice` has already stated
    // the landscape metrics, and the restore must not put the old ones back.
    await controller.applyDevice(target, { ...DESKTOP, width: 900, height: 1440 })

    release('png')
    await capturing

    const overrides = target.calls
      .filter(([method]) => method === 'Emulation.setDeviceMetricsOverride')
      .map(([, params]) => params as Record<string, unknown>)
    expect(overrides.at(-1)).toMatchObject({ width: 900, height: 1440 })
    // And nothing was appended after `applyDevice` finished saying it.
    expect(methods(target).at(-1)).toBe('Network.setUserAgentOverride')
  })

  it('answers with nothing when the page returns no data, or there is no session', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    target.replies.set('Page.captureScreenshot', { data: '' })
    expect(
      await controller.capture(target, { format: 'png', fullPage: false, dpr: 'device' })
    ).toBeNull()

    const detached = fakeTarget()
    expect(
      await controller.capture(detached, { format: 'png', fullPage: false, dpr: 'device' })
    ).toBeNull()
  })
})

describe('CDPController — canvas zoom and the emulated viewport', () => {
  let controller: CDPController

  beforeEach(() => {
    controller = new CDPController()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  function overridesOf(target: FakeTarget): Record<string, unknown>[] {
    return target.calls
      .filter(([method]) => method === 'Emulation.setDeviceMetricsOverride')
      .map(([, params]) => params as Record<string, unknown>)
  }

  it('divides a desktop override by the zoom, so the page keeps its own width', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    target.calls.length = 0

    controller.setZoom(target, 0.5)
    await Promise.resolve()

    // Page zoom multiplies CSS pixels by 1/0.5 on the way in, so half the
    // widget is a whole 1440px viewport.
    expect(overridesOf(target)).toEqual([
      { width: 720, height: 450, deviceScaleFactor: 1, mobile: false, scale: 1 }
    ])
  })

  it('paints a mobile override at the zoom instead: that emulation swallows page zoom', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    target.calls.length = 0

    controller.setZoom(target, 0.5)
    await Promise.resolve()

    // The page still lays out at 393px; only the painting is half size.
    expect(overridesOf(target)).toEqual([
      { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, scale: 0.5 }
    ])
  })

  it('ignores a zoom that did not change', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    target.calls.length = 0

    controller.setZoom(target, 1)
    await Promise.resolve()

    expect(methods(target)).toEqual([])
  })

  it('captures a zoomed mobile view at full size, then paints it small again', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, IPHONE)
    controller.setZoom(target, 0.5)
    await Promise.resolve()
    target.calls.length = 0

    await controller.capture(target, { format: 'png', fullPage: false, dpr: 'device' })

    const overrides = overridesOf(target)
    expect(overrides).toHaveLength(2)
    // Before the shot: the emulated viewport painted 1:1, at the device density.
    expect(overrides[0]).toEqual({
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      mobile: true,
      scale: 1
    })
    // After: the canvas's own picture again.
    expect(overrides[1]).toEqual({
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      mobile: true,
      scale: 0.5
    })
  })

  it('keeps the zoom for the emulation that follows a device change', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    controller.setZoom(target, 0.5)
    await controller.applyDevice(target, DESKTOP)

    expect(overridesOf(target)[0]).toMatchObject({ width: 720, height: 450 })
  })

  it('replays the zoomed emulation after an unexpected detach', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    controller.setZoom(target, 0.5)
    await Promise.resolve()
    target.calls.length = 0

    target.fireDetach('crashed')
    await Promise.resolve()
    await Promise.resolve()

    expect(overridesOf(target)[0]).toMatchObject({ width: 720, height: 450 })
  })

  it('ignores a zoom that is not a scale', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    target.calls.length = 0

    controller.setZoom(target, 0)
    controller.setZoom(target, Number.NaN)
    await Promise.resolve()

    expect(methods(target)).toEqual([])
  })

  it('clips a capture to the device viewport, not to the zoomed widget', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    controller.setZoom(target, 0.5)
    target.replies.set('Page.getLayoutMetrics', {
      cssContentSize: { width: 1440, height: 4000 },
      cssVisualViewport: { pageX: 0, pageY: 120, clientWidth: 1425, clientHeight: 900 }
    })
    target.replies.set('Page.captureScreenshot', { data: Buffer.from('x').toString('base64') })

    await controller.capture(target, { format: 'png', fullPage: false, dpr: 'device' })
    // The device's own width, not the page's `clientWidth` (which stops at the
    // scrollbar) and not the widget's 720.
    expect(paramsOf(target, 'Page.captureScreenshot')).toMatchObject({
      clip: { x: 0, y: 120, width: 1440, height: 900, scale: 1 }
    })

    target.calls.length = 0
    await controller.capture(target, { format: 'png', fullPage: true, dpr: 'device' })
    expect(paramsOf(target, 'Page.captureScreenshot')).toMatchObject({
      clip: { x: 0, y: 0, width: 1440, height: 4000, scale: 1 }
    })
  })

  it('captures unclipped when the page will not say how big it is', async () => {
    const target = fakeTarget()
    await controller.attach(target)
    await controller.applyDevice(target, DESKTOP)
    target.replies.set('Page.getLayoutMetrics', {})
    target.replies.set('Page.captureScreenshot', { data: Buffer.from('x').toString('base64') })
    target.calls.length = 0

    // A spec is known here, so the clip still comes out of it; the fallback is
    // for a view whose device we never learned.
    await controller.capture(target, { format: 'png', fullPage: false, dpr: 'device' })
    expect(paramsOf(target, 'Page.captureScreenshot')).toMatchObject({
      clip: { width: 1440, height: 900 }
    })
  })
})
