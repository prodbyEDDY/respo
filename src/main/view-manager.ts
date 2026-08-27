import { normalizeUrl, type ViewRect } from '@shared/ipc'
import type { DeviceSpec, Rect } from '@shared/types'
import { planLayout, WINDOW_ORIGIN } from './layout'

/**
 * The slice of a `WebContentsView` the manager actually drives. Keeping it
 * behind an interface is what lets the layout/lifecycle logic — the part that
 * has to be correct — be unit-tested without booting Electron.
 */
export interface ManagedView {
  setBounds(bounds: Rect): void
  setVisible(visible: boolean): void
  setZoomFactor(zoom: number): void
  loadUrl(url: string): void
  dispose(): void
}

/** Owns the native surface the views are parented to. */
export interface ViewBackend {
  /**
   * `true` when views are children of a canvas layer, so their bounds are
   * relative to the canvas viewport. `false` when they hang off the window's
   * `contentView` and bounds are window coordinates.
   */
  readonly clipsToCanvas: boolean
  create(device: DeviceSpec): ManagedView
  /** Told whenever the canvas region moves or resizes. */
  setCanvas(viewport: Rect): void
  dispose(): void
}

type Entry = {
  device: DeviceSpec
  view: ManagedView
  bounds: Rect | null
  visible: boolean | null
  zoom: number | null
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Creates, positions and tears down one `WebContentsView` per device.
 *
 * `applyLayout` is the hot path (once per animation frame, spec §8): it walks
 * the plan in a single synchronous pass and issues only the native calls that
 * change something, so a still canvas costs nothing and a scrolling one costs
 * exactly one `setBounds` per on-screen device.
 */
export class ViewManager {
  private readonly backend: ViewBackend
  private readonly entries = new Map<string, Entry>()
  private canvas: Rect | null = null
  private url: string | null = null
  private destroyed = false

  constructor(backend: ViewBackend) {
    this.backend = backend
  }

  /** Device ids currently backed by a view, in creation order. */
  deviceIds(): string[] {
    return [...this.entries.keys()]
  }

  /** Bring the set of live views in line with `devices`; reuses what it can. */
  syncDevices(devices: readonly DeviceSpec[]): void {
    if (this.destroyed) return

    const wanted = new Set(devices.map((d) => d.id))
    for (const [id, entry] of this.entries) {
      if (wanted.has(id)) continue
      entry.view.dispose()
      this.entries.delete(id)
    }

    for (const device of devices) {
      const existing = this.entries.get(device.id)
      if (existing !== undefined) {
        existing.device = device
        continue
      }

      const view = this.backend.create(device)
      this.entries.set(device.id, { device, view, bounds: null, visible: null, zoom: null })
      // A device that joins mid-session catches up with everyone else.
      if (this.url !== null) view.loadUrl(this.url)
    }
  }

  /**
   * Apply one frame of renderer measurements. Called at most once per animation
   * frame; must stay synchronous so every view moves within the same frame.
   */
  applyLayout(rects: readonly ViewRect[], viewport: Rect): void {
    if (this.destroyed) return

    if (!sameRect(this.canvas, viewport)) {
      this.canvas = { ...viewport }
      this.backend.setCanvas(this.canvas)
    }

    const origin = this.backend.clipsToCanvas ? viewport : WINDOW_ORIGIN
    const seen = new Set<string>()

    for (const placement of planLayout(rects, viewport, origin)) {
      const entry = this.entries.get(placement.deviceId)
      if (entry === undefined) continue
      seen.add(placement.deviceId)

      if (!placement.visible) {
        // Offscreen: hide and leave the stale bounds alone. Chromium stops
        // producing frames for a hidden view (spec §8, virtualization).
        this.hide(entry)
        continue
      }

      if (!sameRect(entry.bounds, placement.bounds)) {
        entry.bounds = placement.bounds
        entry.view.setBounds(placement.bounds)
      }
      if (entry.zoom !== placement.zoom) {
        entry.zoom = placement.zoom
        entry.view.setZoomFactor(placement.zoom)
      }
      if (entry.visible !== true) {
        entry.visible = true
        entry.view.setVisible(true)
      }
    }

    // Devices the renderer did not report this frame are not on the canvas.
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) this.hide(entry)
    }
  }

  /** Load one url into every view. Throws when the url is not loadable. */
  navigateAll(url: string): void {
    if (this.destroyed) return

    const normalized = normalizeUrl(url)
    if (normalized === null) throw new Error(`Refusing to load url: ${url}`)

    this.url = normalized
    for (const entry of this.entries.values()) entry.view.loadUrl(normalized)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    for (const entry of this.entries.values()) entry.view.dispose()
    this.entries.clear()
    this.backend.dispose()
  }

  private hide(entry: Entry): void {
    if (entry.visible === false) return
    entry.visible = false
    entry.view.setVisible(false)
  }
}
