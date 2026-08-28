import { describe, expect, it } from 'vitest'
import type { DeviceSpec } from '@shared/types'
import {
  validateDeviceSpecs,
  validatePersistedPatch,
  validateSyncInputBatch,
  validateThemeSource
} from '../validate'

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

describe('validatePersistedPatch', () => {
  it('accepts an empty patch', () => {
    expect(validatePersistedPatch({})).toEqual({})
  })

  it('passes through the keys it recognises', () => {
    const patch = {
      customDevices: [device()],
      suites: [{ id: 's1', name: 'One', deviceIds: ['iphone-15'] }],
      activeSuiteId: 's1',
      ui: { theme: 'dark' }
    }
    expect(validatePersistedPatch(patch)).toEqual(patch)
  })

  it('drops keys that are not part of the document', () => {
    const patch = validatePersistedPatch({ activeSuiteId: 's1', __proto__hack: 1, secrets: 'x' })
    expect(patch).toEqual({ activeSuiteId: 's1' })
  })

  it('never lets a patch dictate the schema version', () => {
    expect(validatePersistedPatch({ schemaVersion: 99 })).toEqual({})
  })

  it.each([
    ['not an object', 'suites'],
    ['null', null],
    ['an array', []],
    ['a non-string activeSuiteId', { activeSuiteId: 7 }],
    ['an empty activeSuiteId', { activeSuiteId: '' }],
    ['suites that are not an array', { suites: {} }],
    ['a suite without an id', { suites: [{ name: 'One', deviceIds: [] }] }],
    ['a suite without a name', { suites: [{ id: 's1', deviceIds: [] }] }],
    ['a suite with junk deviceIds', { suites: [{ id: 's1', name: 'One', deviceIds: [7] }] }],
    ['a malformed custom device', { customDevices: [device({ width: 0 })] }],
    ['a bad theme', { ui: { theme: 'neon' } }],
    ['a non-object ui', { ui: 'dark' }]
  ])('rejects %s', (_label, payload) => {
    expect(() => validatePersistedPatch(payload)).toThrow(/invalid ipc payload/i)
  })

  it('rejects more suites than the cap', () => {
    const suites = Array.from({ length: 65 }, (_v, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      deviceIds: []
    }))
    expect(() => validatePersistedPatch({ suites })).toThrow(/at most 64/i)
  })
})

describe('validateSyncInputBatch', () => {
  it('accepts a well-formed batch', () => {
    const batch = [
      { kind: 'scroll', ratioX: 0, ratioY: 0.5 },
      { kind: 'mouse', type: 'down', xNorm: 0.25, yNorm: 0.75, button: 'left' },
      { kind: 'key', type: 'up', key: 'a', code: 'KeyA', modifiers: 8 }
    ]
    expect(validateSyncInputBatch(batch)).toEqual(batch)
  })

  it('clamps ratios into 0..1 rather than rejecting them', () => {
    expect(validateSyncInputBatch([{ kind: 'scroll', ratioX: -2, ratioY: 4 }])).toEqual([
      { kind: 'scroll', ratioX: 0, ratioY: 1 }
    ])
    expect(
      validateSyncInputBatch([
        { kind: 'mouse', type: 'down', xNorm: 9, yNorm: -9, button: 'right' }
      ])
    ).toEqual([{ kind: 'mouse', type: 'down', xNorm: 1, yNorm: 0, button: 'right' }])
  })

  it('drops instead of throwing — the sender is a page and gets no reply', () => {
    expect(validateSyncInputBatch('nope')).toEqual([])
    expect(validateSyncInputBatch(null)).toEqual([])
    expect(validateSyncInputBatch({ kind: 'scroll' })).toEqual([])
  })

  it.each([
    ['a non-finite ratio', { kind: 'scroll', ratioX: 0, ratioY: Number.NaN }],
    ['an infinite ratio', { kind: 'scroll', ratioX: Number.POSITIVE_INFINITY, ratioY: 0 }],
    ['a string ratio', { kind: 'scroll', ratioX: '0', ratioY: 0 }],
    ['an unknown kind', { kind: 'touch', xNorm: 0, yNorm: 0 }],
    ['a missing kind', { type: 'down', xNorm: 0, yNorm: 0 }],
    ['an unknown mouse type', { kind: 'mouse', type: 'move', xNorm: 0, yNorm: 0, button: 'left' }],
    ['an unknown button', { kind: 'mouse', type: 'down', xNorm: 0, yNorm: 0, button: 'back' }],
    ['a missing key', { kind: 'key', type: 'down', key: '', code: 'KeyA', modifiers: 0 }],
    [
      'an oversized key',
      { kind: 'key', type: 'down', key: 'x'.repeat(33), code: '', modifiers: 0 }
    ],
    [
      'a fractional modifier mask',
      { kind: 'key', type: 'down', key: 'a', code: '', modifiers: 1.5 }
    ],
    [
      'an out-of-range modifier mask',
      { kind: 'key', type: 'down', key: 'a', code: '', modifiers: 99 }
    ],
    ['a null entry', null]
  ])('drops %s', (_label, entry) => {
    expect(validateSyncInputBatch([entry])).toEqual([])
  })

  it('keeps the good entries in a mixed batch', () => {
    const result = validateSyncInputBatch([
      { kind: 'scroll', ratioX: 0, ratioY: 0.5 },
      'junk',
      { kind: 'mouse', type: 'down', xNorm: 0.5, yNorm: 0.5, button: 'left' }
    ])
    expect(result).toHaveLength(2)
  })

  it('caps a batch a page tried to inflate', () => {
    const flood = Array.from({ length: 500 }, () => ({ kind: 'scroll', ratioX: 0, ratioY: 0.5 }))
    expect(validateSyncInputBatch(flood)).toHaveLength(64)
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
