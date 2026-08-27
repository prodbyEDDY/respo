import { describe, expect, it } from 'vitest'
import type { DeviceSpec } from '@shared/types'
import { validateDeviceSpecs, validateThemeSource } from '../validate'

function device(over: Partial<Record<keyof DeviceSpec, unknown>> = {}): unknown {
  return {
    id: 'iphone-15',
    name: 'iPhone 15',
    width: 393,
    height: 852,
    dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone)',
    touch: true,
    ...over
  }
}

describe('validateDeviceSpecs', () => {
  it('accepts an empty list', () => {
    expect(validateDeviceSpecs([])).toEqual([])
  })

  it('accepts a well-formed list and returns it', () => {
    const devices = [device(), device({ id: 'pixel', touch: false, dpr: 0.5 })]
    expect(validateDeviceSpecs(devices)).toBe(devices)
  })

  it.each([
    ['not an array', {}],
    ['a null entry', [null]],
    ['a string entry', ['iphone']],
    ['an empty id', [device({ id: '' })]],
    ['a non-string id', [device({ id: 7 })]],
    ['an empty name', [device({ name: '' })]],
    ['an empty user agent', [device({ userAgent: '' })]],
    ['a zero width', [device({ width: 0 })]],
    ['a negative height', [device({ height: -1 })]],
    ['a NaN width', [device({ width: Number.NaN })]],
    ['an infinite height', [device({ height: Number.POSITIVE_INFINITY })]],
    ['an oversized width', [device({ width: 10_001 })]],
    ['a numeric string width', [device({ width: '393' })]],
    ['a zero dpr', [device({ dpr: 0 })]],
    ['an oversized dpr', [device({ dpr: 10.5 })]],
    ['a non-boolean touch', [device({ touch: 'yes' })]]
  ])('rejects %s', (_label, payload) => {
    expect(() => validateDeviceSpecs(payload)).toThrow(/invalid ipc payload/i)
  })

  it('rejects more devices than the cap', () => {
    const tooMany = Array.from({ length: 65 }, (_v, i) => device({ id: `d${i}` }))
    expect(() => validateDeviceSpecs(tooMany)).toThrow(/at most 64/i)
    expect(() => validateDeviceSpecs(tooMany.slice(0, 64))).not.toThrow()
  })
})

describe('validateThemeSource', () => {
  it.each(['light', 'dark', 'system'] as const)('accepts %s', (source) => {
    expect(validateThemeSource(source)).toBe(source)
  })

  it.each([['sepia'], [''], [null], [undefined], [0], [{ source: 'dark' }]])(
    'rejects %s',
    (source) => {
      expect(() => validateThemeSource(source)).toThrow(/invalid ipc payload/i)
    }
  )
})
