import { describe, expect, it } from 'vitest'
import {
  CUSTOM_ID_PREFIX,
  catalogWithCustom,
  defaultRotatable,
  defaultTouch,
  defaultUserAgent,
  deviceTypeOf,
  draftFromDevice,
  draftWithType,
  emptyDraft,
  isRotatable,
  makeCustomDeviceId,
  matchesQuery,
  validateDraft,
  type DeviceDraft
} from '../custom-devices'
import { DEVICE_CATALOG, deviceById } from '../deviceCatalog'
import type { DeviceSpec } from '../types'

function device(over: Partial<DeviceSpec> = {}): DeviceSpec {
  return {
    id: 'custom-x',
    name: 'X',
    width: 400,
    height: 800,
    dpr: 2,
    userAgent: 'UA',
    touch: true,
    ...over
  }
}

function draft(over: Partial<DeviceDraft> = {}): DeviceDraft {
  return { ...emptyDraft('phone'), name: 'My phone', ...over }
}

describe('deviceTypeOf', () => {
  it('trusts a device that says what it is', () => {
    expect(deviceTypeOf(device({ type: 'desktop', touch: true, width: 300 }))).toBe('desktop')
  })

  it('reads a catalog device from its metrics', () => {
    expect(deviceTypeOf(deviceById('iphone-15-pro') as DeviceSpec)).toBe('phone')
    expect(deviceTypeOf(deviceById('ipad-mini') as DeviceSpec)).toBe('tablet')
    expect(deviceTypeOf(deviceById('desktop-1440') as DeviceSpec)).toBe('desktop')
    expect(deviceTypeOf(deviceById('nest-hub') as DeviceSpec)).toBe('tablet')
  })

  it('classifies every catalog entry without falling over', () => {
    for (const entry of DEVICE_CATALOG) {
      expect(['phone', 'tablet', 'desktop']).toContain(deviceTypeOf(entry))
    }
  })

  it('a viewport with no touch screen is a computer', () => {
    expect(deviceTypeOf(device({ touch: false, width: 400, height: 800 }))).toBe('desktop')
  })
})

describe('isRotatable', () => {
  it('takes the device at its word when it has one', () => {
    expect(isRotatable(device({ rotatable: false }))).toBe(false)
    expect(isRotatable(device({ type: 'desktop', rotatable: true }))).toBe(true)
  })

  it('otherwise: anything but a monitor', () => {
    expect(isRotatable(deviceById('iphone-15-pro') as DeviceSpec)).toBe(true)
    expect(isRotatable(deviceById('desktop-1440') as DeviceSpec)).toBe(false)
  })
})

describe('drafts', () => {
  it('a new phone starts plausible, not blank', () => {
    const fresh = emptyDraft('phone')
    expect(fresh.name).toBe('')
    expect(Number(fresh.width)).toBeGreaterThan(0)
    expect(fresh.userAgent).toBe(defaultUserAgent('phone'))
    expect(fresh.touch).toBe(true)
    expect(fresh.rotatable).toBe(true)
  })

  it('a new desktop has no touch screen and does not rotate', () => {
    const fresh = emptyDraft('desktop')
    expect(fresh.touch).toBe(false)
    expect(fresh.rotatable).toBe(false)
  })

  it('round-trips an existing device', () => {
    const source = device({ width: 412, height: 915, dpr: 2.625, name: 'Mine' })
    const round = draftFromDevice(source)
    expect(round).toMatchObject({ name: 'Mine', width: '412', height: '915', dpr: '2.625' })
  })

  it('changing the type swaps the defaults it owns', () => {
    const next = draftWithType(draft(), 'desktop')
    expect(next.type).toBe('desktop')
    expect(next.userAgent).toBe(defaultUserAgent('desktop'))
    expect(next.touch).toBe(defaultTouch('desktop'))
    expect(next.rotatable).toBe(defaultRotatable('desktop'))
  })

  it('but never throws away a user agent someone typed', () => {
    const edited = draft({ userAgent: 'MyBot/1.0' })
    expect(draftWithType(edited, 'tablet').userAgent).toBe('MyBot/1.0')
  })

  it('nor a touch setting they deliberately flipped', () => {
    const edited = draft({ touch: false })
    expect(draftWithType(edited, 'tablet').touch).toBe(false)
  })

  it('re-selecting the current type changes nothing at all', () => {
    const current = draft({ userAgent: 'MyBot/1.0' })
    expect(draftWithType(current, 'phone')).toBe(current)
  })
})

describe('validateDraft', () => {
  const options = { devices: DEVICE_CATALOG }

  it('accepts a well-formed draft', () => {
    const result = validateDraft(draft(), options)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.device).toMatchObject({ name: 'My phone', type: 'phone', touch: true })
      expect(result.device.width).toBe(390)
    }
  })

  it('trims the name it stores', () => {
    const result = validateDraft(draft({ name: '  Spaced  ' }), options)
    expect(result.ok && result.device.name).toBe('Spaced')
  })

  it('requires a name', () => {
    const result = validateDraft(draft({ name: '   ' }), options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.name).toBeDefined()
  })

  it('rejects a name another device already answers to, case aside', () => {
    const result = validateDraft(draft({ name: 'iphone 15 pro' }), options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.name).toMatch(/already exists/i)
  })

  it('lets a device keep its own name while being edited', () => {
    const mine = device({ id: 'custom-mine', name: 'Mine' })
    const result = validateDraft(draft({ name: 'Mine' }), {
      devices: [...DEVICE_CATALOG, mine],
      editingId: 'custom-mine'
    })
    expect(result.ok).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['not a number', 'wide'],
    ['below the floor', '99'],
    ['above the ceiling', '10001'],
    ['fractional', '393.5']
  ])('rejects a %s width', (_label, width) => {
    const result = validateDraft(draft({ width }), options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.width).toBeDefined()
  })

  it('accepts the dimension bounds themselves', () => {
    expect(validateDraft(draft({ width: '100', height: '10000' }), options).ok).toBe(true)
  })

  it.each([
    ['zero', '0'],
    ['below the floor', '0.4'],
    ['above the ceiling', '4.5'],
    ['not a number', 'retina']
  ])('rejects a %s pixel ratio', (_label, dpr) => {
    const result = validateDraft(draft({ dpr }), options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.dpr).toBeDefined()
  })

  it('accepts a fractional pixel ratio, which real devices have', () => {
    const result = validateDraft(draft({ dpr: '2.625' }), options)
    expect(result.ok && result.device.dpr).toBe(2.625)
  })

  it('requires a user agent', () => {
    const result = validateDraft(draft({ userAgent: '  ' }), options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.userAgent).toBeDefined()
  })

  it('reports every objection at once, not one per attempt', () => {
    const result = validateDraft(draft({ name: '', width: '1', dpr: '99' }), options)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['dpr', 'name', 'width'])
    }
  })
})

describe('makeCustomDeviceId', () => {
  it('is derived from the name and namespaced away from the catalog', () => {
    const id = makeCustomDeviceId('My Watch', new Set())
    expect(id).toBe(`${CUSTOM_ID_PREFIX}my-watch`)
    expect(deviceById(id)).toBeUndefined()
  })

  it('suffixes only when it has to', () => {
    const taken = new Set([`${CUSTOM_ID_PREFIX}my-watch`])
    expect(makeCustomDeviceId('My Watch', taken)).toBe(`${CUSTOM_ID_PREFIX}my-watch-2`)
    taken.add(`${CUSTOM_ID_PREFIX}my-watch-2`)
    expect(makeCustomDeviceId('My Watch', taken)).toBe(`${CUSTOM_ID_PREFIX}my-watch-3`)
  })

  it('survives a name with nothing sluggable in it', () => {
    expect(makeCustomDeviceId('日本語 📱', new Set())).toBe(`${CUSTOM_ID_PREFIX}device`)
  })

  it('never collides with a catalog id', () => {
    for (const entry of DEVICE_CATALOG) {
      expect(makeCustomDeviceId(entry.name, new Set())).not.toBe(entry.id)
    }
  })
})

describe('matchesQuery', () => {
  const phone = device({ name: 'iPhone 15 Pro', width: 393, height: 852 })

  it('matches everything on an empty query', () => {
    expect(matchesQuery(phone, '   ')).toBe(true)
  })

  it('matches part of the name, case aside', () => {
    expect(matchesQuery(phone, 'iphone')).toBe(true)
    expect(matchesQuery(phone, '15 pro')).toBe(true)
    expect(matchesQuery(phone, 'pixel')).toBe(false)
  })

  it.each(['393x852', '393×852', '393 x 852', '393X852', '393'])('matches the size %s', (query) => {
    expect(matchesQuery(phone, query)).toBe(true)
  })

  it('does not match a size that is not this one', () => {
    expect(matchesQuery(phone, '412x915')).toBe(false)
  })
})

describe('catalogWithCustom', () => {
  it('puts the user’s own devices after the catalog', () => {
    const mine = device({ id: 'custom-mine' })
    const all = catalogWithCustom([mine])
    expect(all).toHaveLength(DEVICE_CATALOG.length + 1)
    expect(all.at(-1)).toBe(mine)
  })
})
