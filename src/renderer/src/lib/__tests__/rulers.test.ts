import { describe, expect, it } from 'vitest'
import { guideAt, pageCoordinate, planTicks, stripPosition } from '../rulers'

describe('planTicks', () => {
  it('labels every 100px at 100% zoom, with minors every 20', () => {
    const plan = planTicks(393, 1, 0)
    expect(plan.step).toBe(100)
    const majors = plan.ticks.filter((t) => t.major).map((t) => t.value)
    expect(majors).toEqual([0, 100, 200, 300])
    expect(
      plan.ticks
        .filter((t) => !t.major)
        .map((t) => t.value)
        .slice(0, 4)
    ).toEqual([20, 40, 60, 80])
    // A tick sits where its value is, in screen pixels.
    expect(plan.ticks.find((t) => t.value === 200)?.at).toBe(200)
  })

  it('spreads the labels out as the canvas zooms out', () => {
    const plan = planTicks(720, 0.5, 0)
    expect(plan.step).toBe(200)
    expect(plan.ticks.find((t) => t.value === 200)?.at).toBe(100)
    expect(plan.ticks.filter((t) => t.major).map((t) => t.value)).toEqual([
      0, 200, 400, 600, 800, 1000, 1200, 1400
    ])
  })

  it('packs them tighter as it zooms in', () => {
    expect(planTicks(400, 2, 0).step).toBe(50)
  })

  it('starts counting at the scroll offset', () => {
    const plan = planTicks(393, 1, 250)
    expect(plan.ticks[0]?.value).toBe(260)
    expect(plan.ticks[0]?.at).toBe(10)
    expect(plan.ticks.find((t) => t.value === 300)?.at).toBe(50)
    expect(plan.ticks.every((t) => t.at >= 0 && t.at <= 393)).toBe(true)
  })

  it('treats a junk zoom or offset as 1 and 0', () => {
    expect(planTicks(100, Number.NaN, -5).ticks[0]).toEqual({ at: 0, value: 0, major: true })
  })
})

describe('pageCoordinate / stripPosition', () => {
  it('are inverses of each other at any zoom and offset', () => {
    for (const [zoom, offset] of [
      [1, 0],
      [0.5, 300],
      [2, 17]
    ] as const) {
      const value = pageCoordinate(120, zoom, offset)
      expect(stripPosition(value, zoom, offset)).toBeCloseTo(120, 0)
    }
  })

  it('maps a strip pixel to the page at 50%: 100 on screen is 200 on the page', () => {
    expect(pageCoordinate(100, 0.5, 0)).toBe(200)
    expect(pageCoordinate(100, 0.5, 40)).toBe(240)
  })

  it('never answers a negative page coordinate', () => {
    expect(pageCoordinate(-30, 1, 0)).toBe(0)
  })
})

describe('guideAt', () => {
  const guides = [100, 200, 300]

  it('finds the marker under the pointer, within the grab radius', () => {
    expect(guideAt(203, guides, 1, 0)).toBe(1)
    expect(guideAt(196, guides, 1, 0)).toBe(1)
    expect(guideAt(150, guides, 1, 0)).toBeNull()
  })

  it('takes the nearer of two close markers', () => {
    expect(guideAt(103, [100, 108], 1, 0)).toBe(0)
    expect(guideAt(106, [100, 108], 1, 0)).toBe(1)
  })

  it('reads the markers where the zoom and offset put them', () => {
    // 200 on the page, at 50% zoom, scrolled 100: on the strip at 50.
    expect(guideAt(52, guides, 0.5, 100)).toBe(1)
  })
})
