import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_ID_PREFIX, type CustomDeviceInput } from '@shared/custom-devices'
import { DEVICE_CATALOG } from '@shared/deviceCatalog'
import { DEFAULT_SUITE_ID, defaultPersistedState } from '@shared/persistence-types'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useDevices } from '../devices'

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

    it('allows the deletion when the active suite does not use the device', () => {
      const added = useDevices.getState().addCustom(input())
      if (!added.ok) throw new Error('add refused')

      const state = defaultPersistedState()
      state.customDevices = [added.device]
      state.suites = [
        { id: DEFAULT_SUITE_ID, name: 'Default', deviceIds: ['pixel-8'] },
        { id: 'other', name: 'Other', deviceIds: [added.device.id] }
      ]
      useDevices.getState().hydrate(state)

      expect(useDevices.getState().removeCustom(added.device.id).ok).toBe(true)
      expect(useDevices.getState().suites[1]?.deviceIds).toEqual([])
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
