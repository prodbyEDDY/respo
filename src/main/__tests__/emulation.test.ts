import { beforeEach, describe, expect, it } from 'vitest'
import { defaultEmulationProfile, NETWORK_CONDITIONS } from '@shared/emulation'
import type { CdpTarget, ViewEmulation } from '../cdp-controller'
import { EmulationManager, resolveViewEmulation, type EmulationCdp } from '../emulation'

type Applied = { id: number; emulation: ViewEmulation }

/** A `CDPController` that only remembers what it was asked to apply. */
function fakeCdp(): EmulationCdp & { applied: Applied[] } {
  const applied: Applied[] = []
  return {
    applied,
    async applyEmulation(target, next) {
      applied.push({ id: target.id, emulation: next })
    }
  }
}

let nextId = 1
function target(): CdpTarget {
  return {
    id: nextId++,
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

describe('resolveViewEmulation', () => {
  it('turns the profile into protocol-shaped values', () => {
    const profile = { ...defaultEmulationProfile(), network: 'slow-4g' as const }
    expect(resolveViewEmulation(profile, undefined)).toEqual({
      media: 'auto',
      colorScheme: 'system',
      reducedMotion: false,
      forcedColors: false,
      vision: 'none',
      network: NETWORK_CONDITIONS['slow-4g'],
      geolocation: null,
      locale: null,
      timezone: null
    })
  })

  it('lets a device override win over the profile, and only for vision', () => {
    const profile = { ...defaultEmulationProfile(), vision: 'protanopia' as const }
    expect(resolveViewEmulation(profile, 'none').vision).toBe('none')
    expect(resolveViewEmulation(profile, 'deuteranopia').vision).toBe('deuteranopia')
    expect(resolveViewEmulation(profile, undefined).vision).toBe('protanopia')
  })

  it('copies the position rather than sharing it', () => {
    const profile = { ...defaultEmulationProfile(), geolocation: { latitude: 1, longitude: 2 } }
    const resolved = resolveViewEmulation(profile, undefined)
    expect(resolved.geolocation).toEqual({ latitude: 1, longitude: 2 })
    expect(resolved.geolocation).not.toBe(profile.geolocation)
  })
})

describe('EmulationManager', () => {
  let cdp: ReturnType<typeof fakeCdp>
  let manager: EmulationManager

  beforeEach(() => {
    cdp = fakeCdp()
    manager = new EmulationManager({ cdp })
  })

  it('applies the current profile to a view as it registers', async () => {
    const view = target()
    await manager.registerDevice({ deviceId: 'a', target: view })

    expect(cdp.applied).toHaveLength(1)
    expect(cdp.applied[0]?.id).toBe(view.id)
    expect(cdp.applied[0]?.emulation.colorScheme).toBe('system')
    expect(manager.deviceIds()).toEqual(['a'])
  })

  it('puts a profile change on every registered view', async () => {
    const a = target()
    const b = target()
    await manager.registerDevice({ deviceId: 'a', target: a })
    await manager.registerDevice({ deviceId: 'b', target: b })
    cdp.applied.length = 0

    manager.setProfile({ ...defaultEmulationProfile(), colorScheme: 'dark' })

    expect(cdp.applied.map((entry) => entry.id)).toEqual([a.id, b.id])
    expect(cdp.applied.every((entry) => entry.emulation.colorScheme === 'dark')).toBe(true)
    expect(manager.state().profile.colorScheme).toBe('dark')
  })

  it('overrides one device’s vision and leaves the others on the profile', async () => {
    const a = target()
    const b = target()
    await manager.registerDevice({ deviceId: 'a', target: a })
    await manager.registerDevice({ deviceId: 'b', target: b })
    manager.setProfile({ ...defaultEmulationProfile(), vision: 'protanopia' })
    cdp.applied.length = 0

    manager.setDeviceVision('a', 'deuteranopia')

    expect(cdp.applied).toEqual([
      { id: a.id, emulation: expect.objectContaining({ vision: 'deuteranopia' }) }
    ])
    expect(manager.state().deviceVision).toEqual({ a: 'deuteranopia' })

    // The profile still wins on the device that has no override.
    cdp.applied.length = 0
    manager.setProfile({ ...defaultEmulationProfile(), vision: 'tritanopia' })
    expect(cdp.applied.find((entry) => entry.id === a.id)?.emulation.vision).toBe('deuteranopia')
    expect(cdp.applied.find((entry) => entry.id === b.id)?.emulation.vision).toBe('tritanopia')
  })

  it('"none" on a device is an override, not the absence of one', async () => {
    const a = target()
    await manager.registerDevice({ deviceId: 'a', target: a })
    manager.setProfile({ ...defaultEmulationProfile(), vision: 'protanopia' })
    cdp.applied.length = 0

    manager.setDeviceVision('a', 'none')

    expect(cdp.applied[0]?.emulation.vision).toBe('none')
    expect(manager.state().deviceVision).toEqual({ a: 'none' })
  })

  it('inheriting again removes the override and re-applies the profile', async () => {
    const a = target()
    await manager.registerDevice({ deviceId: 'a', target: a })
    manager.setProfile({ ...defaultEmulationProfile(), vision: 'protanopia' })
    manager.setDeviceVision('a', 'deuteranopia')
    cdp.applied.length = 0

    manager.setDeviceVision('a', null)

    expect(cdp.applied[0]?.emulation.vision).toBe('protanopia')
    expect(manager.state().deviceVision).toEqual({})
  })

  it('says nothing to the view when nothing changed', async () => {
    const a = target()
    await manager.registerDevice({ deviceId: 'a', target: a })
    cdp.applied.length = 0

    manager.setDeviceVision('a', null)
    manager.setDeviceVision('a', 'deuteranopia')
    manager.setDeviceVision('a', 'deuteranopia')

    expect(cdp.applied).toHaveLength(1)
  })

  it('remembers an override for a device that has no view yet', async () => {
    manager.setDeviceVision('later', 'achromatopsia')
    expect(cdp.applied).toHaveLength(0)

    await manager.registerDevice({ deviceId: 'later', target: target() })
    expect(cdp.applied[0]?.emulation.vision).toBe('achromatopsia')
  })

  it('restores what the last session left, before any view exists', async () => {
    const restored = new EmulationManager({
      cdp,
      initial: {
        profile: { ...defaultEmulationProfile(), locale: 'de-DE', timezone: 'Europe/Berlin' },
        deviceVision: { a: 'tritanopia' }
      }
    })

    await restored.registerDevice({ deviceId: 'a', target: target() })
    await restored.registerDevice({ deviceId: 'b', target: target() })

    expect(cdp.applied[0]?.emulation).toMatchObject({
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
      vision: 'tritanopia'
    })
    expect(cdp.applied[1]?.emulation.vision).toBe('none')
  })

  it('retain drops the views that left but keeps their overrides', async () => {
    await manager.registerDevice({ deviceId: 'a', target: target() })
    await manager.registerDevice({ deviceId: 'b', target: target() })
    manager.setDeviceVision('b', 'deuteranopia')

    manager.retain(new Set(['a']))

    expect(manager.deviceIds()).toEqual(['a'])
    expect(manager.state().deviceVision).toEqual({ b: 'deuteranopia' })

    // …so the device comes back the way it left.
    cdp.applied.length = 0
    await manager.registerDevice({ deviceId: 'b', target: target() })
    expect(cdp.applied[0]?.emulation.vision).toBe('deuteranopia')
  })

  it('caps the override map so a renderer cannot grow it without bound', () => {
    for (let i = 0; i < 300; i += 1) manager.setDeviceVision(`ghost-${i}`, 'protanopia')
    expect(Object.keys(manager.state().deviceVision).length).toBeLessThanOrEqual(256)
    // An existing entry can still be changed once the cap is reached.
    manager.setDeviceVision('ghost-0', 'tritanopia')
    expect(manager.state().deviceVision['ghost-0']).toBe('tritanopia')
  })

  it('does nothing after dispose', async () => {
    manager.dispose()
    await manager.registerDevice({ deviceId: 'a', target: target() })
    manager.setProfile({ ...defaultEmulationProfile(), colorScheme: 'dark' })
    manager.setDeviceVision('a', 'protanopia')

    expect(cdp.applied).toHaveLength(0)
    expect(manager.deviceIds()).toEqual([])
  })
})
