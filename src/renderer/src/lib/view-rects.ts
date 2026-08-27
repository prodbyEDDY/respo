import type { ViewRect } from '@shared/ipc'
import type { Rect } from '@shared/types'

/** One frame of measurements: where every device sits and where the canvas is. */
export type LayoutFrame = {
  rects: ViewRect[]
  viewport: Rect
}

/** Placeholder elements the views are glued to, keyed by device id. */
export type FrameElements = ReadonlyMap<string, HTMLElement>

/**
 * Measure every placeholder in one pass.
 *
 * All reads happen back-to-back and nothing writes to the DOM in between, so
 * the browser answers from a single layout instead of thrashing.
 */
export function measureRects(frames: FrameElements, zoom: number): ViewRect[] {
  const rects: ViewRect[] = []

  for (const [deviceId, element] of frames) {
    const box = element.getBoundingClientRect()
    rects.push({
      deviceId,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      zoom
    })
  }

  return rects
}

/** The scroll container's box — the region views are culled against. */
export function measureViewport(container: Element): Rect {
  const box = container.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Whether this frame would tell main anything it does not already know.
 * A `ResizeObserver` fires on plenty of frames where nothing actually moved;
 * those must not turn into IPC.
 */
export function sameLayoutFrame(previous: LayoutFrame | null, next: LayoutFrame): boolean {
  if (previous === null) return false
  if (previous.rects.length !== next.rects.length) return false
  if (!sameRect(previous.viewport, next.viewport)) return false

  for (let i = 0; i < next.rects.length; i += 1) {
    const a = previous.rects[i]
    const b = next.rects[i]
    if (a === undefined || b === undefined) return false
    if (a.deviceId !== b.deviceId || a.zoom !== b.zoom || !sameRect(a, b)) return false
  }

  return true
}
