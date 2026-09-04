/**
 * Ruler geometry: which ticks to draw, where, and what a pointer on the strip
 * means in the page's own pixels.
 *
 * A ruler measures the *page*, not the frame. Its unit is the device's CSS
 * pixel, its origin is the document's origin (so it slides with the scroll),
 * and the canvas zoom only decides how many screen pixels one of those units
 * takes — which is why a guide dragged to 200 on a 50% canvas lands on the
 * page's 200, and why the ticks get sparser as the canvas zooms out. Pure, so
 * the arithmetic is tested rather than eyeballed.
 */

/** Thickness of a ruler strip, in screen pixels. */
export const RULER_SIZE = 20

/** Steps a labelled tick may use, in CSS pixels. Round numbers people read. */
const STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]

/** Fewest screen pixels between two labels that still read as two labels. */
const MIN_LABEL_SPACING = 56

/** Fewest screen pixels between two minor ticks worth drawing. */
const MIN_MINOR_SPACING = 6

export type Tick = {
  /** Where on the strip, in screen pixels from its start. */
  at: number
  /** The page coordinate this tick marks, in CSS pixels. */
  value: number
  /** Labelled, or one of the small ones between labels. */
  major: boolean
}

export type TickPlan = {
  /** CSS pixels between labelled ticks. */
  step: number
  ticks: Tick[]
}

/**
 * The ticks for one strip.
 *
 * @param length the strip's length in screen pixels (the frame's edge)
 * @param zoom screen pixels per CSS pixel
 * @param offset the page coordinate at the strip's start — the scroll offset
 */
export function planTicks(length: number, zoom: number, offset: number): TickPlan {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const step = STEPS.find((candidate) => candidate * scale >= MIN_LABEL_SPACING) ?? STEPS.at(-1)!
  // Five minors per major when there is room for them, else none.
  const minor = (step / 5) * scale >= MIN_MINOR_SPACING ? step / 5 : step
  const start = Number.isFinite(offset) ? Math.max(0, offset) : 0
  const end = start + length / scale

  const ticks: Tick[] = []
  const first = Math.ceil(start / minor) * minor
  for (let value = first; value <= end + 1e-6; value += minor) {
    const at = (value - start) * scale
    if (at < 0 || at > length) continue
    // Integer arithmetic on the multiplier avoids 0.1 + 0.2 in the labels.
    const major = Math.round(value / minor) % Math.round(step / minor) === 0
    ticks.push({ at: Math.round(at * 2) / 2, value: Math.round(value), major })
  }
  return { step, ticks }
}

/** The page coordinate under a point on the strip. */
export function pageCoordinate(at: number, zoom: number, offset: number): number {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return Math.max(0, Math.round(at / scale + Math.max(0, offset)))
}

/** Where a page coordinate sits on the strip, in screen pixels. */
export function stripPosition(value: number, zoom: number, offset: number): number {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return (value - Math.max(0, offset)) * scale
}

/** How close, in screen pixels, a pointer has to be to grab a guide marker. */
export const GRAB_RADIUS = 5

/**
 * The guide under a point on the strip, if one is within reach — the nearest
 * when two are, so a click between two markers takes the closer one.
 */
export function guideAt(
  at: number,
  guides: readonly number[],
  zoom: number,
  offset: number
): number | null {
  let best: number | null = null
  let bestDistance = GRAB_RADIUS + 1
  guides.forEach((value, index) => {
    const distance = Math.abs(stripPosition(value, zoom, offset) - at)
    if (distance <= GRAB_RADIUS && distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}
