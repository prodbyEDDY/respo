import type { ViewRect } from '@shared/ipc'
import type { Rect } from '@shared/types'

/** What main is about to hand one `WebContentsView`, ready to apply verbatim. */
export type ViewPlacement = {
  deviceId: string
  /** Integer bounds relative to the canvas layer's origin. */
  bounds: Rect
  /** `false` when the frame lies entirely outside the canvas viewport. */
  visible: boolean
  /** `webContents.setZoomFactor` argument. */
  zoom: number
}

/** Matches the canvas zoom stops in spec §5.1 (25%–200%), with headroom. */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 5

function isFinitePlacement(rect: ViewRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  )
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Round a CSS-pixel edge pair to integers. Rounding the far edge rather than
 * the size keeps a column of frames aligned: neighbours that shared an edge
 * before rounding still share it after.
 */
function snap(start: number, size: number): { start: number; size: number } {
  const from = Math.round(start)
  const to = Math.round(start + size)
  return { start: from, size: Math.max(0, to - from) }
}

function overlaps(rect: ViewRect, viewport: Rect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  return (
    rect.x < viewport.x + viewport.width &&
    rect.x + rect.width > viewport.x &&
    rect.y < viewport.y + viewport.height &&
    rect.y + rect.height > viewport.y
  )
}

/** Window content origin — bounds of a view parented straight to `contentView`. */
export const WINDOW_ORIGIN = { x: 0, y: 0 } as const

/**
 * Turn the renderer's measurements into the exact arguments for one synchronous
 * `setBounds`/`setVisible` pass.
 *
 * `viewport` is the canvas region in window CSS pixels — frames outside it are
 * culled. `origin` is whatever the views' parent puts at (0, 0); they differ as
 * soon as views are nested in a canvas layer instead of the window itself.
 *
 * Pure by design: this is the part of the hot path that has to be right, so it
 * is unit-tested rather than eyeballed in a running app. Input order is the
 * apply order.
 */
export function planLayout(
  rects: readonly ViewRect[],
  viewport: Rect,
  origin: { x: number; y: number } = WINDOW_ORIGIN
): ViewPlacement[] {
  const plan: ViewPlacement[] = []

  for (const rect of rects) {
    if (!isFinitePlacement(rect)) continue

    const horizontal = snap(rect.x - origin.x, rect.width)
    const vertical = snap(rect.y - origin.y, rect.height)

    plan.push({
      deviceId: rect.deviceId,
      bounds: {
        x: horizontal.start,
        y: vertical.start,
        width: horizontal.size,
        height: vertical.size
      },
      visible: overlaps(rect, viewport),
      zoom: clampZoom(rect.zoom)
    })
  }

  return plan
}
