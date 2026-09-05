/**
 * Debug layers over every page at once — one so far: an outline around
 * every element, the oldest trick for seeing where the boxes are.
 *
 * A stylesheet (`insertCSS`), never a script (CLAUDE.md §3): one rule,
 * `!important`, on every device, put back on every new document while the
 * switch is on and taken off without a trace when it is not. A session
 * mode rather than a setting — a canvas that opened tomorrow full of orange
 * outlines would be a mystery, not a preference.
 */

import type { CssLayer } from './diagnostics'

/** Ember orange at 60%: visible on anything, and the design system's warning accent. */
export const OUTLINE_CSS = '* { outline: 1px solid rgba(255, 62, 0, 0.6) !important; }'

export type DebugDeviceRegistration = { deviceId: string; css: CssLayer }

/** Same registry shape as the other per-view managers. */
export interface DebugRegistry {
  registerDevice(registration: DebugDeviceRegistration): void
  /** The view finished loading a document: put the layers back on it. */
  refresh(deviceId: string): void
  unregisterDevice(deviceId: string): void
}

export type DebugState = { outline: boolean }

type Entry = { deviceId: string; css: CssLayer; key: string | null; chain: Promise<void> }

export class DebugCssManager implements DebugRegistry {
  private readonly devices = new Map<string, Entry>()
  private outline = false
  private disposed = false

  state(): DebugState {
    return { outline: this.outline }
  }

  /** Outline every element on every device, or stop. Idempotent. */
  setOutline(on: boolean): void {
    if (this.disposed || this.outline === on) return
    this.outline = on
    for (const entry of this.devices.values()) void this.apply(entry)
  }

  registerDevice(registration: DebugDeviceRegistration): void {
    if (this.disposed) return
    const entry: Entry = {
      deviceId: registration.deviceId,
      css: registration.css,
      key: null,
      chain: Promise.resolve()
    }
    this.devices.set(entry.deviceId, entry)
    if (this.outline) void this.apply(entry)
  }

  refresh(deviceId: string): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined || this.disposed) return
    // The document that held the layer is gone with the navigation.
    entry.key = null
    if (this.outline) void this.apply(entry)
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId)
  }

  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.devices.clear()
  }

  private apply(entry: Entry): Promise<void> {
    entry.chain = entry.chain.then(() => this.replace(entry)).catch(() => undefined)
    return entry.chain
  }

  private async replace(entry: Entry): Promise<void> {
    if (this.disposed || this.devices.get(entry.deviceId) !== entry) return
    if (entry.key !== null) {
      const key = entry.key
      entry.key = null
      try {
        await entry.css.remove(key)
      } catch {
        // The document that held the layer is gone; so is the layer.
      }
    }
    if (!this.outline) return
    try {
      entry.key = await entry.css.insert(OUTLINE_CSS)
    } catch {
      // A view mid-navigation refuses; `refresh` will try again once it lands.
    }
  }
}
