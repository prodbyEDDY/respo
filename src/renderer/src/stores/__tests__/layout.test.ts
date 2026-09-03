import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceById } from '@shared/deviceCatalog'
import type { DeviceSpec } from '@shared/types'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useDevices } from '../devices'
import { applyRotation, MAX_ZOOM, MIN_ZOOM, useLayout, ZOOM_STEPS } from '../layout'

const IPHONE = 'iphone-15-pro'
const IPAD = 'ipad-mini'
const DESKTOP = 'desktop-1440'

function zoom(): number {
  return useLayout.getState().zoom
}

describe('layout store — zoom', () => {
  beforeEach(() => {
    useLayout.setState({ zoom: 1, rotated: {} })
  })

  it('publishes the approved zoom ladder', () => {
    expect([...ZOOM_STEPS]).toEqual([0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2])
    expect(MIN_ZOOM).toBe(0.25)
    expect(MAX_ZOOM).toBe(2)
  })

  it('steps up and down through the ladder', () => {
    useLayout.getState().zoomIn()
    expect(zoom()).toBe(1.1)

    useLayout.getState().zoomOut()
    expect(zoom()).toBe(1)

    useLayout.getState().zoomOut()
    expect(zoom()).toBe(0.9)
  })

  it('clamps at both ends of the ladder', () => {
    for (let i = 0; i < 20; i += 1) useLayout.getState().zoomIn()
    expect(zoom()).toBe(MAX_ZOOM)

    for (let i = 0; i < 30; i += 1) useLayout.getState().zoomOut()
    expect(zoom()).toBe(MIN_ZOOM)
  })

  it('snaps to the next rung from a value the wheel left in between', () => {
    useLayout.getState().setZoom(0.8)
    useLayout.getState().zoomIn()
    expect(zoom()).toBe(0.9)

    useLayout.getState().setZoom(0.8)
    useLayout.getState().zoomOut()
    expect(zoom()).toBe(0.75)
  })

  it('setZoom accepts values between rungs, for the wheel gesture', () => {
    useLayout.getState().setZoom(0.83)
    expect(zoom()).toBe(0.83)
  })

  it('setZoom clamps instead of refusing', () => {
    useLayout.getState().setZoom(9)
    expect(zoom()).toBe(MAX_ZOOM)

    useLayout.getState().setZoom(0.01)
    expect(zoom()).toBe(MIN_ZOOM)
  })

  it('setZoom ignores a value that is not a number', () => {
    useLayout.getState().setZoom(1.25)
    useLayout.getState().setZoom(Number.NaN)
    expect(zoom()).toBe(1.25)
  })

  it('resetZoom goes back to 1:1', () => {
    useLayout.getState().setZoom(0.5)
    useLayout.getState().resetZoom()
    expect(zoom()).toBe(1)
  })
})

describe('layout store — rotation', () => {
  beforeEach(() => {
    useLayout.setState({ zoom: 1, rotated: {} })
    useDevices.getState().setActive([IPHONE, IPAD, DESKTOP])
    savePersistedState.mockClear()
  })

  it('rotates a touch device and rotates it back', () => {
    useLayout.getState().rotate(IPHONE)
    expect(useLayout.getState().rotated[IPHONE]).toBe(true)

    useLayout.getState().rotate(IPHONE)
    expect(useLayout.getState().rotated[IPHONE]).toBe(false)
  })

  it('refuses to rotate a device without a touch screen', () => {
    useLayout.getState().rotate(DESKTOP)
    expect(useLayout.getState().rotated[DESKTOP]).toBeUndefined()
  })

  it('ignores an id the catalog does not know', () => {
    useLayout.getState().rotate('not-a-device')
    expect(useLayout.getState().rotated).toEqual({})
  })

  it('rotateAll turns every active touch device to landscape', () => {
    useLayout.getState().rotateAll()

    expect(useLayout.getState().rotated).toEqual({ [IPHONE]: true, [IPAD]: true })
  })

  it('rotateAll brings them all back once they are all landscape', () => {
    useLayout.getState().rotateAll()
    useLayout.getState().rotateAll()

    expect(useLayout.getState().rotated).toEqual({ [IPHONE]: false, [IPAD]: false })
  })

  it('rotateAll levels a mixed canvas to landscape first', () => {
    useLayout.getState().rotate(IPHONE)
    useLayout.getState().rotateAll()

    expect(useLayout.getState().rotated).toEqual({ [IPHONE]: true, [IPAD]: true })
  })

  it('persists the landscape devices, so a session comes back turned', () => {
    useLayout.getState().rotate(IPHONE)
    expect(savePersistedState).toHaveBeenCalledWith({ rotated: { [IPHONE]: true } })

    useLayout.getState().rotateAll()
    expect(savePersistedState).toHaveBeenLastCalledWith({
      rotated: { [IPHONE]: true, [IPAD]: true }
    })
  })

  it('writes only the exceptions: a device turned back is simply absent', () => {
    useLayout.getState().rotate(IPHONE)
    useLayout.getState().rotate(IPHONE)

    // The store keeps the `false` — the toggle reads it — but the document
    // would otherwise grow one dead entry per rotation, forever.
    expect(useLayout.getState().rotated[IPHONE]).toBe(false)
    expect(savePersistedState).toHaveBeenLastCalledWith({ rotated: {} })
  })

  it('writes nothing when a rotation was refused', () => {
    useLayout.getState().rotate(DESKTOP)
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('installs the restored orientations without writing them back', () => {
    useLayout.getState().hydrateRotation({ [IPAD]: true })

    expect(useLayout.getState().rotated).toEqual({ [IPAD]: true })
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('keeps the same rotated object when nothing could be rotated', () => {
    useDevices.getState().setActive([DESKTOP])
    const before = useLayout.getState().rotated

    useLayout.getState().rotateAll()

    // Device specs are derived from this object; a new identity would re-sync
    // every view for nothing.
    expect(useLayout.getState().rotated).toBe(before)
  })
})

describe('applyRotation', () => {
  const iphone = deviceById(IPHONE) as DeviceSpec
  const desktop = deviceById(DESKTOP) as DeviceSpec

  it('swaps width and height for a rotated device', () => {
    const [rotated] = applyRotation([iphone], { [IPHONE]: true })

    expect(rotated).toMatchObject({
      id: IPHONE,
      width: iphone.height,
      height: iphone.width,
      dpr: iphone.dpr,
      userAgent: iphone.userAgent
    })
  })

  it('leaves untouched devices exactly as they were', () => {
    const result = applyRotation([iphone, desktop], { [IPHONE]: true })

    // Identity matters: `views:sync-devices` re-emulates a spec that changed.
    expect(result[1]).toBe(desktop)
  })

  it('is a no-op when nothing is rotated', () => {
    const devices = [iphone, desktop]
    expect(applyRotation(devices, {})).toEqual(devices)
    expect(applyRotation(devices, { [IPHONE]: false })[0]).toBe(iphone)
  })
})

describe('layout store — canvas arrangement', () => {
  beforeEach(() => {
    savePersistedState.mockClear()
    useLayout.setState({
      mode: 'flex',
      individualDeviceId: null,
      beforeIndividual: null,
      zoom: 1
    })
  })

  it('opens on the arrangement Respo has always used', () => {
    expect(useLayout.getState().mode).toBe('flex')
  })

  it('writes the mode and the expanded device together, as one decision', () => {
    useLayout.getState().setMode('masonry')

    expect(useLayout.getState().mode).toBe('masonry')
    expect(savePersistedState).toHaveBeenCalledWith({
      layout: { mode: 'masonry', individualDeviceId: null }
    })
  })

  it('spends nothing on a switch to the mode it is already in', () => {
    useLayout.getState().setMode('flex')
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('cycles column → flex → masonry → individual → column', () => {
    const seen: string[] = []
    useLayout.setState({ mode: 'column' })
    for (let i = 0; i < 4; i += 1) {
      useLayout.getState().cycleMode()
      seen.push(useLayout.getState().mode)
    }
    expect(seen).toEqual(['flex', 'masonry', 'individual', 'column'])
  })

  it('remembers the arrangement and the zoom one device took the canvas from', () => {
    useLayout.setState({ mode: 'masonry', zoom: 1.25 })
    useLayout.getState().enterIndividual(IPAD)

    expect(useLayout.getState()).toMatchObject({ mode: 'individual', individualDeviceId: IPAD })

    // The canvas fits the device once it is expanded; leaving undoes both.
    useLayout.getState().setZoom(0.5)
    useLayout.getState().exitIndividual()

    expect(useLayout.getState()).toMatchObject({ mode: 'masonry', zoom: 1.25 })
    expect(useLayout.getState().beforeIndividual).toBeNull()
  })

  it('leaves individual mode for a sane arrangement when it was restored into it', () => {
    useLayout.getState().hydrateLayout({ mode: 'individual', individualDeviceId: IPAD })
    useLayout.getState().exitIndividual()
    expect(useLayout.getState().mode).toBe('flex')
  })

  it('ignores a request to leave a mode it is not in', () => {
    useLayout.setState({ mode: 'column' })
    useLayout.getState().exitIndividual()
    expect(useLayout.getState().mode).toBe('column')
  })

  it('records the device when one frame is expanded from a canvas already expanded', () => {
    useLayout.getState().enterIndividual(IPHONE)
    savePersistedState.mockClear()
    useLayout.getState().enterIndividual(IPAD)

    expect(useLayout.getState().individualDeviceId).toBe(IPAD)
    expect(savePersistedState).toHaveBeenCalledWith({
      layout: { mode: 'individual', individualDeviceId: IPAD }
    })
  })

  it('switches tabs without touching the mode or the zoom', () => {
    useLayout.getState().enterIndividual(IPHONE)
    useLayout.setState({ zoom: 0.5 })
    savePersistedState.mockClear()

    useLayout.getState().showIndividual(DESKTOP)
    expect(useLayout.getState()).toMatchObject({
      mode: 'individual',
      individualDeviceId: DESKTOP,
      zoom: 0.5
    })

    // The same tab again is not a change, and does not cost a write.
    savePersistedState.mockClear()
    useLayout.getState().showIndividual(DESKTOP)
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('installs a restored arrangement without writing it straight back', () => {
    useLayout.getState().hydrateLayout({ mode: 'column', individualDeviceId: IPAD })

    expect(useLayout.getState()).toMatchObject({ mode: 'column', individualDeviceId: IPAD })
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})
