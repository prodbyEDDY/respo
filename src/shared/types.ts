/**
 * Domain types shared by main, preload and renderer.
 *
 * IPC channel shapes live in `@shared/ipc`; this module holds the nouns those
 * channels carry.
 */

/**
 * What kind of thing a device is.
 *
 * It decides the default user agent and touch setting when someone builds a
 * device by hand; for catalog entries it is descriptive, and `deviceTypeOf`
 * derives it from the metrics rather than storing it on all 38 of them.
 */
export type DeviceType = 'phone' | 'tablet' | 'desktop'

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
  /** Set on user-defined devices; derived for catalog ones. */
  type?: DeviceType
  /**
   * Whether landscape makes sense for this device. Absent means yes — a
   * desktop monitor is the exception, not the rule.
   */
  rotatable?: boolean
}

/** An axis-aligned rectangle in renderer CSS pixels. */
export type Rect = {
  x: number
  y: number
  width: number
  height: number
}
