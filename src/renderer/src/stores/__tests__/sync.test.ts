import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RespoApi } from '@shared/ipc'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { __resetLeadBatchForTests, useSync } from '../sync'

type InvokeCall = { channel: string; args: unknown[] }

const calls: InvokeCall[] = []

/** Frames are driven by hand: the lead election is coalesced onto one. */
let frames: Array<() => void> = []

function runFrame(): void {
  const pending = frames
  frames = []
  for (const frame of pending) frame()
}

beforeEach(() => {
  calls.length = 0
  frames = []

  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)

  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(undefined)
    },
    onMainEvent: () => () => undefined
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo

  __resetLeadBatchForTests()
  useSync.setState({ globalEnabled: true, disabled: {}, leadDeviceId: null })
  savePersistedState.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'respo')
})

function channelCalls(channel: string): unknown[][] {
  return calls.filter((c) => c.channel === channel).map((c) => c.args)
}

describe('sync store — the global switch', () => {
  it('starts on: mirroring is the product, not an opt-in', () => {
    expect(useSync.getState().globalEnabled).toBe(true)
  })

  it('toggling tells main and persists the new value', () => {
    useSync.getState().toggleGlobal()

    expect(useSync.getState().globalEnabled).toBe(false)
    expect(channelCalls('sync:set-global')).toEqual([[false]])
    expect(savePersistedState).toHaveBeenCalledWith({
      sync: { enabled: false, disabledDeviceIds: [] }
    })
  })

  it('toggles back', () => {
    useSync.getState().toggleGlobal()
    useSync.getState().toggleGlobal()
    expect(useSync.getState().globalEnabled).toBe(true)
    expect(channelCalls('sync:set-global')).toEqual([[false], [true]])
  })

  it('carries the muted devices along, so one write never undoes the other', () => {
    useSync.getState().toggleDevice('pixel-8')
    savePersistedState.mockClear()

    useSync.getState().toggleGlobal()
    expect(savePersistedState).toHaveBeenCalledWith({
      sync: { enabled: false, disabledDeviceIds: ['pixel-8'] }
    })
  })
})

describe('sync store — per-device mirroring', () => {
  it('every device mirrors until it is switched off', () => {
    expect(useSync.getState().disabled['pixel-8']).toBeUndefined()
  })

  it('muting a device tells main and persists the exception', () => {
    useSync.getState().toggleDevice('pixel-8')

    expect(useSync.getState().disabled['pixel-8']).toBe(true)
    expect(channelCalls('sync:set-enabled')).toEqual([['pixel-8', false]])
    expect(savePersistedState).toHaveBeenCalledWith({
      sync: { enabled: true, disabledDeviceIds: ['pixel-8'] }
    })
  })

  it('un-muting removes the exception rather than storing a false', () => {
    useSync.getState().toggleDevice('pixel-8')
    useSync.getState().toggleDevice('pixel-8')

    expect(useSync.getState().disabled['pixel-8']).toBeUndefined()
    expect(channelCalls('sync:set-enabled')).toEqual([
      ['pixel-8', false],
      ['pixel-8', true]
    ])
    expect(savePersistedState).toHaveBeenLastCalledWith({
      sync: { enabled: true, disabledDeviceIds: [] }
    })
  })

  it('keeps the devices apart', () => {
    useSync.getState().toggleDevice('pixel-8')
    useSync.getState().toggleDevice('ipad-mini')
    expect(savePersistedState).toHaveBeenLastCalledWith({
      sync: { enabled: true, disabledDeviceIds: ['pixel-8', 'ipad-mini'] }
    })
  })
})

describe('sync store — forgetting a device', () => {
  it('drops the mute, tells main, and persists what is left', () => {
    useSync.getState().toggleDevice('custom-my-phone')
    useSync.getState().toggleDevice('pixel-8')
    calls.length = 0
    savePersistedState.mockClear()

    useSync.getState().forgetDevice('custom-my-phone')

    expect(useSync.getState().disabled).toEqual({ 'pixel-8': true })
    // Main keeps its own set, and it outlives the view.
    expect(channelCalls('sync:set-enabled')).toEqual([['custom-my-phone', true]])
    expect(savePersistedState).toHaveBeenCalledWith({
      sync: { enabled: true, disabledDeviceIds: ['pixel-8'] }
    })
  })

  it('costs nothing for a device that was never muted', () => {
    useSync.getState().forgetDevice('pixel-8')
    expect(calls).toEqual([])
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('sync store — resetting the switches', () => {
  it('turns mirroring back on and forgets every mute, in main too', () => {
    useSync.getState().toggleGlobal()
    useSync.getState().toggleDevice('pixel-8')
    useSync.getState().toggleDevice('ipad-mini')
    calls.length = 0
    savePersistedState.mockClear()

    useSync.getState().resetSwitches()

    expect(useSync.getState()).toMatchObject({ globalEnabled: true, disabled: {} })
    expect(channelCalls('sync:set-global')).toEqual([[true]])
    expect(channelCalls('sync:set-enabled')).toEqual([
      ['pixel-8', true],
      ['ipad-mini', true]
    ])
    expect(savePersistedState).toHaveBeenCalledWith({
      sync: { enabled: true, disabledDeviceIds: [] }
    })
  })

  it('writes nothing when the switches are already at their defaults', () => {
    useSync.getState().resetSwitches()
    expect(calls).toEqual([])
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('sync store — lead election', () => {
  it('shows the ring immediately, without waiting for a round trip', () => {
    useSync.getState().setLead('pixel-8')
    expect(useSync.getState().leadDeviceId).toBe('pixel-8')
    expect(channelCalls('sync:set-lead')).toEqual([])
  })

  it('reports the election once the frame runs', () => {
    useSync.getState().setLead('pixel-8')
    runFrame()
    expect(channelCalls('sync:set-lead')).toEqual([['pixel-8']])
  })

  it('a pointer sweeping across frames costs one message, for where it landed', () => {
    useSync.getState().setLead('iphone-15-pro')
    useSync.getState().setLead('pixel-8')
    useSync.getState().setLead('ipad-mini')
    runFrame()

    expect(channelCalls('sync:set-lead')).toEqual([['ipad-mini']])
  })

  it('re-entering the same frame spends nothing', () => {
    useSync.getState().setLead('pixel-8')
    runFrame()
    useSync.getState().setLead('pixel-8')
    runFrame()

    expect(channelCalls('sync:set-lead')).toEqual([['pixel-8']])
  })

  it('leaving the canvas clears the lead, even as the very first election', () => {
    // Main opens a session leading whichever view registered first, so "no
    // lead" is a real change and has to travel.
    useSync.getState().setLead(null)
    runFrame()

    expect(useSync.getState().leadDeviceId).toBeNull()
    expect(channelCalls('sync:set-lead')).toEqual([[null]])
  })

  it('a muted device is never elected: it would drive nothing', () => {
    useSync.getState().setLead('iphone-15-pro')
    runFrame()
    useSync.getState().toggleDevice('pixel-8')
    calls.length = 0

    useSync.getState().setLead('pixel-8')
    runFrame()

    // The lead stays where it was, and main is told nothing new.
    expect(useSync.getState().leadDeviceId).toBe('iphone-15-pro')
    expect(channelCalls('sync:set-lead')).toEqual([])
  })

  it('muting the device the pointer is on gives up the lead', () => {
    useSync.getState().setLead('pixel-8')
    runFrame()

    useSync.getState().toggleDevice('pixel-8')
    runFrame()

    expect(useSync.getState().leadDeviceId).toBeNull()
    expect(channelCalls('sync:set-lead')).toEqual([['pixel-8'], [null]])
  })

  it('still lets the pointer leave the canvas', () => {
    useSync.getState().toggleDevice('pixel-8')
    useSync.getState().setLead(null)
    runFrame()
    expect(channelCalls('sync:set-lead')).toEqual([[null]])
  })

  it('a lead election is never persisted: it is where the pointer is', () => {
    useSync.getState().setLead('pixel-8')
    runFrame()
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('sync store — hydration', () => {
  it('installs the restored switches without writing them back', () => {
    useSync.getState().hydrate({ enabled: false, disabledDeviceIds: ['pixel-8', 'ipad-mini'] })

    expect(useSync.getState().globalEnabled).toBe(false)
    expect(useSync.getState().disabled).toEqual({ 'pixel-8': true, 'ipad-mini': true })
    expect(savePersistedState).not.toHaveBeenCalled()
    // Main applied these to the engine before the first view existed.
    expect(calls).toEqual([])
  })
})
