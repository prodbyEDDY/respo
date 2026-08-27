/**
 * Domain types shared by main, preload and renderer.
 *
 * IPC channel shapes live in `@shared/ipc`; this module holds the nouns those
 * channels carry.
 */

/** One emulated device. The catalog that fills these arrives in a later task. */
export type DeviceSpec = {
  id: string
  name: string
  /** Viewport width in device CSS pixels (before canvas zoom). */
  width: number
  /** Viewport height in device CSS pixels (before canvas zoom). */
  height: number
  /** devicePixelRatio to emulate. */
  dpr: number
  userAgent: string
  touch: boolean
}

/** An axis-aligned rectangle in renderer CSS pixels. */
export type Rect = {
  x: number
  y: number
  width: number
  height: number
}
