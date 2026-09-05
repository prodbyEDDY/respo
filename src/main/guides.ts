/**
 * Ruler guides, drawn inside the page (spec §5.7).
 *
 * The rulers themselves are DOM in the renderer, outside the native view —
 * nothing the renderer paints can show over a `WebContentsView`. The *lines*
 * have to be in the page, and they have to scroll with it, so they are a CSS
 * layer: one `html::after` pseudo-element, absolutely positioned at the
 * document's origin, painted with a linear gradient per guide. `insertCSS`
 * is a stylesheet, not a script (CLAUDE.md §3), it survives nothing the page
 * does to its own styles (`!important` throughout), and it is the same
 * mechanism the overflow highlight uses.
 *
 * The one thing CSS cannot know is how tall the document is, and an absolute
 * box taller than the document would *make* the page that tall. So the layer
 * is sized to the document as measured at insertion (`Runtime.evaluate`, one
 * read of two numbers) and measured again whenever the page finishes a load.
 * A page that grows afterwards keeps its guides on the part it had; the next
 * navigation, or the next change to the guides, sizes the layer again.
 */

import type { GuideSet, ScrollStatePayload } from '@shared/ipc'
import type { CdpTarget } from './cdp-controller'
import type { CssLayer } from './diagnostics'

/** The slice of `CDPController` the guides drive. */
export interface GuidesCdp {
  evaluate<T>(target: CdpTarget, expression: string): Promise<T | null>
}

export type GuidesDeviceRegistration = {
  deviceId: string
  target: CdpTarget
  css: CssLayer
}

/** Same registry shape as the other per-view managers. */
export interface GuidesRegistry {
  registerDevice(registration: GuidesDeviceRegistration): void
  /** The view finished loading a document: put its guides back on it. */
  refresh(deviceId: string): void
  unregisterDevice(deviceId: string): void
}

/** The guide colour: the design system's accent, nearly opaque. */
const GUIDE_COLOR = 'rgba(0, 134, 252, 0.9)'
/** How far below the document's own bottom the layer may reach. Never. */
const MEASURE = `(() => { const d = document.documentElement; return d ? { width: d.clientWidth, height: d.scrollHeight, x: window.scrollX, y: window.scrollY } : null })()`

type Measure = { width: number; height: number; x: number; y: number }

function isMeasure(value: unknown): value is Measure {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return ['width', 'height', 'x', 'y'].every((key) => {
    const n = m[key]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000_000
  })
}

/**
 * The stylesheet for one set of guides on a document of one size. Exported
 * for its unit test.
 */
export function guidesCss(guides: GuideSet, size: { width: number; height: number }): string {
  const layers: string[] = []
  for (const x of guides.v) {
    layers.push(
      `linear-gradient(to right, transparent ${x}px, ${GUIDE_COLOR} ${x}px, ${GUIDE_COLOR} ${x + 1}px, transparent ${x + 1}px)`
    )
  }
  for (const y of guides.h) {
    layers.push(
      `linear-gradient(to bottom, transparent ${y}px, ${GUIDE_COLOR} ${y}px, ${GUIDE_COLOR} ${y + 1}px, transparent ${y + 1}px)`
    )
  }
  return (
    `html::after { content: '' !important; position: absolute !important; top: 0 !important; left: 0 !important; ` +
    `width: ${Math.round(size.width)}px !important; height: ${Math.round(size.height)}px !important; ` +
    `pointer-events: none !important; z-index: 2147483647 !important; ` +
    `background-image: ${layers.join(', ')} !important; background-repeat: no-repeat !important; ` +
    `background-size: 100% 100% !important; }`
  )
}

type Entry = {
  deviceId: string
  target: CdpTarget
  css: CssLayer
  guides: GuideSet
  key: string | null
  /** Serialises inserts: a fast drag must not leave two layers behind. */
  chain: Promise<void>
}

export class GuidesManager implements GuidesRegistry {
  private readonly cdp: GuidesCdp
  private readonly devices = new Map<string, Entry>()
  /** Guides sent for a device that has not registered yet (a restart). */
  private readonly pending = new Map<string, GuideSet>()
  private disposed = false

  constructor(options: { cdp: GuidesCdp }) {
    this.cdp = options.cdp
  }

  /** Devices currently registered. Test seam. */
  deviceIds(): string[] {
    return [...this.devices.keys()]
  }

  registerDevice(registration: GuidesDeviceRegistration): void {
    if (this.disposed) return
    const entry: Entry = {
      deviceId: registration.deviceId,
      target: registration.target,
      css: registration.css,
      guides: this.pending.get(registration.deviceId) ?? { h: [], v: [] },
      key: null,
      chain: Promise.resolve()
    }
    this.pending.delete(registration.deviceId)
    this.devices.set(entry.deviceId, entry)
    if (entry.guides.h.length > 0 || entry.guides.v.length > 0) void this.apply(entry)
  }

  /** Put a set of guides on one device's page. Empty removes the layer. */
  set(deviceId: string, guides: GuideSet): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const copy = { h: [...guides.h], v: [...guides.v] }
    const entry = this.devices.get(deviceId)
    if (entry === undefined) {
      this.pending.set(deviceId, copy)
      return Promise.resolve()
    }
    entry.guides = copy
    return this.apply(entry)
  }

  refresh(deviceId: string): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined || this.disposed) return
    // The document that held the layer is gone with the navigation.
    entry.key = null
    if (entry.guides.h.length === 0 && entry.guides.v.length === 0) return
    void this.apply(entry)
  }

  /** Where one device's document is scrolled to right now, or `null`. */
  async scrollOf(deviceId: string): Promise<ScrollStatePayload | null> {
    const entry = this.devices.get(deviceId)
    if (entry === undefined || this.disposed) return null
    const measure = await this.cdp.evaluate<unknown>(entry.target, MEASURE)
    if (!isMeasure(measure)) return null
    return { deviceId, x: measure.x, y: measure.y }
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId)
    this.pending.delete(deviceId)
  }

  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys(), ...this.pending.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.devices.clear()
    this.pending.clear()
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
    const { guides } = entry
    if (guides.h.length === 0 && guides.v.length === 0) return

    const measure = await this.cdp.evaluate<unknown>(entry.target, MEASURE)
    if (!isMeasure(measure)) return
    if (this.disposed || this.devices.get(entry.deviceId) !== entry) return

    try {
      entry.key = await entry.css.insert(guidesCss(guides, measure))
    } catch {
      // A view mid-navigation refuses; `refresh` will try again once it lands.
    }
  }
}
