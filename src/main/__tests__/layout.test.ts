import { describe, expect, it } from 'vitest'
import type { ViewRect } from '@shared/ipc'
import type { Rect } from '@shared/types'
import { planLayout } from '../layout'

const VIEWPORT: Rect = { x: 0, y: 48, width: 1200, height: 800 }

function rect(partial: Partial<ViewRect> & { deviceId: string }): ViewRect {
  return { x: 0, y: 48, width: 390, height: 844, zoom: 1, ...partial }
}

describe('planLayout', () => {
  it('keeps window coordinates when views hang off the window itself', () => {
    const [placement] = planLayout([rect({ deviceId: 'a', x: 100, y: 148 })], VIEWPORT)

    expect(placement?.bounds).toEqual({ x: 100, y: 148, width: 390, height: 844 })
  })

  it('rebases onto a parent origin when views are nested in a layer', () => {
    const [placement] = planLayout([rect({ deviceId: 'a', x: 100, y: 148 })], VIEWPORT, VIEWPORT)

    expect(placement?.bounds).toEqual({ x: 100, y: 100, width: 390, height: 844 })
  })

  it('culls against the viewport, not against the parent origin', () => {
    // Scrolled above the canvas but still inside the window: still culled.
    const [placement] = planLayout([rect({ deviceId: 'a', y: -900 })], VIEWPORT)

    expect(placement?.visible).toBe(false)
  })

  it('rounds to integers without letting edges drift', () => {
    // 10.6 -> 11 and 10.6 + 100.2 = 110.8 -> 111, so width must be 100, not 101.
    const [placement] = planLayout(
      [rect({ deviceId: 'a', x: 10.6, y: 48.4, width: 100.2, height: 50.9 })],
      { x: 0, y: 0, width: 1200, height: 800 }
    )

    expect(placement?.bounds).toEqual({ x: 11, y: 48, width: 100, height: 51 })
    // The right/bottom edges land where the renderer painted them.
    expect((placement?.bounds.x ?? 0) + (placement?.bounds.width ?? 0)).toBe(
      Math.round(10.6 + 100.2)
    )
  })

  it('keeps a view visible while any part of it overlaps the canvas', () => {
    const plan = planLayout(
      [
        rect({ deviceId: 'above', y: 48 - 843 }), // 1px of its bottom edge shows
        rect({ deviceId: 'below', y: 48 + 799 }), // 1px of its top edge shows
        rect({ deviceId: 'inside', y: 100 })
      ],
      VIEWPORT
    )

    expect(plan.map((p) => p.visible)).toEqual([true, true, true])
  })

  it('culls views that are fully outside the canvas viewport', () => {
    const plan = planLayout(
      [
        rect({ deviceId: 'above', y: 48 - 844 }),
        rect({ deviceId: 'below', y: 48 + 800 }),
        rect({ deviceId: 'left', x: -390 }),
        rect({ deviceId: 'right', x: 1200 })
      ],
      VIEWPORT
    )

    expect(plan.map((p) => p.visible)).toEqual([false, false, false, false])
  })

  it('culls degenerate rects instead of asking Electron for negative bounds', () => {
    const plan = planLayout(
      [rect({ deviceId: 'zero', width: 0 }), rect({ deviceId: 'negative', height: -10 })],
      VIEWPORT
    )

    expect(plan.map((p) => p.visible)).toEqual([false, false])
    expect(plan.every((p) => p.bounds.width >= 0 && p.bounds.height >= 0)).toBe(true)
  })

  it('drops non-finite rects rather than propagating NaN into setBounds', () => {
    const plan = planLayout(
      [rect({ deviceId: 'nan', x: Number.NaN }), rect({ deviceId: 'ok', x: 10 })],
      VIEWPORT
    )

    expect(plan.map((p) => p.deviceId)).toEqual(['ok'])
  })

  it('carries a clamped zoom factor through', () => {
    const plan = planLayout(
      [
        rect({ deviceId: 'a', zoom: 0.5 }),
        rect({ deviceId: 'b', zoom: 0 }),
        rect({ deviceId: 'c', zoom: 99 })
      ],
      VIEWPORT
    )

    expect(plan.map((p) => p.zoom)).toEqual([0.5, 0.25, 5])
  })

  it('preserves input order so main applies bounds in one deterministic pass', () => {
    const plan = planLayout(
      [rect({ deviceId: 'c' }), rect({ deviceId: 'a' }), rect({ deviceId: 'b' })],
      VIEWPORT
    )

    expect(plan.map((p) => p.deviceId)).toEqual(['c', 'a', 'b'])
  })
})
