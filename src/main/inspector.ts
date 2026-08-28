/**
 * Click-to-inspect, across every device at once.
 *
 * A browser's inspect mode belongs to one page's DevTools. Respo has a canvas
 * of them, and the useful question is "what is this element, wherever I point
 * at it" — so the toggle is global: every device view is put into Chromium's
 * own element picker (`Overlay.setInspectMode`), and whichever one the user
 * clicks in is the one whose DevTools opens.
 *
 * Everything the user sees while pointing — the blue box, the size and font
 * tooltip — is drawn by the page's own compositor from `Overlay`'s highlight
 * config. Nothing is injected into the page and nothing is drawn over the
 * device view by Respo, which matters because a `WebContentsView` composites
 * above anything the renderer could paint on top of it.
 *
 * ## Getting from the picked node to DevTools
 *
 * `Overlay.inspectNodeRequested` says *which* node (a `backendNodeId`) and not
 * where. The only way to point Electron's DevTools at a node is
 * `webContents.inspectElement(x, y)`, so the id has to become a coordinate
 * again: `CDPController.nodePoint` asks for the node's box and then hit-tests
 * candidate points inside it (`DOM.getNodeForLocation`) until one resolves back
 * to the very node that was picked. In the rare case none does — a node under a
 * fixed overlay, or one that moved between the click and the answer — its
 * centre is used anyway and DevTools opens on whatever is there. That is the
 * documented fallback the brief allows; the `backendNodeId` path proper would
 * need a session inside the DevTools frontend, which Electron does not expose.
 *
 * `inspectElement` takes *widget* pixels — page CSS pixels multiplied by the
 * view's zoom factor, the mirror image of the `Input.dispatchMouseEvent`
 * convention `SyncEngine` deals with (proven in `e2e/inspect.spec.ts`).
 */

import type { CdpTarget, Point } from './cdp-controller'

/** The slice of `CDPController` the inspector drives. */
export interface InspectCdp {
  setInspectMode(target: CdpTarget, enabled: boolean): Promise<boolean>
  onEvent(target: CdpTarget, listener: (method: string, params: unknown) => void): () => void
  nodePoint(target: CdpTarget, backendNodeId: number): Promise<Point | null>
}

/** The slice of `DevtoolsManager` the inspector drives. */
export interface InspectDevtools {
  inspectElement(deviceId: string, x: number, y: number): void
  openFor(deviceId: string): unknown
}

export type InspectDeviceRegistration = {
  deviceId: string
  /** The CDP session behind the view. */
  target: CdpTarget
  /** The canvas zoom this view is shown at, if it is already known. */
  zoom?: number
}

/**
 * How a view backend tells the inspector which pages exist.
 *
 * Deliberately the same shape as `SyncRegistry` and `DevtoolsRegistry`: a view
 * is created in one place, and everything that needs a handle on it registers
 * there.
 */
export interface InspectRegistry {
  registerDevice(registration: InspectDeviceRegistration): void
  /** See `SyncRegistry.setZoom` — a coordinate here depends on it too. */
  setZoom(deviceId: string, zoom: number): void
  /**
   * The view committed a document. Overlay state belongs to the document that
   * was loaded when it was set, so a page that finishes loading while the mode
   * is on has to be put into it again.
   */
  refresh(deviceId: string): void
  unregisterDevice(deviceId: string): void
}

export type InspectorOptions = {
  cdp: InspectCdp
  devtools: InspectDevtools
  /** Told whenever the mode turns itself off — a pick ends it. */
  onState?: (active: boolean) => void
}

type Entry = {
  deviceId: string
  target: CdpTarget
  zoom: number
  /** Unsubscribe from this view's protocol events. */
  off: () => void
}

/** A usable zoom factor; anything else would scale a coordinate into nonsense. */
function normalizeZoom(zoom: number | undefined): number {
  if (zoom === undefined || !Number.isFinite(zoom) || zoom <= 0) return 1
  return zoom
}

/** The `backendNodeId` out of an `Overlay.inspectNodeRequested`, if it has one. */
function backendNodeIdOf(params: unknown): number | null {
  if (typeof params !== 'object' || params === null) return null
  const value = (params as Record<string, unknown>)['backendNodeId']
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return value
}

export class Inspector implements InspectRegistry {
  private readonly devices = new Map<string, Entry>()
  private readonly cdp: InspectCdp
  private readonly devtools: InspectDevtools
  private readonly onState: ((active: boolean) => void) | null

  private active = false
  private disposed = false

  constructor(options: InspectorOptions) {
    this.cdp = options.cdp
    this.devtools = options.devtools
    this.onState = options.onState ?? null
  }

  isActive(): boolean {
    return this.active
  }

  /** Put every view into the picker, or take them all back out. */
  setActive(active: boolean): boolean {
    if (this.disposed) return this.active
    this.arm(active)
    return this.active
  }

  toggle(): boolean {
    return this.setActive(!this.active)
  }

  registerDevice(registration: InspectDeviceRegistration): void {
    if (this.disposed) return

    this.unregisterDevice(registration.deviceId)
    const entry: Entry = {
      deviceId: registration.deviceId,
      target: registration.target,
      zoom: normalizeZoom(registration.zoom),
      off: () => undefined
    }
    entry.off = this.cdp.onEvent(entry.target, (method, params) => {
      if (method !== 'Overlay.inspectNodeRequested') return
      this.picked(entry, params)
    })
    this.devices.set(entry.deviceId, entry)

    // A view that joins a canvas already in inspect mode joins the mode too.
    if (this.active) void this.cdp.setInspectMode(entry.target, true)
  }

  setZoom(deviceId: string, zoom: number): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined) return
    entry.zoom = normalizeZoom(zoom)
  }

  refresh(deviceId: string): void {
    if (!this.active) return
    const entry = this.devices.get(deviceId)
    if (entry === undefined) return
    void this.cdp.setInspectMode(entry.target, true)
  }

  unregisterDevice(deviceId: string): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined) return
    this.devices.delete(deviceId)
    entry.off()
  }

  /** Drop every device outside `live`. Called after the device set changes. */
  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    // Disarmed before the flag goes up: a view left in the picker would swallow
    // the next click in a page that is about to outlive this object.
    this.arm(false)
    this.disposed = true
    for (const deviceId of [...this.devices.keys()]) this.unregisterDevice(deviceId)
  }

  /**
   * The user picked an element in one of the views.
   *
   * The mode ends here, the way it does in a browser: one pick is one question,
   * and leaving every other device armed after it would turn the next ordinary
   * click into a surprise.
   */
  private picked(entry: Entry, params: unknown): void {
    if (this.disposed) return

    const backendNodeId = backendNodeIdOf(params)
    if (this.active) {
      this.arm(false)
      this.onState?.(false)
    }

    if (backendNodeId === null) {
      // Something was picked but not named. Its DevTools is still the answer.
      this.devtools.openFor(entry.deviceId)
      return
    }

    void this.focus(entry, backendNodeId)
  }

  private async focus(entry: Entry, backendNodeId: number): Promise<void> {
    const point = await this.cdp.nodePoint(entry.target, backendNodeId)
    if (this.disposed) return
    if (point === null) {
      this.devtools.openFor(entry.deviceId)
      return
    }

    // Page CSS pixels -> the widget pixels `inspectElement` hit-tests in.
    this.devtools.inspectElement(entry.deviceId, point.x * entry.zoom, point.y * entry.zoom)
  }

  /** Arm or disarm every view. The one place `active` changes. */
  private arm(active: boolean): void {
    if (active === this.active) return
    this.active = active
    for (const entry of this.devices.values()) void this.cdp.setInspectMode(entry.target, active)
  }
}

/** One entry of the device view's context menu. */
export type DeviceMenuItem = {
  label: string
  enabled: boolean
  click: () => void
}

/** What a right click on a device view happened *on*. */
export type DeviceMenuContext = {
  /** Where the click landed, in the view's own pixels — what Electron reports. */
  x: number
  y: number
  /** The url of the page under the cursor, or `''` before it has one. */
  url: string
}

export type DeviceMenuActions = {
  /** Open DevTools on the element at this point (view pixels, as given). */
  inspectElement(x: number, y: number): void
  /** Open DevTools with the console showing. */
  openConsole(): void
  reload(): void
  copyUrl(url: string): void
}

/**
 * The device view's context menu, as data.
 *
 * Built here rather than in `view-backend` so what the menu offers — and when
 * it offers it — is testable without an Electron `Menu`. The backend's only job
 * is to turn this into one.
 *
 * The point comes from Electron's own `context-menu` params, which are already
 * in the space `inspectElement` hit-tests in; unlike the picker's path, nothing
 * has to be converted.
 */
export function deviceMenuTemplate(
  context: DeviceMenuContext,
  actions: DeviceMenuActions
): DeviceMenuItem[] {
  // A view still sitting on its `about:blank` primer has no page to reload and
  // no url worth copying (see `view-backend`'s `isPrimer`).
  const hasPage = context.url !== '' && context.url !== 'about:blank'

  return [
    {
      label: 'Inspect Element',
      enabled: true,
      click: () => actions.inspectElement(context.x, context.y)
    },
    { label: 'Open Console', enabled: true, click: () => actions.openConsole() },
    { label: 'Reload', enabled: hasPage, click: () => actions.reload() },
    { label: 'Copy URL', enabled: hasPage, click: () => actions.copyUrl(context.url) }
  ]
}
