import { describe, expect, it } from 'vitest'
import type { DeviceSpec } from '@shared/types'
import {
  validateBoolean,
  validateBookmarks,
  validateDeviceId,
  validateDeviceSpecs,
  validateHistoryQuery,
  validateHomeUrl,
  validateLeadDeviceId,
  validatePersistedPatch,
  validateScreenshotDirectory,
  validateShotPath,
  validateShotRequest,
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

  it('accepts a well-formed list and returns its devices', () => {
    const devices = [device(), device({ id: 'pixel', touch: false, dpr: 0.5 })]
    expect(validateDeviceSpecs(devices)).toEqual(devices)
  })

  it('rebuilds each device rather than handing the payload back', () => {
    const devices = [device({ type: 'phone', rotatable: true })]
    const validated = validateDeviceSpecs(devices)

    // Not the caller's objects: the renderer keeps mutating them, and one
    // branch of this ends up on disk.
    expect(validated[0]).not.toBe(devices[0])
    expect(validated[0]).toEqual(devices[0])
  })

  it('drops keys that are not part of a device, so they never reach disk', () => {
    const extra = { ...(device() as object), note: 'x'.repeat(500), __proto__hack: 1 }
    const validated = validateDeviceSpecs([extra])
    expect(Object.keys(validated[0] as object).sort()).toEqual([
      'dpr',
      'height',
      'id',
      'name',
      'touch',
      'userAgent',
      'width'
    ])
  })

  it('caps the strings a device carries', () => {
    expect(() => validateDeviceSpecs([device({ id: 'x'.repeat(201) })])).toThrow(/at most 200/i)
    expect(() => validateDeviceSpecs([device({ name: 'x'.repeat(201) })])).toThrow(/at most 200/i)
    expect(() => validateDeviceSpecs([device({ userAgent: 'x'.repeat(513) })])).toThrow(
      /at most 512/i
    )

    // And accepts what is merely long: real user agents are.
    expect(() => validateDeviceSpecs([device({ userAgent: 'x'.repeat(512) })])).not.toThrow()
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

  it('carries the orientation map through, keys and booleans only', () => {
    const patch = validatePersistedPatch({ rotated: { 'iphone-15': true, 'pixel-8': false } })
    expect(patch).toEqual({ rotated: { 'iphone-15': true, 'pixel-8': false } })
  })

  it.each([
    ['a rotated map that is not an object', { rotated: [] }],
    ['a rotated value that is not a boolean', { rotated: { 'iphone-15': 'yes' } }],
    ['a rotated key that is not an id', { rotated: { ['x'.repeat(201)]: true } }]
  ])('rejects %s', (_label, payload) => {
    expect(() => validatePersistedPatch(payload)).toThrow(/invalid ipc payload/i)
  })

  it('rejects an orientation map past its cap', () => {
    const rotated = Object.fromEntries(
      Array.from({ length: 257 }, (_v, i) => [`d${i}`, true] as const)
    )
    expect(() => validatePersistedPatch({ rotated })).toThrow(/at most 256/i)
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

describe('sync control payloads', () => {
  it('accepts a device id as the lead', () => {
    expect(validateLeadDeviceId('pixel-8')).toBe('pixel-8')
  })

  it('accepts null: leaving the canvas means nothing leads', () => {
    expect(validateLeadDeviceId(null)).toBeNull()
  })

  it.each([
    ['an empty string', ''],
    ['undefined', undefined],
    ['a number', 7],
    ['an object', {}]
  ])('rejects %s as a lead', (_label, value) => {
    expect(() => validateLeadDeviceId(value)).toThrow(/invalid ipc payload/i)
  })

  it('rejects a lead id longer than a label could ever be', () => {
    expect(() => validateLeadDeviceId('x'.repeat(201))).toThrow(/invalid ipc payload/i)
  })

  it('requires a real device id for sync:set-enabled', () => {
    expect(validateDeviceId('pixel-8')).toBe('pixel-8')
    expect(() => validateDeviceId(null)).toThrow(/invalid ipc payload/i)
    expect(() => validateDeviceId('')).toThrow(/invalid ipc payload/i)
  })

  it('requires a real boolean, not something truthy', () => {
    expect(validateBoolean(false, 'sync:set-global')).toBe(false)
    expect(() => validateBoolean(1, 'sync:set-global')).toThrow(/sync:set-global/)
    expect(() => validateBoolean('true', 'sync:set-global')).toThrow(/invalid ipc payload/i)
  })
})

describe('validatePersistedPatch — sync switches', () => {
  it('passes a well-formed sync slice through', () => {
    const sync = { enabled: false, disabledDeviceIds: ['pixel-8'] }
    expect(validatePersistedPatch({ sync })).toEqual({ sync })
  })

  it('copies the id list rather than keeping the caller’s array', () => {
    const disabledDeviceIds = ['pixel-8']
    const out = validatePersistedPatch({ sync: { enabled: true, disabledDeviceIds } })
    expect(out.sync?.disabledDeviceIds).not.toBe(disabledDeviceIds)
  })

  it.each([
    ['not an object', 'sync'],
    ['an array', []],
    ['missing enabled', { disabledDeviceIds: [] }],
    ['a non-boolean enabled', { enabled: 'yes', disabledDeviceIds: [] }],
    ['a non-array id list', { enabled: true, disabledDeviceIds: 'pixel-8' }],
    ['an empty id', { enabled: true, disabledDeviceIds: [''] }]
  ])('rejects %s', (_label, sync) => {
    expect(() => validatePersistedPatch({ sync })).toThrow(/invalid ipc payload/i)
  })

  it('rejects more muted ids than there could be devices', () => {
    const disabledDeviceIds = Array.from({ length: 65 }, (_v, i) => `d${i}`)
    expect(() => validatePersistedPatch({ sync: { enabled: true, disabledDeviceIds } })).toThrow(
      /at most 64/i
    )
  })
})

describe('validateShotRequest', () => {
  it('accepts the bare request the UI sends', () => {
    expect(validateShotRequest({ fullPage: false })).toEqual({ fullPage: false })
  })

  it('keeps an explicit format and density', () => {
    expect(validateShotRequest({ fullPage: true, format: 'jpeg', dpr: 1 })).toEqual({
      fullPage: true,
      format: 'jpeg',
      dpr: 1
    })
  })

  it('drops extra keys rather than passing them to main', () => {
    expect(validateShotRequest({ fullPage: false, quality: 100, path: '/etc' })).toEqual({
      fullPage: false
    })
  })

  it.each([
    ['not an object', 'png'],
    ['an array', []],
    ['a missing fullPage', {}],
    ['a non-boolean fullPage', { fullPage: 'yes' }],
    ['an unknown format', { fullPage: false, format: 'webp' }],
    ['a density that is neither', { fullPage: false, dpr: 2 }]
  ])('rejects %s', (_label, request) => {
    expect(() => validateShotRequest(request)).toThrow(/invalid ipc payload/i)
  })
})

describe('validateShotPath', () => {
  it('accepts a plausible file path', () => {
    const path = String.raw`C:\Users\me\Pictures\Respo\a.png`
    expect(validateShotPath(path)).toBe(path)
  })

  it.each([
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
    ['a NUL byte', '/shots/a.png\u0000.txt'],
    ['an absurd length', `/${'a'.repeat(2000)}`]
  ])('rejects %s', (_label, path) => {
    expect(() => validateShotPath(path)).toThrow(/invalid ipc payload/i)
  })
})

describe('validatePersistedPatch — screenshots', () => {
  it('keeps the format and the density', () => {
    const patch = validatePersistedPatch({
      screenshots: { directory: '', format: 'jpeg', dpr: 1 }
    })
    expect(patch.screenshots).toMatchObject({ format: 'jpeg', dpr: 1 })
  })

  it('drops the folder the renderer sent and keeps main’s own', () => {
    const patch = validatePersistedPatch(
      { screenshots: { directory: '\\\\attacker\\share', format: 'png', dpr: 'device' } },
      { screenshotDirectory: '/home/me/shots' }
    )
    // The folder is where every capture is written and what `shot:reveal` is
    // checked against. A renderer that could set it could point both anywhere
    // — a UNC share included — so the field never comes from the patch.
    expect(patch.screenshots).toEqual({
      directory: '/home/me/shots',
      format: 'png',
      dpr: 'device'
    })
  })

  it('falls back to the default folder when main has none yet', () => {
    const patch = validatePersistedPatch({
      screenshots: { directory: '/tmp/anything', format: 'png', dpr: 'device' }
    })
    expect(patch.screenshots?.directory).toBe('')
  })

  it.each([
    ['not an object', 'shots'],
    ['an unknown format', { directory: '', format: 'gif', dpr: 'device' }],
    ['an arbitrary density', { directory: '', format: 'png', dpr: 3 }]
  ])('rejects %s', (_label, screenshots) => {
    expect(() => validatePersistedPatch({ screenshots })).toThrow(/invalid ipc payload/i)
  })
})

describe('validateScreenshotDirectory', () => {
  it('accepts an absolute folder, and the empty string that means the default', () => {
    expect(validateScreenshotDirectory('/home/me/shots')).toBe('/home/me/shots')
    expect(validateScreenshotDirectory('')).toBe('')
  })

  it.each([
    ['a relative folder', 'shots'],
    ['a number', 42],
    ['null', null],
    ['a NUL byte', '/shots\u0000'],
    ['an absurd length', `/${'a'.repeat(2000)}`]
  ])('rejects %s', (_label, directory) => {
    // The one door left for this value is the folder dialog in `shot:choose-dir`
    // — and a path is checked even when it came back out of the OS.
    expect(() => validateScreenshotDirectory(directory)).toThrow(/invalid ipc payload/i)
  })
})

describe('validatePersistedPatch — the canvas layout', () => {
  it('accepts every layout this build can draw', () => {
    for (const mode of ['column', 'flex', 'masonry', 'individual']) {
      expect(validatePersistedPatch({ layout: { mode, individualDeviceId: null } })).toEqual({
        layout: { mode, individualDeviceId: null }
      })
    }
  })

  it('keeps the device the canvas was expanded on', () => {
    expect(
      validatePersistedPatch({ layout: { mode: 'individual', individualDeviceId: 'ipad-mini' } })
    ).toEqual({ layout: { mode: 'individual', individualDeviceId: 'ipad-mini' } })
  })

  it('reads a missing device id as "no preference"', () => {
    expect(validatePersistedPatch({ layout: { mode: 'flex' } })).toEqual({
      layout: { mode: 'flex', individualDeviceId: null }
    })
  })

  it.each([
    ['a mode this build has never heard of', { mode: 'kaleidoscope' }],
    ['no mode at all', { individualDeviceId: 'pixel-8' }],
    ['a device id that is not a string', { mode: 'flex', individualDeviceId: 7 }],
    ['a device id longer than any name', { mode: 'flex', individualDeviceId: 'a'.repeat(500) }]
  ])('rejects %s', (_label, layout) => {
    expect(() => validatePersistedPatch({ layout })).toThrow(/invalid ipc payload/i)
  })

  it.each([
    ['an array', []],
    ['a string', 'masonry'],
    ['null', null]
  ])('rejects a slice that is %s', (_label, layout) => {
    expect(() => validatePersistedPatch({ layout })).toThrow(/invalid ipc payload/i)
  })

  it('leaves the rest of the document alone when no layout is offered', () => {
    expect(validatePersistedPatch({ activeSuiteId: 'default' })).toEqual({
      activeSuiteId: 'default'
    })
  })
})

describe('validateBookmarks', () => {
  const bookmark = { id: 'bm-1', title: 'Example', url: 'https://example.com/', addedAt: 1 }

  it('accepts an empty list', () => {
    expect(validateBookmarks([])).toEqual([])
  })

  it('stores the normalized url, not the one it was handed', () => {
    expect(validateBookmarks([{ ...bookmark, url: 'example.com' }])[0]?.url).toBe(
      'https://example.com/'
    )
  })

  it('accepts an empty title — an untitled page is still a page', () => {
    expect(validateBookmarks([{ ...bookmark, title: '' }])[0]?.title).toBe('')
  })

  it('rebuilds the entry rather than storing what it was sent', () => {
    // A bookmark carrying twenty extra keys must not put them on disk.
    expect(validateBookmarks([{ ...bookmark, evil: 'payload' }])[0]).toEqual(bookmark)
  })

  it.each([
    ['a url no view may load', { ...bookmark, url: 'javascript:alert(1)' }],
    ['no url at all', { id: 'bm-1', title: 'x', addedAt: 1 }],
    ['no id', { title: 'x', url: 'https://example.com/', addedAt: 1 }],
    ['a title that is not a string', { ...bookmark, title: 7 }],
    ['a timestamp that is not a number', { ...bookmark, addedAt: 'today' }],
    ['a negative timestamp', { ...bookmark, addedAt: -1 }],
    ['a url longer than any url', { ...bookmark, url: `https://a.test/${'x'.repeat(3000)}` }]
  ])('rejects %s', (_label, entry) => {
    expect(() => validateBookmarks([entry])).toThrow(/invalid ipc payload/i)
  })

  it.each([
    ['not an array', {}],
    ['a string', 'bookmarks'],
    ['null', null]
  ])('rejects a list that is %s', (_label, value) => {
    expect(() => validateBookmarks(value)).toThrow(/invalid ipc payload/i)
  })

  it('refuses more bookmarks than the document holds', () => {
    const many = Array.from({ length: 501 }, (_value, n) => ({ ...bookmark, id: `bm-${n}` }))
    expect(() => validateBookmarks(many)).toThrow(/at most/i)
  })

  it('travels through store:save like every other slice', () => {
    expect(validatePersistedPatch({ bookmarks: [bookmark] })).toEqual({ bookmarks: [bookmark] })
  })
})

describe('validateHomeUrl', () => {
  it('reads the empty string as "no home page"', () => {
    expect(validateHomeUrl('')).toBe('')
  })

  it('normalizes what it keeps', () => {
    expect(validateHomeUrl('example.com')).toBe('https://example.com/')
  })

  it('keeps http for a loopback host, the way the address bar does', () => {
    expect(validateHomeUrl('localhost:5173')).toBe('http://localhost:5173/')
  })

  it.each([
    ['a scheme no view may load', 'javascript:alert(1)'],
    ['something that is not a url', '   '],
    ['a number', 7],
    ['null', null]
  ])('rejects %s', (_label, value) => {
    expect(() => validateHomeUrl(value)).toThrow(/invalid ipc payload/i)
  })

  it('travels through store:save like every other field', () => {
    expect(validatePersistedPatch({ homeUrl: 'example.com' })).toEqual({
      homeUrl: 'https://example.com/'
    })
  })
})

describe('validateHistoryQuery', () => {
  it('accepts what someone might type', () => {
    expect(validateHistoryQuery('exa')).toBe('exa')
  })

  it('accepts an empty query, which asks for the recent pages', () => {
    expect(validateHistoryQuery('')).toBe('')
  })

  it.each([
    ['a number', 7],
    ['null', null],
    ['an object', {}]
  ])('rejects %s', (_label, value) => {
    expect(() => validateHistoryQuery(value)).toThrow(/invalid ipc payload/i)
  })

  it('refuses a payload big enough to be an attack on the matcher', () => {
    expect(() => validateHistoryQuery('x'.repeat(3000))).toThrow(/too long/i)
  })
})
