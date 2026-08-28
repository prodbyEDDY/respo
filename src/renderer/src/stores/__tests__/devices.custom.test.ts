import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_ID_PREFIX, type CustomDeviceInput } from '@shared/custom-devices'
import { DEVICE_CATALOG } from '@shared/deviceCatalog'
import { DEFAULT_SUITE_ID, defaultPersistedState } from '@shared/persistence-types'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { MAX_SUITE_DEVICES, suitesEmptiedBy, useDevices } from '../devices'
import { useSync } from '../sync'

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
  useSync.setState({ globalEnabled: true, disabled: {}, leadDeviceId: null })
  savePersistedState.mockClear()
}

describe('devices store — custom devices', () => {
  beforeEach(reset)

  describe('allDevices', () => {
    it('is the catalog until the user adds something', () => {
      expect(useDevices.getState().allDevices).toHaveLength(DEVICE_CATALOG.length)
    })

    it('grows and shrinks with the user’s devices', () => {
      useDevices.getState().addCustom(input())
      expect(useDevices.getState().allDevices).toHaveLength(DEVICE_CATALOG.length + 1)

      const id = useDevices.getState().customDevices[0]?.id as string
      useDevices.getState().removeCustom(id)
      expect(useDevices.getState().allDevices).toHaveLength(DEVICE_CATALOG.length)
    })
  })

  describe('addCustom', () => {
    it('gives the device a namespaced id and keeps its fields', () => {
      const result = useDevices.getState().addCustom(input({ name: 'My Watch' }))

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.device.id).toBe(`${CUSTOM_ID_PREFIX}my-watch`)
      expect(result.device).toMatchObject({ width: 400, height: 800, type: 'phone' })
    })

    it('puts it on the canvas, so it is not added into thin air', () => {
      const result = useDevices.getState().addCustom(input())
      if (!result.ok) throw new Error('add refused')

      const { active, suites } = useDevices.getState()
      expect(active.map((d) => d.id)).toContain(result.device.id)
      expect(suites[0]?.deviceIds.at(-1)).toBe(result.device.id)
    })

    it('persists the device and the suite that now names it', () => {
      const result = useDevices.getState().addCustom(input())
      if (!result.ok) throw new Error('add refused')

      expect(savePersistedState).toHaveBeenCalledTimes(1)
      const patch = savePersistedState.mock.calls[0]?.[0]
      expect(patch.customDevices).toEqual([result.device])
      expect(patch.suites[0].deviceIds).toContain(result.device.id)
    })

    it('two devices with the same name get distinct ids', () => {
      const first = useDevices.getState().addCustom(input({ name: 'Twin' }))
      const second = useDevices.getState().addCustom(input({ name: 'Twin' }))

      expect(first.ok && second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(second.device.id).not.toBe(first.device.id)
      expect(useDevices.getState().customDevices).toHaveLength(2)
    })

    it('reports having joined the suite', () => {
      const result = useDevices.getState().addCustom(input())
      expect(result.ok && result.joinedSuite).toBe(true)
    })

    it('still adds the device when the suite is full, and says it did not join', () => {
      const ids = DEVICE_CATALOG.slice(0, MAX_SUITE_DEVICES).map((d) => d.id)
      const state = defaultPersistedState()
      state.suites = [{ id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ids }]
      useDevices.getState().hydrate(state)
      savePersistedState.mockClear()

      const result = useDevices.getState().addCustom(input({ name: 'Kiosk' }))
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // The library takes it; the canvas is what is full.
      expect(result.joinedSuite).toBe(false)
      expect(useDevices.getState().customDevices).toHaveLength(1)
      expect(useDevices.getState().active.map((d) => d.id)).toEqual(ids)
      expect(savePersistedState.mock.calls[0]?.[0]).not.toHaveProperty('suites')
    })

    it('refuses past the document’s cap rather than writing something main rejects', () => {
      for (let i = 0; i < 64; i += 1) {
        expect(useDevices.getState().addCustom(input({ name: `Device ${i}` })).ok).toBe(true)
      }
      expect(useDevices.getState().addCustom(input({ name: 'One too many' }))).toEqual({
        ok: false,
        reason: 'too-many'
      })
      expect(useDevices.getState().customDevices).toHaveLength(64)
    })
  })

  describe('updateCustom', () => {
    it('rewrites the device in place, keeping its id', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      const result = useDevices.getState().updateCustom(added.device.id, input({ width: 1024 }))
      expect(result.ok).toBe(true)
      expect(useDevices.getState().customDevices).toHaveLength(1)
      expect(useDevices.getState().customDevices[0]).toMatchObject({
        id: added.device.id,
        width: 1024
      })
    })

    it('rebuilds the canvas selection, so main re-emulates the changed device', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')
      const before = useDevices.getState().active.find((d) => d.id === added.device.id)

      useDevices.getState().updateCustom(added.device.id, input({ height: 1000 }))
      const after = useDevices.getState().active.find((d) => d.id === added.device.id)

      expect(after).not.toBe(before)
      expect(after?.height).toBe(1000)
    })

    it('persists the devices but leaves the suites alone', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')
      savePersistedState.mockClear()

      useDevices.getState().updateCustom(added.device.id, input({ dpr: 3 }))
      expect(savePersistedState).toHaveBeenCalledTimes(1)
      expect(savePersistedState.mock.calls[0]?.[0]).not.toHaveProperty('suites')
    })

    it('refuses an id nothing answers to', () => {
      expect(useDevices.getState().updateCustom('nope', input())).toEqual({
        ok: false,
        reason: 'unknown-device'
      })
      expect(savePersistedState).not.toHaveBeenCalled()
    })

    it('refuses to rewrite a catalog device through this door', () => {
      expect(useDevices.getState().updateCustom('iphone-15-pro', input())).toEqual({
        ok: false,
        reason: 'unknown-device'
      })
    })
  })

  describe('removeCustom', () => {
    it('deletes the device and takes it out of every suite', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')
      const id = added.device.id

      const state = defaultPersistedState()
      state.customDevices = [added.device]
      state.suites = [
        { id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8', id] },
        { id: 'other', name: 'Other', deviceIds: [id, 'ipad-mini'] }
      ]
      useDevices.getState().hydrate(state)
      savePersistedState.mockClear()

      expect(useDevices.getState().removeCustom(id).ok).toBe(true)
      expect(useDevices.getState().customDevices).toEqual([])
      for (const suite of useDevices.getState().suites) {
        expect(suite.deviceIds).not.toContain(id)
      }
      expect(useDevices.getState().active.map((d) => d.id)).toEqual(['pixel-8'])
    })

    it('persists the devices and the suites it edited', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')
      savePersistedState.mockClear()

      useDevices.getState().removeCustom(added.device.id)
      const patch = savePersistedState.mock.calls[0]?.[0]
      expect(patch.customDevices).toEqual([])
      expect(patch.suites[0].deviceIds).not.toContain(added.device.id)
    })

    it('refuses to empty the active suite', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      const state = defaultPersistedState()
      state.customDevices = [added.device]
      state.suites = [{ id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: [added.device.id] }]
      useDevices.getState().hydrate(state)
      savePersistedState.mockClear()

      expect(useDevices.getState().removeCustom(added.device.id)).toEqual({
        ok: false,
        reason: 'last-in-suite'
      })
      expect(useDevices.getState().customDevices).toHaveLength(1)
      expect(useDevices.getState().active).toHaveLength(1)
      expect(savePersistedState).not.toHaveBeenCalled()
    })

    /**
     * The delete takes the device out of *every* suite, so the guard has to
     * cover every suite too: a suite left empty is a dead-end canvas waiting
     * behind the next suite switch, and nothing on screen said it would happen.
     */
    it('refuses when a suite the user is not looking at would be emptied', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      const state = defaultPersistedState()
      state.customDevices = [added.device]
      state.suites = [
        { id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8'] },
        { id: 'other', name: 'Other', deviceIds: [added.device.id] }
      ]
      useDevices.getState().hydrate(state)
      savePersistedState.mockClear()

      expect(useDevices.getState().removeCustom(added.device.id)).toEqual({
        ok: false,
        reason: 'last-in-suite'
      })
      expect(useDevices.getState().customDevices).toHaveLength(1)
      expect(useDevices.getState().suites[1]?.deviceIds).toEqual([added.device.id])
      expect(savePersistedState).not.toHaveBeenCalled()
    })

    it('allows the deletion once every suite keeps something else', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      const state = defaultPersistedState()
      state.customDevices = [added.device]
      state.suites = [
        { id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8'] },
        { id: 'other', name: 'Other', deviceIds: [added.device.id, 'ipad-mini'] }
      ]
      useDevices.getState().hydrate(state)

      expect(useDevices.getState().removeCustom(added.device.id).ok).toBe(true)
      expect(useDevices.getState().suites[1]?.deviceIds).toEqual(['ipad-mini'])
    })

    it('names the suites in the way, so the dialog can say which', () => {
      const suites = [
        { id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8', 'custom-mine'] },
        { id: 'other', name: 'Other', deviceIds: ['custom-mine'] }
      ]
      expect(suitesEmptiedBy(suites, 'custom-mine').map((s) => s.name)).toEqual(['Other'])
      expect(suitesEmptiedBy(suites, 'pixel-8')).toEqual([])
    })

    it('un-mutes the deleted id, so the next device of that name is not born silent', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      // The user mutes it, then deletes it. Ids are slugs of the name, so a
      // second "My phone" would resolve to the same id.
      useSync.getState().toggleDevice(added.device.id)
      expect(useSync.getState().disabled[added.device.id]).toBe(true)

      expect(useDevices.getState().removeCustom(added.device.id).ok).toBe(true)
      expect(useSync.getState().disabled).toEqual({})

      const again = useDevices.getState().addCustom(input())
      expect(again.ok && again.device.id).toBe(added.device.id)
      expect(useSync.getState().disabled[added.device.id]).toBeUndefined()
    })

    it('leaves the other mutes alone', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      useSync.getState().toggleDevice('pixel-8')
      useSync.getState().toggleDevice(added.device.id)

      useDevices.getState().removeCustom(added.device.id)
      expect(useSync.getState().disabled).toEqual({ 'pixel-8': true })
    })

    it('refuses an id nothing answers to, and a catalog one', () => {
      expect(useDevices.getState().removeCustom('nope').ok).toBe(false)
      expect(useDevices.getState().removeCustom('iphone-15-pro')).toEqual({
        ok: false,
        reason: 'unknown-device'
      })
      expect(savePersistedState).not.toHaveBeenCalled()
    })
  })

  describe('hydration', () => {
    it('a restored custom device resolves onto the canvas', () => {
      const state = defaultPersistedState()
      state.customDevices = [
        {
          id: 'custom-mine',
          name: 'Mine',
          width: 500,
          height: 900,
          dpr: 2,
          userAgent: 'UA',
          touch: true,
          type: 'phone',
          rotatable: true
        }
      ]
      state.suites = [{ id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['custom-mine'] }]

      useDevices.getState().hydrate(state)
      expect(useDevices.getState().active.map((d) => d.id)).toEqual(['custom-mine'])
      expect(useDevices.getState().allDevices.at(-1)?.id).toBe('custom-mine')
      expect(savePersistedState).not.toHaveBeenCalled()
    })
  })
})
