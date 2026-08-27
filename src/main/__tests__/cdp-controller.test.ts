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
  failNext: Set<string>
}

let nextId = 1

function fakeTarget(): FakeTarget {
  const state = {
    attached: false,
    destroyed: false,
    attachedVersions: [] as string[],
    calls: [] as Array<[string, object | undefined]>,
    detachListener: null as ((event: unknown, reason: string) => void) | null,
    failNext: new Set<string>()
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
        return {}
      },
      on(_event: 'detach', listener: (event: unknown, reason: string) => void): void {
        state.detachListener = listener
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
      mobile: true
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
