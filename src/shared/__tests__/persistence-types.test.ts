import { describe, expect, it } from 'vitest'
import { DEFAULT_ACTIVE_DEVICE_IDS } from '../deviceCatalog'
import {
  DEFAULT_SUITE_ID,
  SCHEMA_VERSION,
  defaultPersistedState,
  mergePersistedState,
  migratePersistedState,
  type PersistedState
} from '../persistence-types'

describe('defaultPersistedState', () => {
  it('opens on one "Default" suite holding the five W1 devices', () => {
    const state = defaultPersistedState()
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    expect(state.suites).toHaveLength(1)
    expect(state.suites[0]).toEqual({
      id: DEFAULT_SUITE_ID,
      name: 'Default',
      deviceIds: [...DEFAULT_ACTIVE_DEVICE_IDS]
    })
    expect(state.activeSuiteId).toBe(DEFAULT_SUITE_ID)
    expect(state.customDevices).toEqual([])
    expect(state.ui).toEqual({ theme: 'system' })
  })

  it('hands out a fresh object every call', () => {
    const a = defaultPersistedState()
    a.suites[0]?.deviceIds.push('desktop-1920')
    expect(defaultPersistedState().suites[0]?.deviceIds).toEqual([...DEFAULT_ACTIVE_DEVICE_IDS])
  })
})

describe('mergePersistedState', () => {
  const base = defaultPersistedState()

  it('leaves untouched keys alone', () => {
    const next = mergePersistedState(base, { activeSuiteId: 'other' })
    expect(next.activeSuiteId).toBe('other')
    expect(next.suites).toEqual(base.suites)
    expect(next.ui).toEqual(base.ui)
  })

  it('replaces arrays wholesale rather than concatenating', () => {
    const suites = [{ id: 's1', name: 'One', deviceIds: ['pixel-8'] }]
    expect(mergePersistedState(base, { suites }).suites).toEqual(suites)
  })

  it('merges `ui` one level deep so a theme patch keeps its siblings', () => {
    const next = mergePersistedState(base, { ui: { theme: 'dark' } })
    expect(next.ui.theme).toBe('dark')
  })

  it('ignores an undefined value instead of erasing the key', () => {
    const next = mergePersistedState(base, { activeSuiteId: undefined })
    expect(next.activeSuiteId).toBe(base.activeSuiteId)
  })

  it('pins schemaVersion: a patch may not rewrite it', () => {
    const next = mergePersistedState(base, {
      schemaVersion: 99
    } as unknown as Partial<PersistedState>)
    expect(next.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('does not mutate the base', () => {
    mergePersistedState(base, { ui: { theme: 'light' }, activeSuiteId: 'x' })
    expect(base.ui.theme).toBe('system')
    expect(base.activeSuiteId).toBe(DEFAULT_SUITE_ID)
  })
})

describe('migratePersistedState', () => {
  it('treats a missing store as a fresh install, with nothing to back up', () => {
    expect(migratePersistedState(undefined)).toEqual({
      state: defaultPersistedState(),
      backup: null
    })
  })

  it('round-trips a well-formed v1 state', () => {
    const stored = defaultPersistedState()
    stored.ui.theme = 'dark'
    stored.activeSuiteId = DEFAULT_SUITE_ID
    const { state, backup } = migratePersistedState(structuredClone(stored))
    expect(state).toEqual(stored)
    expect(backup).toBeNull()
  })

  it('falls back to defaults and backs the payload up on an unknown schemaVersion', () => {
    const future = { schemaVersion: 7, suites: [], activeSuiteId: 'x' }
    const { state, backup } = migratePersistedState(future)
    expect(state).toEqual(defaultPersistedState())
    expect(backup).toEqual(future)
  })

  it('backs up junk that is not an object at all', () => {
    const { state, backup } = migratePersistedState('corrupted')
    expect(state).toEqual(defaultPersistedState())
    expect(backup).toBe('corrupted')
  })

  it('repairs individual fields without discarding the rest', () => {
    const { state, backup } = migratePersistedState({
      schemaVersion: SCHEMA_VERSION,
      customDevices: [{ id: 'broken' }],
      suites: [{ id: 's1', name: 'One', deviceIds: ['pixel-8', 7] }, { id: '' }],
      activeSuiteId: 'gone',
      ui: { theme: 'neon' }
    })
    expect(backup).toBeNull()
    expect(state.customDevices).toEqual([])
    expect(state.suites).toEqual([{ id: 's1', name: 'One', deviceIds: ['pixel-8'] }])
    // An id pointing at no suite would leave the app with no selection.
    expect(state.activeSuiteId).toBe('s1')
    expect(state.ui.theme).toBe('system')
  })

  it('restores the default suite when every stored suite is unusable', () => {
    const { state } = migratePersistedState({ schemaVersion: SCHEMA_VERSION, suites: [] })
    expect(state.suites).toEqual(defaultPersistedState().suites)
    expect(state.activeSuiteId).toBe(DEFAULT_SUITE_ID)
  })

  it('keeps valid custom devices', () => {
    const custom = {
      id: 'my-phone',
      name: 'My phone',
      width: 400,
      height: 800,
      dpr: 2,
      userAgent: 'UA',
      touch: true
    }
    const { state } = migratePersistedState({
      schemaVersion: SCHEMA_VERSION,
      customDevices: [custom]
    })
    expect(state.customDevices).toEqual([custom])
  })
})

describe('sync switches', () => {
  it('a fresh install mirrors everything', () => {
    expect(defaultPersistedState().sync).toEqual({ enabled: true, disabledDeviceIds: [] })
  })

  it('a patch replaces the whole slice', () => {
    const base = defaultPersistedState()
    const next = mergePersistedState(base, {
      sync: { enabled: false, disabledDeviceIds: ['pixel-8'] }
    })
    expect(next.sync).toEqual({ enabled: false, disabledDeviceIds: ['pixel-8'] })
  })

  it('a patch that says nothing about sync leaves it alone', () => {
    const base = defaultPersistedState()
    base.sync = { enabled: false, disabledDeviceIds: ['pixel-8'] }
    expect(mergePersistedState(base, { activeSuiteId: 'x' }).sync).toEqual(base.sync)
  })

  it('the merged slice does not alias the patch', () => {
    const disabledDeviceIds = ['pixel-8']
    const next = mergePersistedState(defaultPersistedState(), {
      sync: { enabled: true, disabledDeviceIds }
    })
    disabledDeviceIds.push('ipad-mini')
    expect(next.sync.disabledDeviceIds).toEqual(['pixel-8'])
  })

  it('a document written before sync existed reads as "everything mirrors"', () => {
    const stored: Record<string, unknown> = { ...defaultPersistedState() }
    delete stored['sync']
    expect(migratePersistedState(stored).state.sync).toEqual({
      enabled: true,
      disabledDeviceIds: []
    })
  })

  it('repairs a damaged slice instead of resetting the document', () => {
    const stored: Record<string, unknown> = {
      ...defaultPersistedState(),
      sync: { enabled: 'yes', disabledDeviceIds: ['pixel-8', '', 7, 'pixel-8'] }
    }
    const { state, backup } = migratePersistedState(stored)

    expect(state.sync).toEqual({ enabled: true, disabledDeviceIds: ['pixel-8'] })
    expect(state.suites).toEqual(defaultPersistedState().suites)
    expect(backup).toBeNull()
  })
})

describe('device orientation', () => {
  it('a fresh install holds every device the way it is made', () => {
    expect(defaultPersistedState().rotated).toEqual({})
  })

  it('a patch replaces the whole map, without aliasing it', () => {
    const rotated = { 'iphone-15-pro': true }
    const next = mergePersistedState(defaultPersistedState(), { rotated })
    rotated['ipad-mini' as keyof typeof rotated] = true

    expect(next.rotated).toEqual({ 'iphone-15-pro': true })
  })

  it('a patch that says nothing about rotation leaves it alone', () => {
    const base = defaultPersistedState()
    base.rotated = { 'ipad-mini': true }
    expect(mergePersistedState(base, { activeSuiteId: 'x' }).rotated).toEqual({ 'ipad-mini': true })
  })

  it('a document written before rotation was persisted reads as all-portrait', () => {
    const stored: Record<string, unknown> = { ...defaultPersistedState() }
    delete stored['rotated']
    expect(migratePersistedState(stored).state.rotated).toEqual({})
  })

  it('keeps only the landscape exceptions, and drops the junk around them', () => {
    const stored: Record<string, unknown> = {
      ...defaultPersistedState(),
      rotated: { 'ipad-mini': true, 'pixel-8': false, 'iphone-se': 'yes', '': true }
    }
    const { state, backup } = migratePersistedState(stored)

    expect(state.rotated).toEqual({ 'ipad-mini': true })
    expect(backup).toBeNull()
  })

  it('a rotated map that is not a map costs the orientations and nothing else', () => {
    const stored: Record<string, unknown> = { ...defaultPersistedState(), rotated: 'landscape' }
    const { state } = migratePersistedState(stored)

    expect(state.rotated).toEqual({})
    expect(state.suites).toEqual(defaultPersistedState().suites)
  })
})

describe('screenshot settings', () => {
  it('starts as PNG at the device density, in main’s default folder', () => {
    expect(defaultPersistedState().screenshots).toEqual({
      directory: '',
      format: 'png',
      dpr: 'device'
    })
  })

  it('survives a document written before this build', () => {
    const stored: Record<string, unknown> = { ...defaultPersistedState() }
    delete stored['screenshots']
    const { state, backup } = migratePersistedState(stored)

    // A missing field is a field, not an unreadable document: the rest of the
    // user's settings must not be reset over it.
    expect(state.screenshots).toEqual(defaultPersistedState().screenshots)
    expect(state.suites).toEqual(defaultPersistedState().suites)
    expect(backup).toBeNull()
  })

  it('repairs each part on its own', () => {
    const stored: Record<string, unknown> = {
      ...defaultPersistedState(),
      screenshots: { directory: String.raw`C:\shots`, format: 'gif', dpr: 4 }
    }
    const { state } = migratePersistedState(stored)

    expect(state.screenshots).toEqual({
      directory: String.raw`C:\shots`,
      format: 'png',
      dpr: 'device'
    })
  })

  it('drops a folder that is not a usable path', () => {
    const stored: Record<string, unknown> = {
      ...defaultPersistedState(),
      screenshots: { directory: '/shots\u0000', format: 'jpeg', dpr: 1 }
    }
    const { state } = migratePersistedState(stored)

    expect(state.screenshots).toEqual({ directory: '', format: 'jpeg', dpr: 1 })
  })

  it('replaces the slice wholesale on a patch', () => {
    const base = defaultPersistedState()
    const next = mergePersistedState(base, {
      screenshots: { directory: '/shots', format: 'jpeg', dpr: 1 }
    })

    expect(next.screenshots).toEqual({ directory: '/shots', format: 'jpeg', dpr: 1 })
    expect(base.screenshots.directory).toBe('')
  })
})

describe('the canvas layout slice', () => {
  it('opens on wrapping rows, with no device singled out', () => {
    expect(defaultPersistedState().layout).toEqual({ mode: 'flex', individualDeviceId: null })
  })

  it('reads back a layout the user left behind', () => {
    const stored: Record<string, unknown> = {
      ...defaultPersistedState(),
      layout: { mode: 'individual', individualDeviceId: 'ipad-mini' }
    }
    const { state } = migratePersistedState(stored)

    expect(state.layout).toEqual({ mode: 'individual', individualDeviceId: 'ipad-mini' })
  })

  it('falls back to the default for a document written before this build', () => {
    const stored = { ...defaultPersistedState() } as Record<string, unknown>
    delete stored['layout']
    const { state, backup } = migratePersistedState(stored)

    // A missing field is repaired, not a reason to reset the whole document.
    expect(state.layout).toEqual({ mode: 'flex', individualDeviceId: null })
    expect(backup).toBeNull()
    expect(state.suites).toHaveLength(1)
  })

  it('repairs a mode this build does not know, keeping the device', () => {
    const stored: Record<string, unknown> = {
      ...defaultPersistedState(),
      layout: { mode: 'kaleidoscope', individualDeviceId: 'pixel-8' }
    }
    const { state } = migratePersistedState(stored)

    expect(state.layout).toEqual({ mode: 'flex', individualDeviceId: 'pixel-8' })
  })

  it.each([
    ['a junk device id', { mode: 'column', individualDeviceId: 7 }],
    ['an empty device id', { mode: 'column', individualDeviceId: '' }]
  ])('drops %s without costing the mode', (_label, layout) => {
    const stored: Record<string, unknown> = { ...defaultPersistedState(), layout }
    const { state } = migratePersistedState(stored)

    expect(state.layout).toEqual({ mode: 'column', individualDeviceId: null })
  })

  it.each([
    ['an array', []],
    ['a string', 'masonry'],
    ['null', null]
  ])('falls back whole when the slice is %s', (_label, layout) => {
    const stored: Record<string, unknown> = { ...defaultPersistedState(), layout }
    const { state } = migratePersistedState(stored)

    expect(state.layout).toEqual({ mode: 'flex', individualDeviceId: null })
  })

  it('replaces the slice wholesale on a patch', () => {
    const base = defaultPersistedState()
    const next = mergePersistedState(base, {
      layout: { mode: 'masonry', individualDeviceId: 'pixel-8' }
    })

    expect(next.layout).toEqual({ mode: 'masonry', individualDeviceId: 'pixel-8' })
    expect(base.layout.mode).toBe('flex')
  })
})

describe('bookmarks and the home page', () => {
  const bookmark = { id: 'bm-1', title: 'Example', url: 'https://example.com/', addedAt: 5 }

  function stored(over: Record<string, unknown>): PersistedState {
    return migratePersistedState({ ...defaultPersistedState(), ...over }).state
  }

  it('starts with nothing saved and nowhere to call home', () => {
    const state = defaultPersistedState()
    expect(state.bookmarks).toEqual([])
    expect(state.homeUrl).toBe('')
  })

  it('reads back what was saved', () => {
    expect(stored({ bookmarks: [bookmark], homeUrl: 'https://home.test/' })).toMatchObject({
      bookmarks: [bookmark],
      homeUrl: 'https://home.test/'
    })
  })

  it('normalizes a stored url rather than trusting the file', () => {
    expect(stored({ homeUrl: 'example.com' }).homeUrl).toBe('https://example.com/')
    expect(stored({ bookmarks: [{ ...bookmark, url: 'example.com' }] }).bookmarks[0]?.url).toBe(
      'https://example.com/'
    )
  })

  it('drops one broken bookmark rather than the whole list', () => {
    const state = stored({
      bookmarks: [
        bookmark,
        { ...bookmark, id: 'bm-2', url: 'javascript:alert(1)' },
        'not a bookmark',
        { ...bookmark, id: 'bm-3', url: 'https://kept.test/' }
      ]
    })

    expect(state.bookmarks.map((item) => item.id)).toEqual(['bm-1', 'bm-3'])
  })

  it('repairs the fields around a good url instead of dropping the row', () => {
    const state = stored({ bookmarks: [{ id: 'bm-1', url: 'https://a.test/', title: 7 }] })

    expect(state.bookmarks[0]).toEqual({
      id: 'bm-1',
      title: '',
      url: 'https://a.test/',
      addedAt: 0
    })
  })

  it('keeps only the first of two bookmarks sharing an id', () => {
    const state = stored({
      bookmarks: [bookmark, { ...bookmark, url: 'https://second.test/' }]
    })

    expect(state.bookmarks).toHaveLength(1)
  })

  it.each([
    ['a home page no view may load', 'javascript:alert(1)'],
    ['a home page that is not a string', 7],
    ['a home page longer than any url', `https://a.test/${'x'.repeat(3000)}`]
  ])('reads %s as no home page', (_label, homeUrl) => {
    expect(stored({ homeUrl }).homeUrl).toBe('')
  })

  it.each([
    ['not an array', {}],
    ['a string', 'bookmarks']
  ])('reads a bookmark list that is %s as an empty one', (_label, bookmarks) => {
    expect(stored({ bookmarks }).bookmarks).toEqual([])
  })

  it('merges both like every other slice — a value, not something to append to', () => {
    const base = defaultPersistedState()
    const merged = mergePersistedState(base, { bookmarks: [bookmark], homeUrl: 'https://h.test/' })

    expect(merged.bookmarks).toEqual([bookmark])
    // A clone, not the caller's array: the store keeps mutating its own copy.
    expect(merged.bookmarks[0]).not.toBe(bookmark)
    expect(merged.homeUrl).toBe('https://h.test/')
  })

  it('leaves both alone when a patch does not mention them', () => {
    const base = { ...defaultPersistedState(), bookmarks: [bookmark], homeUrl: 'https://h.test/' }
    const merged = mergePersistedState(base, { activeSuiteId: DEFAULT_SUITE_ID })

    expect(merged.bookmarks).toEqual([bookmark])
    expect(merged.homeUrl).toBe('https://h.test/')
  })
})

describe('site permissions', () => {
  function stored(over: Record<string, unknown>): PersistedState {
    return migratePersistedState({ ...defaultPersistedState(), ...over }).state
  }

  it('starts with no site decided about', () => {
    expect(defaultPersistedState().permissions).toEqual({})
  })

  it('reads back the decisions it was given', () => {
    const permissions = {
      'https://a.dev': { camera: 'allow', geolocation: 'block' },
      'http://localhost:5173': { midi: 'allow' }
    }
    expect(stored({ permissions }).permissions).toEqual(permissions)
  })

  it.each([
    ['a trailing slash', 'https://a.dev/'],
    ['a path', 'https://a.dev/app'],
    ['upper case', 'HTTPS://A.DEV'],
    ['a file url', 'file:///C:/x.html'],
    ['a scheme with no site behind it', 'about:blank'],
    ['junk', 'not-an-origin'],
    ['an empty key', '']
  ])('drops an entry keyed by %s — only a canonical origin is a site', (_label, origin) => {
    expect(stored({ permissions: { [origin]: { camera: 'allow' } } }).permissions).toEqual({})
  })

  it('drops one junk capability without costing the site the others', () => {
    const permissions = {
      'https://a.dev': { camera: 'allow', 'display-capture': 'allow', geolocation: 'maybe' }
    }
    expect(stored({ permissions }).permissions).toEqual({
      'https://a.dev': { camera: 'allow' }
    })
  })

  it('never stores "ask" — the absence of a row is what ask means', () => {
    const permissions = { 'https://a.dev': { camera: 'ask' } }
    expect(stored({ permissions }).permissions).toEqual({})
  })

  it('caps the number of sites it keeps decisions for', () => {
    const permissions: Record<string, unknown> = {}
    for (let n = 0; n < 250; n += 1) permissions[`https://s${n}.dev`] = { camera: 'allow' }

    expect(Object.keys(stored({ permissions }).permissions)).toHaveLength(200)
  })

  it.each([
    ['not an object', []],
    ['a string', 'permissions'],
    ['null', null]
  ])('reads a permissions document that is %s as an empty one', (_label, permissions) => {
    expect(stored({ permissions }).permissions).toEqual({})
  })

  it('merges like every other slice, and clones what it keeps', () => {
    const permissions = { 'https://a.dev': { camera: 'allow' as const } }
    const merged = mergePersistedState(defaultPersistedState(), { permissions })

    expect(merged.permissions).toEqual(permissions)
    expect(merged.permissions['https://a.dev']).not.toBe(permissions['https://a.dev'])
  })

  it('leaves it alone when a patch does not mention it', () => {
    const base = {
      ...defaultPersistedState(),
      permissions: { 'https://a.dev': { camera: 'allow' as const } }
    }
    const merged = mergePersistedState(base, { homeUrl: '' })

    expect(merged.permissions).toEqual(base.permissions)
  })
})

describe('the safety switches', () => {
  function stored(over: Record<string, unknown>): PersistedState {
    return migratePersistedState({ ...defaultPersistedState(), ...over }).state
  }

  it('starts with certificates enforced', () => {
    expect(defaultPersistedState().security).toEqual({ allowInsecureCertificates: false })
  })

  it('reads back an explicit true', () => {
    expect(stored({ security: { allowInsecureCertificates: true } }).security).toEqual({
      allowInsecureCertificates: true
    })
  })

  it.each([
    ['a truthy string', { allowInsecureCertificates: 'true' }],
    ['a number', { allowInsecureCertificates: 1 }],
    ['null', { allowInsecureCertificates: null }],
    ['nothing at all', {}]
  ])('reads %s as certificates staying enforced', (_label, security) => {
    expect(stored({ security }).security.allowInsecureCertificates).toBe(false)
  })

  it.each([
    ['not an object', 'yes'],
    ['an array', []],
    ['null', null]
  ])('reads a slice that is %s as the strict default', (_label, security) => {
    expect(stored({ security }).security).toEqual({ allowInsecureCertificates: false })
  })

  it('merges like every other slice', () => {
    const merged = mergePersistedState(defaultPersistedState(), {
      security: { allowInsecureCertificates: true }
    })
    expect(merged.security.allowInsecureCertificates).toBe(true)
  })

  it('leaves it alone when a patch does not mention it', () => {
    const base = { ...defaultPersistedState(), security: { allowInsecureCertificates: true } }
    expect(mergePersistedState(base, { homeUrl: '' }).security).toEqual(base.security)
  })
})

describe('the emulation slice', () => {
  function stored(over: Record<string, unknown>): PersistedState {
    return migratePersistedState({ ...defaultPersistedState(), ...over }).state
  }

  it('starts with nothing overridden', () => {
    const { emulation } = defaultPersistedState()
    expect(emulation.deviceVision).toEqual({})
    expect(emulation.profile).toEqual({
      colorScheme: 'system',
      reducedMotion: false,
      forcedColors: false,
      media: 'auto',
      vision: 'none',
      network: 'online',
      geolocation: null,
      locale: null,
      timezone: null
    })
  })

  it('reads a whole profile back', () => {
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
    const state = stored({ emulation: { profile, deviceVision: { 'pixel-8': 'none' } } })
    expect(state.emulation.profile).toEqual(profile)
    expect(state.emulation.deviceVision).toEqual({ 'pixel-8': 'none' })
  })

  it('repairs each field on its own, keeping the rest', () => {
    const state = stored({
      emulation: {
        profile: {
          colorScheme: 'sepia',
          reducedMotion: 'yes',
          media: 'braille',
          vision: 'x-ray',
          network: '5g',
          geolocation: { latitude: 200, longitude: 0 },
          locale: 'en_US',
          timezone: 'Mars/Olympus Mons'
        },
        deviceVision: { 'pixel-8': 'deuteranopia', '': 'protanopia', ghost: 'nope' }
      }
    })
    expect(state.emulation.profile).toEqual(defaultPersistedState().emulation.profile)
    expect(state.emulation.deviceVision).toEqual({ 'pixel-8': 'deuteranopia' })
  })

  it('keeps a valid time zone next to a junk locale', () => {
    const state = stored({
      emulation: { profile: { locale: 42, timezone: 'Europe/Berlin' }, deviceVision: {} }
    })
    expect(state.emulation.profile.locale).toBeNull()
    expect(state.emulation.profile.timezone).toBe('Europe/Berlin')
  })

  it.each([
    ['missing', undefined],
    ['not an object', 'dark'],
    ['an array', []],
    ['null', null]
  ])('reads a slice that is %s as the defaults', (_label, emulation) => {
    const doc: Record<string, unknown> = { ...defaultPersistedState() }
    if (emulation === undefined) delete doc['emulation']
    else doc['emulation'] = emulation
    expect(migratePersistedState(doc).state.emulation).toEqual(defaultPersistedState().emulation)
  })

  it('merges like every other slice, by copy', () => {
    const emulation = {
      profile: {
        ...defaultPersistedState().emulation.profile,
        geolocation: { latitude: 1, longitude: 2 }
      },
      deviceVision: { 'pixel-8': 'tritanopia' as const }
    }
    const merged = mergePersistedState(defaultPersistedState(), { emulation })
    expect(merged.emulation).toEqual(emulation)
    expect(merged.emulation.profile.geolocation).not.toBe(emulation.profile.geolocation)
    expect(merged.emulation.deviceVision).not.toBe(emulation.deviceVision)
  })

  it('leaves it alone when a patch does not mention it', () => {
    const base = {
      ...defaultPersistedState(),
      emulation: {
        profile: { ...defaultPersistedState().emulation.profile, colorScheme: 'dark' as const },
        deviceVision: {}
      }
    }
    expect(mergePersistedState(base, { homeUrl: '' }).emulation).toEqual(base.emulation)
  })
})
