/**
 * Where the frames go, as arithmetic.
 *
 * The canvas never positions anything absolutely: a frame is an ordinary block
 * whose size is the device's own, and `layout-sync` measures wherever the
 * browser put it. So the only geometry this module owes anyone is the geometry
 * CSS cannot express — how many masonry columns fit, which column each device
 * belongs in, and what zoom makes one device fill the canvas.
 *
 * All of it is pure, because all of it is the part that can be wrong: a packing
 * that overflows the canvas or a fit that disagrees with the zoom ladder is a
 * bug you would otherwise only find by looking at it.
 */

import type { DeviceSpec } from '@shared/types'
import { MIN_ZOOM, ZOOM_STEPS } from '@renderer/stores/layout'

/** `gap-6` between frames, in CSS pixels. Mirrored from the canvas classes. */
export const FRAME_GAP = 24

/** `p-6` around the frames, in CSS pixels. Mirrored from the canvas classes. */
export const CANVAS_PADDING = 24

/**
 * The caption strip above every frame, in CSS pixels.
 *
 * The two-line header is `h-10` plus `gap-1`. This is an estimate rather than
 * a runtime measurement on purpose:
 * it is only ever used to *estimate* how tall a frame will be, and every use is
 * a heuristic — which masonry column is currently shortest, and whether a
 * device fits the canvas. A pixel or two of error changes neither answer, and
 * measuring would put a layout read on a path that has no reason to touch the
 * DOM at all.
 */
export const FRAME_CAPTION_HEIGHT = 44

/** How tall one frame draws at `zoom`, caption included. */
export function frameHeight(device: DeviceSpec, zoom: number): number {
  return FRAME_CAPTION_HEIGHT + device.height * zoom
}

/** How wide one frame draws at `zoom`. */
export function frameWidth(device: DeviceSpec, zoom: number): number {
  return device.width * zoom
}

/**
 * How wide a packing draws: each column as wide as its own widest frame, plus
 * the gaps between them.
 *
 * Columns are *not* all the width of the widest device. A suite is usually a
 * couple of phones and a monitor, and giving the phone column the monitor's
 * width would leave two thirds of the canvas empty to keep an edge nobody is
 * looking for.
 */
export function packedWidth(columns: readonly (readonly DeviceSpec[])[], zoom: number): number {
  if (columns.length === 0) return 0
  const widths = columns.map((column) =>
    Math.max(0, ...column.map((device) => frameWidth(device, zoom)))
  )
  return widths.reduce((total, width) => total + width, 0) + FRAME_GAP * (columns.length - 1)
}

/**
 * The masonry arrangement: as many columns as actually fit, packed by height.
 *
 * The column count is *searched* rather than computed, because there is no
 * formula for it: how wide the arrangement draws depends on which devices
 * landed in which column, and that depends on their heights. So this tries the
 * most columns first and takes the first packing that fits across
 * `contentWidth` — which is exactly the question being asked, instead of a
 * proxy for it.
 *
 * The search is why "one 1440px monitor in the suite" does not collapse the
 * whole canvas to a single column the way a fixed column width would: the
 * monitor's column is wide, the phone column beside it is narrow, and the two
 * together still fit.
 *
 * Falls back to one column when nothing fits — a device wider than the canvas
 * has to overflow *something*, and a single column is the arrangement where it
 * overflows least.
 */
export function planMasonry(
  devices: readonly DeviceSpec[],
  zoom: number,
  contentWidth: number
): DeviceSpec[][] {
  if (devices.length === 0) return []
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return packMasonry(devices, zoom, 1)

  for (let count = devices.length; count > 1; count -= 1) {
    const columns = packMasonry(devices, zoom, count)
    // A packing that emptied a column is the same arrangement as a smaller
    // count, and will be reached again on its own iteration.
    if (columns.length !== count) continue
    if (packedWidth(columns, zoom) <= contentWidth) return columns
  }
  return packMasonry(devices, zoom, 1)
}

/**
 * Deal the devices into `columns` columns, shortest column first.
 *
 * The classic masonry rule, and the reason the mode exists: `flex` starts every
 * row below the tallest frame of the row above it, so a row containing one tall
 * tablet leaves a band of empty canvas beside every phone in it. Dropping each
 * device into whichever column has the least height so far closes those bands
 * without moving a single frame out of suite order *within* its column.
 *
 * Ties go to the leftmost column, so a canvas of identical devices fills left
 * to right and the arrangement is stable rather than merely balanced.
 */
export function packMasonry(
  devices: readonly DeviceSpec[],
  zoom: number,
  columns: number
): DeviceSpec[][] {
  const count = Math.max(1, Math.floor(columns))
  const packed: DeviceSpec[][] = Array.from({ length: count }, () => [])
  const heights = new Array<number>(count).fill(0)

  for (const device of devices) {
    let shortest = 0
    for (let i = 1; i < count; i += 1) {
      if ((heights[i] as number) < (heights[shortest] as number)) shortest = i
    }
    ;(packed[shortest] as DeviceSpec[]).push(device)
    heights[shortest] = (heights[shortest] as number) + frameHeight(device, zoom) + FRAME_GAP
  }

  // A column nobody landed in would still draw its gap.
  return packed.filter((column) => column.length > 0)
}

/**
 * The largest zoom on the ladder at which `device` fits inside `canvas`.
 *
 * Used once, when a device is expanded to fill the canvas: "expand" that leaves
 * the user scrolling to see the bottom of the page has not expanded anything.
 * A rung of the existing ladder rather than a free ratio, so the zoom readout
 * keeps saying a number the zoom buttons can step away from — and so the
 * emulation stays on exactly the same footing it is on in every other mode.
 *
 * Never zooms *in*: a 393px phone in a 1300px canvas is shown at 100%, because
 * a phone blown up to fill a monitor is not what the frame is for.
 */
export function fitZoom(
  device: DeviceSpec,
  canvas: { width: number; height: number },
  chrome: { width?: number; height?: number } = {}
): number {
  const availableWidth = canvas.width - (chrome.width ?? 0)
  const availableHeight = canvas.height - (chrome.height ?? 0)
  if (!(availableWidth > 0) || !(availableHeight > 0)) return MIN_ZOOM
  if (!(device.width > 0) || !(device.height > 0)) return 1

  const ratio = Math.min(availableWidth / device.width, availableHeight / device.height)
  if (!Number.isFinite(ratio) || ratio >= 1) return 1

  // The largest rung that still fits; the bottom rung when nothing does.
  let best = MIN_ZOOM
  for (const step of ZOOM_STEPS) {
    if (step <= ratio + 1e-6) best = step
  }
  return best
}
