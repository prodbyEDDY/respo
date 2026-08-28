import { normalizeUrl, type LoadStatePayload, type ViewRect } from '@shared/ipc'
import type { DeviceSpec, Rect } from '@shared/types'
import { planLayout, WINDOW_ORIGIN } from './layout'

/** How a backend tells the manager what one view's page is doing. */
export type ReportLoadState = (payload: LoadStatePayload) => void

/**
 * The slice of a `WebContentsView` the manager actually drives. Keeping it
 * behind an interface is what lets the layout/lifecycle logic — the part that
 * has to be correct — be unit-tested without booting Electron.
 */
export interface ManagedView {
  setBounds(bounds: Rect): void
  setVisible(visible: boolean): void
  setZoomFactor(zoom: number): void
  /**
   * Put the device's viewport, pixel ratio, touch profile and user agent on the
   * page. The Electron backend does this over CDP; it must land before the
   * first navigation, so the document is fetched with the right user agent.
   */
  applyDevice(device: DeviceSpec): void
  loadUrl(url: string): void
  goBack(): void
  goForward(): void
  reload(): void
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
  /** `report` is how this view's load events reach the manager. */
  create(device: DeviceSpec, report: ReportLoadState): ManagedView
  /** Told whenever the canvas region moves or resizes. */
  setCanvas(viewport: Rect): void
  dispose(): void
}

export type ViewManagerOptions = {
  /**
   * Sink for load events, one payload at a time. Coalescing into a single IPC
   * message is the caller's job (`createLoadStateBatcher`).
   */
  onLoadState?: ReportLoadState
}

type Entry = {
  device: DeviceSpec
  view: ManagedView
  bounds: Rect | null
  /** Native visibility as last set. `null` until the first call. */
  visible: boolean | null
  /** What the newest layout frame wants: on the canvas and not culled. */
  wantVisible: boolean
  /**
   * Latched by a main-frame load failure. A failed view is hidden so the
   * renderer's own error card — which would otherwise be covered by the native
   * view compositing above the window — is what the user sees.
   */
  failed: boolean
  zoom: number | null
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Only the fields emulation depends on; a rename must not reload a view. */
function sameEmulation(a: DeviceSpec, b: DeviceSpec): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.dpr === b.dpr &&
    a.touch === b.touch &&
    a.userAgent === b.userAgent
  )
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
  private readonly onLoadState: ReportLoadState | null
  private readonly entries = new Map<string, Entry>()
  private canvas: Rect | null = null
  private url: string | null = null
  private destroyed = false

  constructor(backend: ViewBackend, options: ViewManagerOptions = {}) {
    this.backend = backend
    this.onLoadState = options.onLoadState ?? null
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
        // Same id, different spec — the catalog entry was edited under us. The
        // *name* counts as a change even though no emulation depends on it: it
        // is what a screenshot's file name is built from, and a device renamed
        // mid-session that kept being photographed under its old name would be
        // a rename that only half happened.
        if (!sameEmulation(existing.device, device) || existing.device.name !== device.name) {
          existing.view.applyDevice(device)
        }
        existing.device = device
        continue
      }

      const view = this.backend.create(device, (payload) => this.reportLoadState(payload))
      this.entries.set(device.id, {
        device,
        view,
        bounds: null,
        visible: null,
        wantVisible: false,
        failed: false,
        zoom: null
      })
      // Emulation before navigation: the user agent a document is fetched with
      // is the one it keeps.
      view.applyDevice(device)
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

      // Zoom before the culling check, unlike bounds: it is not only how big
      // the frame is painted, it is half of the device emulation. A desktop
      // view's metrics override is divided by the zoom (see `metricsOf` in
      // `cdp-controller`), and a scrolled-away view is still a live page — one
      // that "screenshot every device" captures, and one whose viewport must
      // not depend on whether it happened to be on screen.
      if (entry.zoom !== placement.zoom) {
        entry.zoom = placement.zoom
        entry.view.setZoomFactor(placement.zoom)
      }

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
      entry.wantVisible = true
      this.applyVisibility(entry)
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
    for (const entry of this.entries.values()) {
      this.clearFailure(entry)
      entry.view.loadUrl(normalized)
    }
  }

  /** Step every view back one entry in its history. */
  goBack(): void {
    this.eachView((view, entry) => {
      this.clearFailure(entry)
      view.goBack()
    })
  }

  /** Step every view forward one entry in its history. */
  goForward(): void {
    this.eachView((view, entry) => {
      this.clearFailure(entry)
      view.goForward()
    })
  }

  /** Reload every view. Also the way out of an error overlay. */
  reload(): void {
    this.eachView((view, entry) => {
      this.clearFailure(entry)
      view.reload()
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    for (const entry of this.entries.values()) entry.view.dispose()
    this.entries.clear()
    this.backend.dispose()
  }

  private hide(entry: Entry): void {
    entry.wantVisible = false
    this.applyVisibility(entry)
  }

  /**
   * The one place native visibility is decided. Two independent inputs — the
   * layout frame and the failure latch — and a view is only shown when both
   * agree, so neither can be clobbered by the other arriving later.
   */
  private applyVisibility(entry: Entry): void {
    const desired = entry.wantVisible && !entry.failed
    if (entry.visible === desired) return
    entry.visible = desired
    entry.view.setVisible(desired)
  }

  private clearFailure(entry: Entry): void {
    if (!entry.failed) return
    entry.failed = false
    this.applyVisibility(entry)
  }

  private reportLoadState(payload: LoadStatePayload): void {
    if (this.destroyed) return

    const entry = this.entries.get(payload.deviceId)
    if (entry !== undefined) {
      const failed = payload.state === 'failed'
      if (entry.failed !== failed) {
        entry.failed = failed
        this.applyVisibility(entry)
      }
    }

    this.onLoadState?.(payload)
  }

  private eachView(run: (view: ManagedView, entry: Entry) => void): void {
    if (this.destroyed) return
    for (const entry of this.entries.values()) run(entry.view, entry)
  }
}
