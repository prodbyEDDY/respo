import { beforeEach, describe, expect, it } from 'vitest'
import { deviceById } from '@shared/deviceCatalog'
import type { DeviceSpec } from '@shared/types'
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
