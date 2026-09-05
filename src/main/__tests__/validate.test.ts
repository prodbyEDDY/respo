import { describe, expect, it } from 'vitest'
import type { DeviceSpec } from '@shared/types'
import {
  validateAppResource,
  validateAuthCredentials,
  validateBoolean,
  validateBookmarks,
  validateClearTarget,
  validateDeviceId,
  validateDeviceSpecs,
  validateEmulationProfile,
  validateGuideSet,
  validateHighlightTarget,
  validateHistoryQuery,
  validateHomeUrl,
  validateLeadDeviceId,
  validateOptionalDevtoolsPanel,
  validateOptionalOverlayApply,
  validateOptionalVisionDeficiency,
  validateOverlayDataUrl,
  validatePermissionDecision,
  validatePermissionType,
  validatePersistedPatch,
  validatePromptId,
  validateReloadRequest,
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
      { kind: 'scroll', ratioX: 0, ratioY: 0.5, x: 0, y: 0 },
      { kind: 'mouse', type: 'down', xNorm: 0.25, yNorm: 0.75, button: 'left' },
      { kind: 'key', type: 'up', key: 'a', code: 'KeyA', modifiers: 8 }
    ]
    expect(validateSyncInputBatch(batch)).toEqual(batch)
  })

  it('clamps ratios into 0..1 rather than rejecting them', () => {
    expect(validateSyncInputBatch([{ kind: 'scroll', ratioX: -2, ratioY: 4 }])).toEqual([
      { kind: 'scroll', ratioX: 0, ratioY: 1, x: 0, y: 0 }
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

describe('validateClearTarget', () => {
  it.each(['storage', 'cookies', 'cache', 'all'])('accepts %s', (target) => {
    expect(validateClearTarget(target)).toBe(target)
  })

  it.each([
    ['a target this build has never heard of', 'everything-everywhere'],
    ['an empty string', ''],
    ['null', null],
    ['an object', {}]
  ])('rejects %s', (_label, value) => {
    expect(() => validateClearTarget(value)).toThrow(/invalid ipc payload/i)
  })
})

describe('permission payloads', () => {
  it.each([
    'camera',
    'microphone',
    'geolocation',
    'notifications',
    'clipboard-read',
    'fullscreen',
    'midi',
    'pointerLock'
  ])('accepts the %s capability', (type) => {
    expect(validatePermissionType(type)).toBe(type)
  })

  it.each([
    ['a capability this build has no row for', 'display-capture'],
    ['a prototype key', 'toString'],
    ['null', null],
    ['an object', {}]
  ])('rejects %s as a capability', (_label, value) => {
    expect(() => validatePermissionType(value)).toThrow(/invalid ipc payload/i)
  })

  it.each(['allow', 'block', 'ask'])('accepts the %s decision', (decision) => {
    expect(validatePermissionDecision(decision)).toBe(decision)
  })

  it.each([
    ['a decision this build does not know', 'maybe'],
    ['a boolean', true],
    ['null', null]
  ])('rejects %s as a decision', (_label, value) => {
    expect(() => validatePermissionDecision(value)).toThrow(/invalid ipc payload/i)
  })

  it('accepts a prompt id of the shape main mints', () => {
    expect(validatePromptId('perm-7', 'permissions:respond')).toBe('perm-7')
  })

  it.each([
    ['an empty string', ''],
    ['a number', 7],
    ['null', null],
    ['a payload longer than any id', 'x'.repeat(200)]
  ])('rejects %s as a prompt id', (_label, value) => {
    expect(() => validatePromptId(value, 'permissions:respond')).toThrow(/invalid ipc payload/i)
  })

  /**
   * The important one. `permissions` is main's field: a renderer that could
   * patch it would skip the question entirely and write itself a camera on any
   * site. The patch validator rebuilds what it accepts, so the key simply is
   * not there on the other side.
   */
  it('drops a permissions slice out of a store:save patch', () => {
    const patch = validatePersistedPatch({
      permissions: { 'https://evil.example': { camera: 'allow' } },
      homeUrl: 'example.com'
    })

    expect(patch).toEqual({ homeUrl: 'https://example.com/' })
    expect('permissions' in patch).toBe(false)
  })
})

describe('validateAuthCredentials', () => {
  it('accepts a pair and rebuilds it', () => {
    const credentials = { username: 'ada', password: 'hunter2', extra: 'x' }
    const validated = validateAuthCredentials(credentials)

    expect(validated).toEqual({ username: 'ada', password: 'hunter2' })
    expect(validated).not.toBe(credentials)
  })

  it('accepts empty strings — some servers want exactly that', () => {
    expect(validateAuthCredentials({ username: '', password: '' })).toEqual({
      username: '',
      password: ''
    })
  })

  it('accepts null, which is how a cancel travels', () => {
    expect(validateAuthCredentials(null)).toBeNull()
  })

  it.each([
    ['a string', 'ada:hunter2'],
    ['an array', []],
    ['undefined', undefined],
    ['a missing password', { username: 'ada' }],
    ['a numeric username', { username: 7, password: 'x' }],
    ['a username past the cap', { username: 'x'.repeat(257), password: 'x' }],
    ['a password past the cap', { username: 'ada', password: 'x'.repeat(1025) }]
  ])('rejects %s', (_label, value) => {
    expect(() => validateAuthCredentials(value)).toThrow(/invalid ipc payload/i)
  })
})

describe('the security slice of store:save', () => {
  it('carries the certificate switch through', () => {
    expect(validatePersistedPatch({ security: { allowInsecureCertificates: true } })).toEqual({
      security: { allowInsecureCertificates: true }
    })
  })

  it('drops anything else the slice carries', () => {
    expect(
      validatePersistedPatch({
        security: { allowInsecureCertificates: false, disableWebSecurity: true }
      })
    ).toEqual({ security: { allowInsecureCertificates: false } })
  })

  it.each([
    ['a truthy string instead of a boolean', { security: { allowInsecureCertificates: 'true' } }],
    ['a missing field', { security: {} }],
    ['a non-object slice', { security: true }],
    ['an array', { security: [] }]
  ])('rejects %s', (_label, payload) => {
    expect(() => validatePersistedPatch(payload)).toThrow(/invalid ipc payload/i)
  })
})

describe('the updates slice of store:save', () => {
  it('is dropped: it is main’s field, whatever the patch says', () => {
    expect(
      validatePersistedPatch({
        updates: { lastCheckAt: 1, autoCheck: false },
        homeUrl: ''
      })
    ).toEqual({ homeUrl: '' })
  })
})

describe('validateAppResource', () => {
  it('accepts the two things main knows how to open', () => {
    expect(validateAppResource('logs')).toBe('logs')
    expect(validateAppResource('notices')).toBe('notices')
  })

  it.each([
    ['a path', 'C:/Users/me/logs'],
    ['a url', 'file:///etc/passwd'],
    ['an object', { resource: 'logs' }],
    ['undefined', undefined]
  ])('rejects %s', (_label, value) => {
    expect(() => validateAppResource(value)).toThrow(/invalid ipc payload/i)
  })
})

describe('emulation payloads', () => {
  const profile = {
    colorScheme: 'dark',
    reducedMotion: true,
    forcedColors: false,
    media: 'print',
    vision: 'deuteranopia',
    network: 'slow-4g',
    geolocation: { latitude: 35.6762, longitude: 139.6503 },
    locale: 'ja-JP',
    timezone: 'Asia/Tokyo'
  }

  it('accepts a full profile and rebuilds it without extra keys', () => {
    expect(
      validateEmulationProfile({ ...profile, geolocation: { ...profile.geolocation, extra: 1 } })
    ).toEqual(profile)
  })

  it('accepts a profile with everything off', () => {
    expect(
      validateEmulationProfile({
        colorScheme: 'system',
        reducedMotion: false,
        forcedColors: false,
        media: 'auto',
        vision: 'none',
        network: 'online',
        geolocation: null,
        locale: null,
        timezone: null
      }).locale
    ).toBeNull()
  })

  it.each([
    ['a junk colour scheme', { colorScheme: 'sepia' }],
    ['a junk media type', { media: 'braille' }],
    ['an unknown simulation', { vision: 'x-ray' }],
    ['an unknown network preset', { network: '5g' }],
    ['a non-boolean reducedMotion', { reducedMotion: 'yes' }],
    ['a non-boolean forcedColors', { forcedColors: 1 }],
    ['a position off the planet', { geolocation: { latitude: 91, longitude: 0 } }],
    ['a locale that is not a tag', { locale: 'en_US' }],
    ['a locale that is a script', { locale: '<script>' }],
    ['a time zone with spaces', { timezone: 'Mars/Olympus Mons' }],
    ['a missing field', { timezone: undefined }]
  ])('rejects %s', (_label, over) => {
    expect(() => validateEmulationProfile({ ...profile, ...over })).toThrow(/invalid ipc payload/i)
  })

  it.each([null, 'dark', [], 42])('rejects a profile that is %j', (value) => {
    expect(() => validateEmulationProfile(value)).toThrow(/invalid ipc payload/i)
  })

  it('accepts a per-device simulation or null', () => {
    expect(validateOptionalVisionDeficiency('protanopia')).toBe('protanopia')
    expect(validateOptionalVisionDeficiency(null)).toBeNull()
    expect(() => validateOptionalVisionDeficiency('x-ray')).toThrow(/invalid ipc payload/i)
    expect(() => validateOptionalVisionDeficiency(undefined)).toThrow(/invalid ipc payload/i)
  })

  it('carries the persisted slice through store:save', () => {
    expect(
      validatePersistedPatch({ emulation: { profile, deviceVision: { 'pixel-8': 'none' } } })
    ).toEqual({ emulation: { profile, deviceVision: { 'pixel-8': 'none' } } })
  })

  it.each([
    ['a junk override', { profile, deviceVision: { 'pixel-8': 'x-ray' } }],
    ['an empty device id', { profile, deviceVision: { '': 'none' } }],
    ['a missing override map', { profile }],
    ['an array of overrides', { profile, deviceVision: [] }],
    ['a junk profile inside', { profile: { ...profile, vision: 'x-ray' }, deviceVision: {} }],
    ['a non-object slice', 'dark']
  ])('rejects store:save emulation with %s', (_label, emulation) => {
    expect(() => validatePersistedPatch({ emulation })).toThrow(/invalid ipc payload/i)
  })
})

describe('validateReloadRequest', () => {
  it('reads no argument as "every device, from cache"', () => {
    expect(validateReloadRequest(undefined)).toEqual({})
    expect(validateReloadRequest({})).toEqual({})
  })

  it('carries a device and the cache flag through, and nothing else', () => {
    expect(validateReloadRequest({ deviceId: 'pixel-8', ignoreCache: true, extra: 1 })).toEqual({
      deviceId: 'pixel-8',
      ignoreCache: true
    })
    expect(validateReloadRequest({ ignoreCache: false })).toEqual({ ignoreCache: false })
  })

  it.each([
    ['a non-object', 'all'],
    ['null', null],
    ['an array', []],
    ['an empty device id', { deviceId: '' }],
    ['a numeric device id', { deviceId: 7 }],
    ['an overlong device id', { deviceId: 'x'.repeat(201) }],
    ['a stringly cache flag', { ignoreCache: 'yes' }]
  ])('rejects %s', (_label, value) => {
    expect(() => validateReloadRequest(value)).toThrow(/invalid ipc payload/i)
  })
})

describe('diagnostics and DevTools panel payloads', () => {
  it('accepts an offender index, all or none as a highlight target', () => {
    expect(validateHighlightTarget(0)).toBe(0)
    expect(validateHighlightTarget(9)).toBe(9)
    expect(validateHighlightTarget('all')).toBe('all')
    expect(validateHighlightTarget('none')).toBe('none')
  })

  it.each([-1, 1.5, 100, '3', 'some', null, undefined, {}])('refuses %j as a target', (value) => {
    expect(() => validateHighlightTarget(value)).toThrow(/invalid ipc payload/i)
  })

  it('accepts the two panels or nothing', () => {
    expect(validateOptionalDevtoolsPanel(undefined)).toBeUndefined()
    expect(validateOptionalDevtoolsPanel('console')).toBe('console')
    expect(validateOptionalDevtoolsPanel('elements')).toBe('elements')
    expect(() => validateOptionalDevtoolsPanel('sources')).toThrow(/invalid ipc payload/i)
    expect(() => validateOptionalDevtoolsPanel(null)).toThrow(/invalid ipc payload/i)
  })
})

describe('guides payloads', () => {
  it('carries scroll offsets through the input batch, clamped', () => {
    expect(
      validateSyncInputBatch([{ kind: 'scroll', ratioX: 0, ratioY: 1, x: 12, y: 340 }])
    ).toEqual([{ kind: 'scroll', ratioX: 0, ratioY: 1, x: 12, y: 340 }])
    expect(validateSyncInputBatch([{ kind: 'scroll', ratioX: 0, ratioY: 0 }])).toEqual([
      { kind: 'scroll', ratioX: 0, ratioY: 0, x: 0, y: 0 }
    ])
    expect(
      validateSyncInputBatch([{ kind: 'scroll', ratioX: 0, ratioY: 0, x: -5, y: 1e12 }])[0]
    ).toMatchObject({ x: 0, y: 10_000_000 })
  })

  it('accepts a guide set and repairs it into whole, sorted positions', () => {
    expect(validateGuideSet({ h: [10.4, 10.4, 5], v: [] })).toEqual({ h: [5, 10], v: [] })
  })

  it.each([
    ['not an object', 'guides'],
    ['a missing axis', { h: [] }],
    ['a negative position', { h: [-1], v: [] }],
    ['a stringly position', { h: ['10'], v: [] }],
    ['a position past the cap', { h: [], v: [1_000_000] }],
    ['too many guides', { h: Array.from({ length: 51 }, (_v, i) => i), v: [] }]
  ])('rejects %s', (_label, value) => {
    expect(() => validateGuideSet(value)).toThrow(/invalid ipc payload/i)
  })

  it('carries the persisted guides through store:save, dropping empty sizes', () => {
    expect(
      validatePersistedPatch({
        guides: { '393x852': { h: [1], v: [2] }, '1440x900': { h: [], v: [] } }
      })
    ).toEqual({ guides: { '393x852': { h: [1], v: [2] } } })
  })

  it.each([
    ['a junk key', { guides: { phone: { h: [1], v: [] } } }],
    ['an array', { guides: [] }],
    ['a junk set', { guides: { '393x852': 'yes' } }]
  ])('rejects store:save guides with %s', (_label, patch) => {
    expect(() => validatePersistedPatch(patch)).toThrow(/invalid ipc payload/i)
  })
})

describe('overlay payloads', () => {
  const png = `data:image/png;base64,${Buffer.alloc(30, 1).toString('base64')}`

  it('accepts a raster data url and refuses anything else', () => {
    expect(validateOverlayDataUrl(png)).toBe(png)
    for (const bad of [
      '',
      'data:text/html;base64,AAAA',
      'data:image/svg+xml;base64,AAAA',
      'data:image/png,plain',
      'https://example.com/a.png',
      42
    ]) {
      expect(() => validateOverlayDataUrl(bad)).toThrow(/invalid ipc payload/i)
    }
  })

  it('refuses a data url past the size cap', () => {
    const huge = `data:image/png;base64,${'A'.repeat(14 * 1024 * 1024)}`
    expect(() => validateOverlayDataUrl(huge)).toThrow(/too large/i)
  })

  it('accepts an overlay to apply, or null', () => {
    expect(
      validateOptionalOverlayApply({
        imageId: '0123456789abcdef',
        opacity: 0.5,
        curtain: 0,
        extra: 1
      })
    ).toEqual({ imageId: '0123456789abcdef', opacity: 0.5, curtain: 0 })
    expect(validateOptionalOverlayApply(null)).toBeNull()
    for (const bad of [
      { imageId: 'nope', opacity: 0.5, curtain: 0 },
      { imageId: '0123456789abcdef', opacity: 2, curtain: 0 },
      { imageId: '0123456789abcdef', opacity: 0.5, curtain: -1 },
      { imageId: '0123456789abcdef', opacity: '1', curtain: 0 },
      'overlay',
      []
    ]) {
      expect(() => validateOptionalOverlayApply(bad)).toThrow(/invalid ipc payload/i)
    }
  })

  it('carries the persisted overlays through store:save, repaired', () => {
    expect(
      validatePersistedPatch({
        designOverlays: {
          '393x852': { imageId: '0123456789abcdef', mode: 'weird', opacity: 3, curtain: 0.5 }
        }
      })
    ).toEqual({
      designOverlays: {
        '393x852': {
          imageId: '0123456789abcdef',
          mode: 'overlay',
          opacity: 1,
          curtain: 0.5,
          enabled: true
        }
      }
    })
  })

  it.each([
    ['a junk key', { designOverlays: { phone: { imageId: '0123456789abcdef' } } }],
    ['a missing image id', { designOverlays: { '393x852': { opacity: 1 } } }],
    ['an array', { designOverlays: [] }]
  ])('rejects store:save designOverlays with %s', (_label, patch) => {
    expect(() => validatePersistedPatch(patch)).toThrow(/invalid ipc payload/i)
  })
})
