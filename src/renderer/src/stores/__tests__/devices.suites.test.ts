import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeBackup, type RespoBackupV1 } from '@shared/backup'
import type { CustomDeviceInput } from '@shared/custom-devices'
import { DEFAULT_SUITE_ID, defaultPersistedState } from '@shared/persistence-types'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { NEW_SUITE_DEVICE_ID, useDevices } from '../devices'

function input(over: Partial<CustomDeviceInput> = {}): CustomDeviceInput {
  return {
    name: 'My phone',
    width: 400,
    height: 800,
    dpr: 2,
    userAgent: 'MyBot/1.0',
    touch: true,
    type: 'phone',
    rotatable: true,
    ...over
  }
}

function reset(): void {
  useDevices.getState().hydrate(defaultPersistedState())
  savePersistedState.mockClear()
}

/** Ids of the devices the canvas is showing, in canvas order. */
function activeIds(): string[] {
  return useDevices.getState().active.map((d) => d.id)
}

/** The suite the canvas is resolved from. */
function activeSuite(): { id: string; name: string; deviceIds: string[] } {
  const { suites, activeSuiteId } = useDevices.getState()
  const suite = suites.find((s) => s.id === activeSuiteId)
  if (suite === undefined) throw new Error('no active suite')
  return suite
}

describe('devices store — suites', () => {
  beforeEach(reset)

  describe('createSuite', () => {
    it('adds a suite with one device and switches to it', () => {
      const result = useDevices.getState().createSuite('Marketing site')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(useDevices.getState().suites).toHaveLength(2)
      expect(useDevices.getState().activeSuiteId).toBe(result.suite.id)
      expect(activeIds()).toEqual([NEW_SUITE_DEVICE_ID])
    })

    it('gives the suite a readable id derived from its name', () => {
      const result = useDevices.getState().createSuite('Marketing site')
      expect(result.ok && result.suite.id).toBe('suite-marketing-site')
    })

    it('persists the suites and the new selection', () => {
      useDevices.getState().createSuite('Second')

      expect(savePersistedState).toHaveBeenCalledTimes(1)
      const patch = savePersistedState.mock.calls[0]?.[0]
      expect(patch.suites).toHaveLength(2)
      expect(patch.activeSuiteId).toBe('suite-second')
    })

    it('trims the name and refuses an empty one', () => {
      expect(useDevices.getState().createSuite('  Spaced  ').ok).toBe(true)
      expect(useDevices.getState().suites[1]?.name).toBe('Spaced')

      expect(useDevices.getState().createSuite('   ')).toEqual({
        ok: false,
        reason: 'invalid-name'
      })
      expect(useDevices.getState().createSuite('x'.repeat(61))).toEqual({
        ok: false,
        reason: 'invalid-name'
      })
    })

    it('refuses a name another suite already has, however it is cased', () => {
      useDevices.getState().createSuite('Landing')
      expect(useDevices.getState().createSuite('  landing ')).toEqual({
        ok: false,
        reason: 'duplicate-name'
      })
      expect(useDevices.getState().suites).toHaveLength(2)
    })

    it('refuses past the document’s cap', () => {
      for (let i = 1; i < 64; i += 1) {
        expect(useDevices.getState().createSuite(`Suite ${i}`).ok).toBe(true)
      }
      expect(useDevices.getState().createSuite('One too many')).toEqual({
        ok: false,
        reason: 'too-many'
      })
      expect(useDevices.getState().suites).toHaveLength(64)
    })
  })

  describe('deleteSuite', () => {
    it('removes the suite and hands the canvas to a survivor', () => {
      const created = useDevices.getState().createSuite('Second')
      if (!created.ok) throw new Error('create refused')
      savePersistedState.mockClear()

      expect(useDevices.getState().deleteSuite(created.suite.id).ok).toBe(true)
      expect(useDevices.getState().suites.map((s) => s.id)).toEqual([DEFAULT_SUITE_ID])
      expect(useDevices.getState().activeSuiteId).toBe(DEFAULT_SUITE_ID)
      expect(activeIds()).toEqual(defaultPersistedState().suites[0]?.deviceIds)

      const patch = savePersistedState.mock.calls[0]?.[0]
      expect(patch.activeSuiteId).toBe(DEFAULT_SUITE_ID)
    })

    it('leaves the active suite alone when another one is deleted', () => {
      useDevices.getState().createSuite('Second')
      useDevices.getState().setActiveSuite(DEFAULT_SUITE_ID)

      expect(useDevices.getState().deleteSuite('suite-second').ok).toBe(true)
      expect(useDevices.getState().activeSuiteId).toBe(DEFAULT_SUITE_ID)
    })

    it('refuses to delete the only suite', () => {
      expect(useDevices.getState().deleteSuite(DEFAULT_SUITE_ID)).toEqual({
        ok: false,
        reason: 'last-suite'
      })
      expect(useDevices.getState().suites).toHaveLength(1)
      expect(savePersistedState).not.toHaveBeenCalled()
    })

    it('refuses an id nothing answers to', () => {
      useDevices.getState().createSuite('Second')
      savePersistedState.mockClear()

      expect(useDevices.getState().deleteSuite('nope')).toEqual({
        ok: false,
        reason: 'unknown-suite'
      })
      expect(savePersistedState).not.toHaveBeenCalled()
    })
  })

  describe('toggleDeviceInSuite', () => {
    it('appends a device the suite did not have, at the end', () => {
      expect(useDevices.getState().toggleDeviceInSuite('iphone-se').ok).toBe(true)
      expect(activeSuite().deviceIds.at(-1)).toBe('iphone-se')
      expect(activeIds().at(-1)).toBe('iphone-se')
    })

    it('removes a device the suite had', () => {
      expect(useDevices.getState().toggleDeviceInSuite('pixel-8').ok).toBe(true)
      expect(activeSuite().deviceIds).not.toContain('pixel-8')
      expect(activeIds()).not.toContain('pixel-8')
    })

    it('works on custom devices too', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      useDevices.getState().toggleDeviceInSuite(added.device.id)
      expect(activeIds()).not.toContain(added.device.id)
      useDevices.getState().toggleDeviceInSuite(added.device.id)
      expect(activeIds()).toContain(added.device.id)
    })

    it('persists the suites, and only those', () => {
      useDevices.getState().toggleDeviceInSuite('iphone-se')
      expect(savePersistedState).toHaveBeenCalledTimes(1)
      const patch = savePersistedState.mock.calls[0]?.[0]
      expect(patch.suites[0].deviceIds).toContain('iphone-se')
      expect(patch).not.toHaveProperty('customDevices')
    })

    it('refuses to empty the suite', () => {
      const state = defaultPersistedState()
      state.suites = [{ id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8'] }]
      useDevices.getState().hydrate(state)
      savePersistedState.mockClear()

      expect(useDevices.getState().toggleDeviceInSuite('pixel-8')).toEqual({
        ok: false,
        reason: 'last-in-suite'
      })
      expect(activeIds()).toEqual(['pixel-8'])
      expect(savePersistedState).not.toHaveBeenCalled()
    })

    it('refuses a device nothing answers to', () => {
      expect(useDevices.getState().toggleDeviceInSuite('ghost')).toEqual({
        ok: false,
        reason: 'unknown-device'
      })
      expect(savePersistedState).not.toHaveBeenCalled()
    })

    it('only touches the active suite', () => {
      const state = defaultPersistedState()
      state.suites.push({ id: 'other', name: 'Other', deviceIds: ['ipad-mini'] })
      useDevices.getState().hydrate(state)

      useDevices.getState().toggleDeviceInSuite('iphone-se')
      expect(useDevices.getState().suites[1]?.deviceIds).toEqual(['ipad-mini'])
    })
  })

  describe('reorderSuiteDevices', () => {
    it('moves a device, and the canvas order follows', () => {
      const before = activeIds()
      useDevices.getState().reorderSuiteDevices(0, 2)

      const expected = [before[1], before[2], before[0], before[3], before[4]]
      expect(activeSuite().deviceIds).toEqual(expected)
      expect(activeIds()).toEqual(expected)
    })

    it('moves a device backwards too', () => {
      const before = activeIds()
      useDevices.getState().reorderSuiteDevices(3, 0)
      expect(activeIds()[0]).toBe(before[3])
    })

    it('persists the new order', () => {
      useDevices.getState().reorderSuiteDevices(0, 1)
      expect(savePersistedState).toHaveBeenCalledTimes(1)
      expect(savePersistedState.mock.calls[0]?.[0].suites[0].deviceIds).toEqual(activeIds())
    })

    it('ignores indices that are not positions in the suite', () => {
      const before = activeIds()
      useDevices.getState().reorderSuiteDevices(0, 0)
      useDevices.getState().reorderSuiteDevices(-1, 2)
      useDevices.getState().reorderSuiteDevices(0, 99)
      useDevices.getState().reorderSuiteDevices(1.5, 2)

      expect(activeIds()).toEqual(before)
      expect(savePersistedState).not.toHaveBeenCalled()
    })
  })

  describe('importBackup', () => {
    /** A document exported from somewhere else. */
    function foreignBackup(): RespoBackupV1 {
      return {
        version: 1,
        customDevices: [
          {
            id: 'custom-watch',
            name: 'Watch',
            width: 200,
            height: 300,
            dpr: 2,
            userAgent: 'WatchOS',
            touch: true,
            type: 'phone',
            rotatable: false
          }
        ],
        suites: [{ id: 'suite-tiny', name: 'Tiny', deviceIds: ['custom-watch', 'iphone-se'] }]
      }
    }

    it('restores a document exported from a clean state', () => {
      // Build something, export it, wipe, import — the acceptance path.
      useDevices.getState().addCustom(input({ name: 'Kiosk', width: 1080, height: 1920 }))
      useDevices.getState().createSuite('Kiosks')
      const exported = serializeBackup(useDevices.getState())

      useDevices.getState().reset()
      expect(useDevices.getState().customDevices).toEqual([])

      const merged = useDevices.getState().importBackup(exported)
      expect(merged.devicesAdded).toBe(1)
      expect(useDevices.getState().customDevices.map((d) => d.name)).toEqual(['Kiosk'])
      expect(useDevices.getState().suites.map((s) => s.name)).toEqual(['Default', 'Kiosks'])
    })

    it('adds what is new and keeps what the document already had', () => {
      const merged = useDevices.getState().importBackup(foreignBackup())

      expect(merged.devicesAdded).toBe(1)
      expect(merged.suitesAdded).toBe(1)
      expect(useDevices.getState().suites.map((s) => s.name)).toEqual(['Default', 'Tiny'])
      expect(useDevices.getState().allDevices.at(-1)?.name).toBe('Watch')
    })

    it('stays on the suite the user was looking at', () => {
      useDevices.getState().importBackup(foreignBackup())
      expect(useDevices.getState().activeSuiteId).toBe(DEFAULT_SUITE_ID)
      expect(activeIds()).toEqual(defaultPersistedState().suites[0]?.deviceIds)
    })

    it('overwrites the membership of a suite of the same name', () => {
      const backup: RespoBackupV1 = {
        version: 1,
        customDevices: [],
        suites: [{ id: 'whatever', name: 'Default', deviceIds: ['ipad-air'] }]
      }
      useDevices.getState().importBackup(backup)

      expect(useDevices.getState().suites).toHaveLength(1)
      expect(activeIds()).toEqual(['ipad-air'])
    })

    it('persists devices, suites and the resolved selection in one patch', () => {
      useDevices.getState().importBackup(foreignBackup())

      expect(savePersistedState).toHaveBeenCalledTimes(1)
      const patch = savePersistedState.mock.calls[0]?.[0]
      expect(patch.customDevices).toHaveLength(1)
      expect(patch.suites).toHaveLength(2)
      expect(patch.activeSuiteId).toBe(DEFAULT_SUITE_ID)
    })
  })

  describe('reset', () => {
    it('goes back to the default suite with no devices of your own', () => {
      useDevices.getState().addCustom(input())
      useDevices.getState().createSuite('Second')
      savePersistedState.mockClear()

      useDevices.getState().reset()

      const fresh = defaultPersistedState()
      expect(useDevices.getState().customDevices).toEqual([])
      expect(useDevices.getState().suites).toEqual(fresh.suites)
      expect(useDevices.getState().activeSuiteId).toBe(fresh.activeSuiteId)
      expect(activeIds()).toEqual(fresh.suites[0]?.deviceIds)
      expect(savePersistedState).toHaveBeenCalledTimes(1)
    })
  })
})
