import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ACTIVE_DEVICE_IDS } from '@shared/deviceCatalog'
import { DEFAULT_SUITE_ID, defaultPersistedState } from '@shared/persistence-types'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useDevices } from '../devices'

function reset(): void {
  useDevices.getState().hydrate(defaultPersistedState())
  savePersistedState.mockClear()
}

describe('devices store — suites and persistence', () => {
  beforeEach(reset)

  it('starts on the Default suite', () => {
    const { suites, activeSuiteId, active } = useDevices.getState()
    expect(suites).toHaveLength(1)
    expect(activeSuiteId).toBe(DEFAULT_SUITE_ID)
    expect(active.map((d) => d.id)).toEqual([...DEFAULT_ACTIVE_DEVICE_IDS])
  })

  it('hydrate installs the stored document without writing it back', () => {
    const state = defaultPersistedState()
    state.suites = [
      { id: 'a', name: 'A', deviceIds: ['pixel-8'] },
      { id: 'b', name: 'B', deviceIds: ['ipad-mini', 'desktop-1920'] }
    ]
    state.activeSuiteId = 'b'

    useDevices.getState().hydrate(state)
    expect(useDevices.getState().active.map((d) => d.id)).toEqual(['ipad-mini', 'desktop-1920'])
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('hydrate resolves custom devices alongside catalog ones', () => {
    const state = defaultPersistedState()
    state.customDevices = [
      {
        id: 'my-phone',
        name: 'My phone',
        width: 400,
        height: 800,
        dpr: 2,
        userAgent: 'UA',
        touch: true
      }
    ]
    state.suites = [{ id: 'a', name: 'A', deviceIds: ['my-phone', 'pixel-8'] }]
    state.activeSuiteId = 'a'

    useDevices.getState().hydrate(state)
    expect(useDevices.getState().active.map((d) => d.id)).toEqual(['my-phone', 'pixel-8'])
    expect(useDevices.getState().active[0]).toMatchObject({ width: 400, height: 800 })
  })

  it('setActive rewrites the active suite and persists it', () => {
    useDevices.getState().setActive(['pixel-8', 'ipad-mini'])

    expect(useDevices.getState().suites[0]?.deviceIds).toEqual(['pixel-8', 'ipad-mini'])
    expect(savePersistedState).toHaveBeenCalledTimes(1)
    expect(savePersistedState).toHaveBeenCalledWith({
      suites: [{ id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8', 'ipad-mini'] }]
    })
  })

  it('setActive persists the resolved ids, not the junk it was handed', () => {
    useDevices.getState().setActive(['pixel-8', 'not-a-device', 'pixel-8'])
    expect(useDevices.getState().suites[0]?.deviceIds).toEqual(['pixel-8'])
  })

  it('setActive spends no IPC when the selection did not change', () => {
    useDevices.getState().setActive([...DEFAULT_ACTIVE_DEVICE_IDS])
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('setActiveSuite switches the canvas and persists the choice', () => {
    const state = defaultPersistedState()
    state.suites.push({ id: 'b', name: 'B', deviceIds: ['desktop-1920'] })
    useDevices.getState().hydrate(state)
    savePersistedState.mockClear()

    useDevices.getState().setActiveSuite('b')
    expect(useDevices.getState().active.map((d) => d.id)).toEqual(['desktop-1920'])
    expect(savePersistedState).toHaveBeenCalledWith({ activeSuiteId: 'b' })
  })

  it('setActiveSuite ignores an unknown id', () => {
    useDevices.getState().setActiveSuite('nope')
    expect(useDevices.getState().activeSuiteId).toBe(DEFAULT_SUITE_ID)
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('setActiveSuite ignores a re-selection of the current suite', () => {
    useDevices.getState().setActiveSuite(DEFAULT_SUITE_ID)
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})
