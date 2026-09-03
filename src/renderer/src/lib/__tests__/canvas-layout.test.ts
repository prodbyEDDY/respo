import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState: vi.fn(),
  loadPersistedState: vi.fn()
}))

import { deviceById } from '@shared/deviceCatalog'
import type { DeviceSpec } from '@shared/types'
import {
  fitZoom,
  FRAME_CAPTION_HEIGHT,
  FRAME_GAP,
  frameHeight,
  packedWidth,
  packMasonry,
  planMasonry
} from '../canvas-layout'

function device(id: string): DeviceSpec {
  const spec = deviceById(id)
  if (spec === undefined) throw new Error(`no such device: ${id}`)
  return spec
}

/** A device of exactly these metrics, for arithmetic that has to be readable. */
function box(id: string, width: number, height: number): DeviceSpec {
  return { id, name: id, width, height, dpr: 1, userAgent: 'ua', touch: false }
}

const IPHONE = device('iphone-15-pro')
const DESKTOP = device('desktop-1440')

describe('planMasonry', () => {
  it('uses as many columns as actually fit across the canvas', () => {
    const devices = [box('a', 300, 100), box('b', 300, 100), box('c', 300, 100)]
    // Two 300px columns and one 24px gap need 624px; three need 948px.
    expect(planMasonry(devices, 1, 948)).toHaveLength(3)
    expect(planMasonry(devices, 1, 947)).toHaveLength(2)
    expect(planMasonry(devices, 1, 623)).toHaveLength(1)
  })

  it('does not collapse a whole suite because one device is wide', () => {
    // The regression this exists for: a column width taken from the *widest*
    // device would price the phone column at the monitor's width and give up.
    const columns = planMasonry([IPHONE, DESKTOP], 1, 393 + 1440 + FRAME_GAP)
    expect(columns).toHaveLength(2)
    expect(columns.flat().map((d) => d.id)).toEqual([IPHONE.id, DESKTOP.id])
  })

  it('never draws wider than the canvas it was given room in', () => {
    const devices = [IPHONE, DESKTOP, box('mid', 800, 600), box('small', 320, 500)]
    for (const width of [400, 900, 1400, 2400, 4000]) {
      const columns = planMasonry(devices, 1, width)
      if (columns.length > 1) expect(packedWidth(columns, 1)).toBeLessThanOrEqual(width)
    }
  })

  it('falls back to one column when even that overflows', () => {
    // A device wider than the canvas has to overflow something.
    expect(planMasonry([DESKTOP], 1, 200)).toHaveLength(1)
    expect(planMasonry([IPHONE, DESKTOP], 1, 100)).toHaveLength(1)
  })

  it('follows the canvas zoom: half the size, more columns', () => {
    const devices = [box('a', 600, 100), box('b', 600, 100)]
    expect(planMasonry(devices, 1, 700)).toHaveLength(1)
    expect(planMasonry(devices, 0.5, 700)).toHaveLength(2)
  })

  it('answers an empty canvas without inventing a column', () => {
    expect(planMasonry([], 1, 1000)).toEqual([])
  })

  it('survives a canvas it has not been able to measure yet', () => {
    expect(planMasonry([IPHONE, DESKTOP], 1, 0)).toHaveLength(1)
    expect(planMasonry([IPHONE, DESKTOP], 1, Number.NaN)).toHaveLength(1)
  })
})

describe('packedWidth', () => {
  it('charges each column its own widest frame, plus the gaps between', () => {
    const columns = [[box('a', 300, 100)], [box('b', 500, 100), box('c', 200, 100)]]
    expect(packedWidth(columns, 1)).toBe(300 + 500 + FRAME_GAP)
  })

  it('is zero for no columns, and gap-free for one', () => {
    expect(packedWidth([], 1)).toBe(0)
    expect(packedWidth([[box('a', 300, 100)]], 1)).toBe(300)
  })
})

describe('packMasonry', () => {
  it('drops each device into whichever column is shortest so far', () => {
    // Column heights after each placement, with a 100-tall and a 300-tall pair:
    // tall → [1], short → [2], short again → [2] is still behind [1].
    const tall = box('tall', 100, 300)
    const shortA = box('short-a', 100, 100)
    const shortB = box('short-b', 100, 100)

    const [first, second] = packMasonry([tall, shortA, shortB], 1, 2)
    expect(first?.map((d) => d.id)).toEqual(['tall'])
    expect(second?.map((d) => d.id)).toEqual(['short-a', 'short-b'])
  })

  it('keeps suite order inside a column', () => {
    const devices = [box('a', 100, 100), box('b', 100, 100), box('c', 100, 100)]
    const [only] = packMasonry(devices, 1, 1)
    expect(only?.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('fills left to right when every device is the same height', () => {
    const devices = [box('a', 100, 100), box('b', 100, 100), box('c', 100, 100)]
    const columns = packMasonry(devices, 1, 2)
    expect(columns.map((column) => column.map((d) => d.id))).toEqual([['a', 'c'], ['b']])
  })

  it('places every device exactly once', () => {
    const devices = [IPHONE, DESKTOP, box('a', 400, 900), box('b', 320, 500)]
    const columns = packMasonry(devices, 1, 3)
    expect(
      columns
        .flat()
        .map((d) => d.id)
        .sort()
    ).toEqual(devices.map((d) => d.id).sort())
  })

  it('returns no empty columns, so no column draws a gap for nothing', () => {
    const columns = packMasonry([IPHONE], 1, 4)
    expect(columns).toHaveLength(1)
  })

  it('survives a nonsense column count rather than dividing by it', () => {
    expect(packMasonry([IPHONE], 1, 0)).toHaveLength(1)
    expect(packMasonry([IPHONE], 1, -3)).toHaveLength(1)
  })

  it('counts the caption in a frame height, because the packing is about pixels', () => {
    expect(frameHeight(box('a', 100, 200), 1)).toBe(200 + FRAME_CAPTION_HEIGHT)
    expect(frameHeight(box('a', 100, 200), 0.5)).toBe(100 + FRAME_CAPTION_HEIGHT)
    expect(FRAME_GAP).toBe(24)
  })
})

describe('fitZoom', () => {
  it('never zooms in: a phone in a monitor-sized canvas stays at 100%', () => {
    expect(fitZoom(IPHONE, { width: 1400, height: 900 })).toBe(1)
  })

  it('picks the largest rung of the ladder the device still fits on', () => {
    // 1440x900 in 800x700 needs 0.555…; 0.5 is the rung below it.
    expect(fitZoom(DESKTOP, { width: 800, height: 700 })).toBe(0.5)
    // 1440x900 in 1100x760 needs 0.763…; 0.75 is the rung below it.
    expect(fitZoom(DESKTOP, { width: 1100, height: 760 })).toBe(0.75)
  })

  it('subtracts the chrome around the frame before it decides', () => {
    const canvas = { width: 1100, height: 760 }
    expect(fitZoom(DESKTOP, canvas)).toBe(0.75)
    // Take 200px of height away and the same device needs a smaller rung.
    expect(fitZoom(DESKTOP, canvas, { height: 200 })).toBe(0.5)
  })

  it('bottoms out at the smallest rung rather than at nothing', () => {
    expect(fitZoom(box('huge', 100_000, 100_000), { width: 400, height: 400 })).toBe(0.25)
  })

  it('answers something usable for a canvas that has no room at all', () => {
    expect(fitZoom(DESKTOP, { width: 0, height: 0 })).toBe(0.25)
    expect(fitZoom(DESKTOP, { width: 100, height: 100 }, { width: 200 })).toBe(0.25)
  })
})
