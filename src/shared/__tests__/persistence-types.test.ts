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
