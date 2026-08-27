import { describe, expect, it } from 'vitest'
import { measureRects, measureViewport, sameLayoutFrame, type LayoutFrame } from '../view-rects'

function elementAt(x: number, y: number, width: number, height: number): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }) as DOMRect
  return element
}

describe('measureRects', () => {
  it('reads window coordinates straight off the placeholder frames', () => {
    const frames = new Map([
      ['iphone', elementAt(24, 96, 390, 844)],
      ['pixel', elementAt(438, 96, 412, 915)]
    ])

    expect(measureRects(frames, 1)).toEqual([
      { deviceId: 'iphone', x: 24, y: 96, width: 390, height: 844, zoom: 1 },
      { deviceId: 'pixel', x: 438, y: 96, width: 412, height: 915, zoom: 1 }
    ])
  })

  it('keeps sub-pixel positions so main can decide how to round them', () => {
    const frames = new Map([['a', elementAt(24.5, 96.25, 390, 844)]])

    expect(measureRects(frames, 1)[0]).toMatchObject({ x: 24.5, y: 96.25 })
  })

  it('stamps every rect with the current canvas zoom', () => {
    const frames = new Map([['a', elementAt(0, 0, 195, 422)]])

    expect(measureRects(frames, 0.5)[0]?.zoom).toBe(0.5)
  })
})

describe('measureViewport', () => {
  it('reports the canvas region in window coordinates', () => {
    expect(measureViewport(elementAt(0, 48, 1200, 800))).toEqual({
      x: 0,
      y: 48,
      width: 1200,
      height: 800
    })
  })
})

describe('sameLayoutFrame', () => {
  const viewport = { x: 0, y: 48, width: 1200, height: 800 }
  const base: LayoutFrame = {
    rects: [{ deviceId: 'a', x: 0, y: 48, width: 390, height: 844, zoom: 1 }],
    viewport
  }

  it('treats a never-sent layout as changed', () => {
    expect(sameLayoutFrame(null, base)).toBe(false)
  })

  it('suppresses a frame that is byte-for-byte the previous one', () => {
    expect(
      sameLayoutFrame(base, { rects: [{ ...base.rects[0]! }], viewport: { ...viewport } })
    ).toBe(true)
  })

  it('detects a scroll of a single pixel', () => {
    const moved = { rects: [{ ...base.rects[0]!, y: 47 }], viewport }
    expect(sameLayoutFrame(base, moved)).toBe(false)
  })

  it('detects a zoom change', () => {
    const zoomed = { rects: [{ ...base.rects[0]!, zoom: 0.5 }], viewport }
    expect(sameLayoutFrame(base, zoomed)).toBe(false)
  })

  it('detects a device joining or leaving', () => {
    const more = { rects: [...base.rects, { ...base.rects[0]!, deviceId: 'b' }], viewport }
    expect(sameLayoutFrame(base, more)).toBe(false)
  })

  it('detects the canvas itself resizing', () => {
    expect(
      sameLayoutFrame(base, { rects: base.rects, viewport: { ...viewport, height: 700 } })
    ).toBe(false)
  })
})
