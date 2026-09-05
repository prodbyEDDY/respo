import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultEmulationProfile } from '@shared/emulation'
import type { RespoApi } from '@shared/ipc'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { selectDeviceVision, selectEmulationActive, useEmulation } from '../emulation'

type InvokeCall = { channel: string; args: unknown[] }
const calls: InvokeCall[] = []

beforeEach(() => {
  calls.length = 0
  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(undefined)
    },
    onMainEvent: () => () => undefined
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo

  useEmulation.setState({ profile: defaultEmulationProfile(), deviceVision: {} })
  savePersistedState.mockClear()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'respo')
})

function channelCalls(channel: string): unknown[][] {
  return calls.filter((c) => c.channel === channel).map((c) => c.args)
}

describe('emulation store — the profile', () => {
  it('starts with nothing overridden', () => {
    expect(selectEmulationActive(useEmulation.getState())).toBe(false)
  })

  it('sends the whole profile to main and persists it on every change', () => {
    useEmulation.getState().setProfile({ colorScheme: 'dark' })

    const expected = { ...defaultEmulationProfile(), colorScheme: 'dark' }
    expect(useEmulation.getState().profile).toEqual(expected)
    expect(channelCalls('emulation:set')).toEqual([[expected]])
    expect(savePersistedState).toHaveBeenCalledWith({
      emulation: { profile: expected, deviceVision: {} }
    })
    expect(selectEmulationActive(useEmulation.getState())).toBe(true)
  })

  it('keeps earlier fields when patching another', () => {
    useEmulation.getState().setProfile({ locale: 'de-DE' })
    useEmulation.getState().setProfile({ timezone: 'Europe/Berlin' })

    expect(useEmulation.getState().profile).toMatchObject({
      locale: 'de-DE',
      timezone: 'Europe/Berlin'
    })
  })

  it('carries the device overrides along, so one write never undoes the other', () => {
    useEmulation.getState().setDeviceVision('pixel-8', 'deuteranopia')
    savePersistedState.mockClear()

    useEmulation.getState().setProfile({ network: 'offline' })

    expect(savePersistedState).toHaveBeenCalledWith({
      emulation: {
        profile: { ...defaultEmulationProfile(), network: 'offline' },
        deviceVision: { 'pixel-8': 'deuteranopia' }
      }
    })
  })
})

describe('emulation store — per-device vision', () => {
  it('every device follows the profile until it is overridden', () => {
    useEmulation.getState().setProfile({ vision: 'protanopia' })
    expect(selectDeviceVision(useEmulation.getState(), 'pixel-8')).toBe('protanopia')
  })

  it('an override tells main and persists the exception', () => {
    useEmulation.getState().setDeviceVision('pixel-8', 'deuteranopia')

    expect(selectDeviceVision(useEmulation.getState(), 'pixel-8')).toBe('deuteranopia')
    expect(channelCalls('emulation:set-device-vision')).toEqual([['pixel-8', 'deuteranopia']])
    expect(savePersistedState).toHaveBeenCalledWith({
      emulation: { profile: defaultEmulationProfile(), deviceVision: { 'pixel-8': 'deuteranopia' } }
    })
  })

  it('inheriting again removes the key rather than storing it', () => {
    useEmulation.getState().setDeviceVision('pixel-8', 'deuteranopia')
    useEmulation.getState().setDeviceVision('pixel-8', null)

    expect(useEmulation.getState().deviceVision).toEqual({})
    expect(channelCalls('emulation:set-device-vision')).toEqual([
      ['pixel-8', 'deuteranopia'],
      ['pixel-8', null]
    ])
  })

  it('says nothing when the override is already what it is', () => {
    useEmulation.getState().setDeviceVision('pixel-8', null)
    expect(calls).toHaveLength(0)
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('emulation store — reset and hydrate', () => {
  it('reset clears the profile and every override in one write', () => {
    useEmulation.getState().setProfile({ colorScheme: 'dark', locale: 'de-DE' })
    useEmulation.getState().setDeviceVision('pixel-8', 'deuteranopia')
    calls.length = 0
    savePersistedState.mockClear()

    useEmulation.getState().resetAll()

    expect(useEmulation.getState().profile).toEqual(defaultEmulationProfile())
    expect(useEmulation.getState().deviceVision).toEqual({})
    expect(channelCalls('emulation:set')).toEqual([[defaultEmulationProfile()]])
    expect(channelCalls('emulation:set-device-vision')).toEqual([['pixel-8', null]])
    expect(savePersistedState).toHaveBeenCalledTimes(1)
    expect(savePersistedState).toHaveBeenCalledWith({
      emulation: { profile: defaultEmulationProfile(), deviceVision: {} }
    })
  })

  it('reset is a no-op when nothing is on', () => {
    useEmulation.getState().resetAll()
    expect(calls).toHaveLength(0)
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('hydrate installs the document without sending or writing anything', () => {
    useEmulation.getState().hydrate({
      profile: { ...defaultEmulationProfile(), timezone: 'Asia/Tokyo' },
      deviceVision: { 'iphone-15-pro': 'tritanopia' }
    })

    expect(useEmulation.getState().profile.timezone).toBe('Asia/Tokyo')
    expect(selectDeviceVision(useEmulation.getState(), 'iphone-15-pro')).toBe('tritanopia')
    expect(calls).toHaveLength(0)
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})
