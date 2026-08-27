import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ACTIVE_DEVICE_IDS } from '@shared/deviceCatalog'
import { useDevices } from '../devices'

function ids(): string[] {
  return useDevices.getState().active.map((d) => d.id)
}

describe('devices store', () => {
  beforeEach(() => {
    useDevices.getState().setActive([...DEFAULT_ACTIVE_DEVICE_IDS])
  })

  it('starts on the five default devices', () => {
    expect(ids()).toEqual([...DEFAULT_ACTIVE_DEVICE_IDS])
  })

  it('resolves ids to full specs', () => {
    const first = useDevices.getState().active[0]
    expect(first).toMatchObject({ id: 'iphone-15-pro', width: 393, dpr: 3 })
  })

  it('setActive replaces the selection and keeps the given order', () => {
    useDevices.getState().setActive(['desktop-1920', 'iphone-se'])
    expect(ids()).toEqual(['desktop-1920', 'iphone-se'])
  })

  it('setActive ignores unknown ids', () => {
    useDevices.getState().setActive(['pixel-8', 'not-a-device'])
    expect(ids()).toEqual(['pixel-8'])
  })

  it('setActive de-duplicates so a device never gets two views', () => {
    useDevices.getState().setActive(['pixel-8', 'pixel-8', 'iphone-se'])
    expect(ids()).toEqual(['pixel-8', 'iphone-se'])
  })

  it('keeps the same array identity when the selection did not change', () => {
    const before = useDevices.getState().active
    useDevices.getState().setActive([...DEFAULT_ACTIVE_DEVICE_IDS])
    // App effects are keyed on this array; a new identity would re-sync every
    // view for nothing.
    expect(useDevices.getState().active).toBe(before)
  })

  it('accepts an empty selection', () => {
    useDevices.getState().setActive([])
    expect(ids()).toEqual([])
  })
})
