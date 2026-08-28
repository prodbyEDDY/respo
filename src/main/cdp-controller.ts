import type { ShotDpr, ShotFormat } from '@shared/ipc'
import type { DeviceSpec } from '@shared/types'

/**
 * The slice of Electron's `Debugger` this controller drives.
 *
 * Structural, not `import('electron').Debugger`, so the lifecycle logic — the
 * part that has to be correct — is unit-testable without booting Electron. A
 * real `WebContents` satisfies `CdpTarget`.
 */
export interface CdpDebugger {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, commandParams?: object): Promise<unknown>
  on(event: 'detach', listener: (event: unknown, reason: string) => void): void
  /**
   * Protocol *events* from the page, as opposed to answers to our commands.
   *
   * Only the inspector needs these — `Overlay.inspectNodeRequested` is how
   * Chromium's own element picker reports a click.
   */
  on(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): void
}

export interface CdpTarget {
  readonly id: number
  readonly debugger: CdpDebugger
  isDestroyed(): boolean
}

/** `Input.dispatchMouseEvent` parameters, in the target's own CSS pixels. */
export type MouseInput = {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'
  x: number
  y: number
  button: 'left' | 'middle' | 'right' | 'none'
  /** Bitmask of the buttons held *after* this event (CDP's `buttons`). */
  buttons: number
  clickCount: number
}

/** `Input.dispatchKeyEvent` parameters. */
export type KeyInput = {
  type: 'keyDown' | 'keyUp'
  key: string
  code: string
  modifiers: number
  /** Present only for a printable key — it is what actually inserts a glyph. */
  text?: string
  windowsVirtualKeyCode?: number
}

/**
 * The input side of a CDP session, as `SyncEngine` needs it.
 *
 * Structural for the same reason `CdpDebugger` is: the mirroring logic is
 * unit-tested against a recording double, not a browser.
 */
export interface SyncDispatcher {
  dispatchMouse(target: CdpTarget, params: MouseInput): void
  dispatchKey(target: CdpTarget, params: KeyInput): void
  /** Scroll to a fraction of the document's own scrollable distance. */
  scrollToRatio(target: CdpTarget, ratioX: number, ratioY: number): void
}

/** Chrome DevTools Protocol version. One attach per view, for its whole life. */
const PROTOCOL_VERSION = '1.3'

/**
 * How many times an unexpected detach is answered with a re-attach before the
 * controller gives up. A user opening DevTools on a view detaches us for as
 * long as their session lasts; retrying forever would be a fight, not a fix.
 */
const MAX_REATTACHES = 3

/** Touch points a touch device reports. Chrome's own emulation uses 1..5. */
const MAX_TOUCH_POINTS = 5

type Session = {
  target: CdpTarget
  /** Last device applied, replayed after a re-attach. */
  device: DeviceSpec | null
  attached: boolean
  reattaches: number
  /** Set by `detachSafe`, so our own detach is not mistaken for an eviction. */
  closing: boolean
  /** Told about every protocol event on this session. See `onEvent`. */
  listeners: Set<CdpEventListener>
}

/** A protocol event from a page: the method, and its raw parameters. */
export type CdpEventListener = (method: string, params: unknown) => void

/** A point in a page's own CSS pixels, relative to its viewport. */
export type Point = { x: number; y: number }

/** What one `Page.captureScreenshot` call is being asked for. */
export type CaptureOptions = {
  format: ShotFormat
  /** The whole document rather than what fits in the emulated viewport. */
  fullPage: boolean
  dpr: ShotDpr
}

/**
 * JPEG quality for lossy screenshots. High enough that text stays crisp, low
 * enough that the format is worth choosing at all.
 */
const JPEG_QUALITY = 90

/**
 * Chromium's element-picker colours, in its own `HighlightConfig` shape.
 *
 * The same values DevTools uses for its own inspect mode, so the highlight over
 * a device view looks like the one people already know rather than like a Respo
 * invention.
 */
const HIGHLIGHT_CONFIG = {
  showInfo: true,
  showStyles: false,
  showRulers: false,
  showExtensionLines: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 }
}

/**
 * How far inside a node's own box a candidate point is nudged.
 *
 * Small enough to stay inside a one-pixel divider, large enough to clear an
 * antialiased border.
 */
const INSET = 2

/**
 * Whether the page should believe it is running on a mobile device.
 *
 * CDP's `mobile` flag switches on the mobile viewport model — meta-viewport
 * handling, text autosizing, overlay scrollbars. It is not the same as touch:
 * a Surface Pro is a touch device that renders the desktop layout.
 */
export function isMobileDevice(spec: DeviceSpec): boolean {
  return /iPhone|iPad|iPod|Android/.test(spec.userAgent)
}

/**
 * One device's `Emulation.setDeviceMetricsOverride` parameters.
 *
 * Shared by `applyDevice` and by the screenshot path, which briefly overrides
 * the density and has to put *exactly* this back afterwards — a restore that
 * reconstructed the parameters separately would be a place for the two to
 * drift.
 */
function metricsOf(spec: DeviceSpec): {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
} {
  return {
    width: Math.round(spec.width),
    height: Math.round(spec.height),
    deviceScaleFactor: spec.dpr,
    mobile: isMobileDevice(spec)
  }
}

/**
 * Owns the `webContents.debugger` session behind every device view.
 *
 * One attach per view for its entire lifetime (CLAUDE.md §3): emulation,
 * screenshots and input sync all ride the same session, and nothing is ever
 * injected into the page. Every CDP call is best-effort — a view whose
 * debugger is unavailable (DevTools took it, the view is closing) degrades to
 * an un-emulated viewport instead of taking the app down.
 */
export class CDPController {
  private readonly sessions = new Map<number, Session>()

  /** Ids of the views with a live session. Test/diagnostic seam. */
  attachedIds(): number[] {
    return [...this.sessions.values()].filter((s) => s.attached).map((s) => s.target.id)
  }

  /**
   * Attach to a view, once. Safe to call again: later calls are no-ops while
   * the session is alive.
   */
  async attach(target: CdpTarget): Promise<void> {
    if (target.isDestroyed()) return

    const existing = this.sessions.get(target.id)
    if (existing !== undefined) {
      if (existing.attached) return
      existing.closing = false
      this.open(existing)
      return
    }

    const session: Session = {
      target,
      device: null,
      attached: false,
      reattaches: 0,
      closing: false,
      listeners: new Set()
    }
    this.sessions.set(target.id, session)

    // Registered once, before the first attach: Electron keeps the listener on
    // the debugger, and every later re-attach reuses it.
    target.debugger.on('detach', (_event, reason) => this.onDetach(session, reason))
    target.debugger.on('message', (_event, method, params) => {
      for (const listener of session.listeners) listener(method, params)
    })
    this.open(session)
  }

  /**
   * Put one device's metrics, touch profile and user agent on a view.
   *
   * Two ordering rules, both learned the hard way:
   *
   * - the target must already have committed a navigation. Emulating a view
   *   that has never loaded anything crashes the browser process outright
   *   (`setDeviceMetricsOverride`) or hangs forever (touch, user agent) —
   *   there is no renderer on the other end. `view-backend` primes every new
   *   view with `about:blank` for exactly this reason.
   * - call it before the *real* navigation: the user agent a document was
   *   fetched with is the one it keeps.
   */
  async applyDevice(target: CdpTarget, spec: DeviceSpec): Promise<void> {
    const session = this.sessions.get(target.id)
    if (session !== undefined) session.device = spec
    if (target.isDestroyed() || !(session?.attached ?? false)) return

    await this.send(target, 'Emulation.setDeviceMetricsOverride', metricsOf(spec))

    await this.send(target, 'Emulation.setTouchEmulationEnabled', {
      enabled: spec.touch,
      maxTouchPoints: spec.touch ? MAX_TOUCH_POINTS : 1
    })

    const ua = { userAgent: spec.userAgent }
    // `Network.setUserAgentOverride` is the call DevTools has always used and
    // the one the brief names; the protocol has since moved it to `Emulation`.
    // Try both so neither a new nor an old Chromium leaves a view un-branded.
    if (!(await this.send(target, 'Network.setUserAgentOverride', ua))) {
      await this.send(target, 'Emulation.setUserAgentOverride', ua)
    }
  }

  /**
   * Replay one mouse event on a view.
   *
   * Fire-and-forget: input mirroring runs at interaction rate, and awaiting
   * every dispatch would serialize the followers behind the slowest of them.
   */
  dispatchMouse(target: CdpTarget, params: MouseInput): void {
    if (!this.live(target)) return
    void this.send(target, 'Input.dispatchMouseEvent', params)
  }

  /** Replay one key event on a view. Fire-and-forget, as above. */
  dispatchKey(target: CdpTarget, params: KeyInput): void {
    if (!this.live(target)) return
    void this.send(target, 'Input.dispatchKeyEvent', params)
  }

  /**
   * Put a view at the same *proportion* of its document as the lead.
   *
   * Absolute pixel offsets would be wrong: the same page is taller on a phone
   * than on a desktop, so 800px down is a different place in the content. The
   * ratio is what the two viewports actually have in common (spec §4.2).
   *
   * `Runtime.evaluate` rather than a synthesized wheel: a wheel would animate,
   * land somewhere else, and then be corrected by the next frame's event.
   */
  scrollToRatio(target: CdpTarget, ratioX: number, ratioY: number): void {
    if (!this.live(target)) return
    // The ratios are finite and clamped before they get here; they are
    // interpolated as plain number literals, so nothing page-controlled ever
    // becomes part of this expression.
    const expression =
      `(()=>{const e=document.scrollingElement||document.documentElement;` +
      `if(!e)return;` +
      `const mx=Math.max(0,e.scrollWidth-e.clientWidth),my=Math.max(0,e.scrollHeight-e.clientHeight);` +
      `window.scrollTo(${ratioX}*mx,${ratioY}*my);})()`

    void this.send(target, 'Runtime.evaluate', {
      expression,
      returnByValue: false,
      awaitPromise: false,
      userGesture: false
    })
  }

  /**
   * Listen to protocol events from one view. Returns an unsubscribe.
   *
   * The session is attached once per view for its whole life (CLAUDE.md §3), so
   * this is a subscription on a channel that is already open rather than a
   * reason to open another one.
   */
  onEvent(target: CdpTarget, listener: CdpEventListener): () => void {
    const session = this.sessions.get(target.id)
    if (session === undefined) return () => undefined

    session.listeners.add(listener)
    return () => {
      session.listeners.delete(listener)
    }
  }

  /**
   * Turn Chromium's own element picker on or off for one view.
   *
   * `Overlay.setInspectMode` is refused outright until `DOM` is enabled — the
   * picker answers in node ids, and there is no node id space before that — so
   * all three calls travel together. Enabling a domain twice is a no-op, which
   * is what makes this safe to call on every view every time the mode changes.
   *
   * The highlight is drawn by the page's own compositor, so it lands inside the
   * device's `WebContentsView` with no Respo surface involved and no script in
   * the page.
   */
  async setInspectMode(target: CdpTarget, enabled: boolean): Promise<boolean> {
    if (!this.live(target)) return false

    if (!enabled) {
      // `Overlay.enable` may never have happened on this view (the mode was
      // switched off before it registered); `setInspectMode` alone is enough to
      // clear it, and a failure here means there was nothing to clear.
      return this.send(target, 'Overlay.setInspectMode', { mode: 'none' })
    }

    if (!(await this.send(target, 'DOM.enable', {}))) return false
    if (!(await this.send(target, 'Overlay.enable', {}))) return false
    return this.send(target, 'Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: HIGHLIGHT_CONFIG
    })
  }

  /**
   * A point inside a node, in the page's own CSS pixels.
   *
   * The picker reports *which* node was clicked and not where, but the only way
   * to hand a node to Electron's `inspectElement` is as a coordinate. So the
   * node's box comes back from `DOM.getBoxModel`, and each candidate point is
   * checked against `DOM.getNodeForLocation` — the same hit test the browser
   * runs for `inspectElement` — until one of them resolves to the node we
   * actually want. The centre alone is not enough: a container's centre is
   * usually over one of its children, and inspecting the child instead of the
   * element the user picked is exactly the bug this avoids.
   */
  async nodePoint(target: CdpTarget, backendNodeId: number): Promise<Point | null> {
    if (!this.live(target)) return null

    const box = await this.request<{ model?: { content?: number[] } }>(target, 'DOM.getBoxModel', {
      backendNodeId
    })
    const quad = box?.model?.content
    if (quad === undefined || quad.length < 8) return null

    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < 8; i += 2) {
      const x = quad[i]
      const y = quad[i + 1]
      if (typeof x !== 'number' || typeof y !== 'number') return null
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      xs.push(x)
      ys.push(y)
    }

    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const centre: Point = { x: (left + right) / 2, y: (top + bottom) / 2 }

    // Corners first, centre last: a node's own padding and border are the parts
    // of it a child cannot be drawn over, and they live at the edges.
    const candidates: Point[] = [
      { x: left + INSET, y: top + INSET },
      { x: right - INSET, y: top + INSET },
      { x: left + INSET, y: bottom - INSET },
      { x: right - INSET, y: bottom - INSET },
      centre
    ]

    for (const candidate of candidates) {
      const point = { x: Math.round(candidate.x), y: Math.round(candidate.y) }
      const hit = await this.request<{ backendNodeId?: number }>(target, 'DOM.getNodeForLocation', {
        ...point,
        includeUserAgentShadowDOM: false
      })
      if (hit?.backendNodeId === backendNodeId) return point
    }

    // Nothing hit-tested back to it — a node under a fixed overlay, or one that
    // moved between the click and now. Its centre still opens DevTools
    // somewhere sensible, which beats not opening it at all.
    return { x: Math.round(centre.x), y: Math.round(centre.y) }
  }

  /**
   * Screenshot one view, over the same CDP session everything else rides.
   *
   * `Page.captureScreenshot` rather than `webContents.capturePage()`, and the
   * difference is not stylistic: `capturePage` grabs the *widget*, so it comes
   * back at the canvas zoom (a 1440px desktop shot at 50% is a 720px image) and
   * at the screen's density rather than the device's. The protocol renders the
   * emulated viewport, which is the thing the user is actually looking at a
   * picture of — and screenshots are CDP-first by rule (CLAUDE.md §3).
   *
   * Two knobs, both of which have to be put back:
   *
   * - `captureBeyondViewport` renders the whole scrollable document. Chromium
   *   resizes the frame to do it and restores itself afterwards, but the
   *   emulation override is re-applied anyway — an override that silently
   *   changed under a screenshot would be a canvas of wrong viewports.
   * - `dpr: 1` is a temporary `deviceScaleFactor` override. The device spec
   *   stays the source of truth: the restore runs in a `finally`, so a capture
   *   that throws still leaves the view emulating its own device.
   *
   * `null` means "no image": a torn-down view, a debugger that is not ours, a
   * page that refused. The queue turns that into one failed job, not a dead
   * batch.
   */
  async capture(target: CdpTarget, options: CaptureOptions): Promise<Buffer | null> {
    if (!this.live(target)) return null

    const spec = this.sessions.get(target.id)?.device ?? null
    // Nothing to override when the device is already at 1×, and nothing to
    // restore when we never learned what this view emulates.
    const override = options.dpr === 1 && spec !== null && spec.dpr !== 1

    try {
      if (override && spec !== null) {
        await this.send(target, 'Emulation.setDeviceMetricsOverride', {
          ...metricsOf(spec),
          deviceScaleFactor: 1
        })
      }

      const answer = await this.request<{ data?: unknown }>(target, 'Page.captureScreenshot', {
        format: options.format,
        captureBeyondViewport: options.fullPage,
        fromSurface: true,
        ...(options.format === 'jpeg' ? { quality: JPEG_QUALITY } : {})
      })

      const data = answer?.data
      if (typeof data !== 'string' || data === '') return null
      return Buffer.from(data, 'base64')
    } finally {
      // Restored after a full-page capture too: it is the call that resized the
      // frame, and re-stating an unchanged override is a no-op in Chromium.
      if ((override || options.fullPage) && spec !== null && this.live(target)) {
        await this.send(target, 'Emulation.setDeviceMetricsOverride', metricsOf(spec))
      }
    }
  }

  /** Detach on purpose (view going away). Never throws, never re-attaches. */
  detachSafe(target: CdpTarget): void {
    const session = this.sessions.get(target.id)
    this.sessions.delete(target.id)
    if (session === undefined) return

    session.closing = true
    session.attached = false
    if (target.isDestroyed()) return

    try {
      if (target.debugger.isAttached()) target.debugger.detach()
    } catch {
      // The target was already gone; nothing to release.
    }
  }

  /** Detach from every view. Used when the window tears down. */
  detachAll(): void {
    for (const session of [...this.sessions.values()]) this.detachSafe(session.target)
  }

  private open(session: Session): void {
    const { target } = session
    try {
      if (!target.debugger.isAttached()) target.debugger.attach(PROTOCOL_VERSION)
      session.attached = true
    } catch (error) {
      // Something else (DevTools, another extension) holds the session. The
      // view still works — it just renders un-emulated.
      session.attached = false
      console.error(`cdp: could not attach to view ${target.id}`, error)
    }
  }

  private onDetach(session: Session, reason: string): void {
    session.attached = false
    if (session.closing || session.target.isDestroyed()) return
    if (reason === 'target closed') return
    if (session.reattaches >= MAX_REATTACHES) {
      console.error(`cdp: giving up on view ${session.target.id} after "${reason}"`)
      return
    }

    session.reattaches += 1
    this.open(session)
    if (!session.attached) return

    // The emulation lives in the session that just died; put it back.
    const device = session.device
    if (device !== null) void this.applyDevice(session.target, device)
  }

  /**
   * Whether a command is worth sending at all. Input mirroring runs at
   * interaction rate, and a view torn down mid-gesture would otherwise turn
   * every remaining event into a logged failure.
   */
  private live(target: CdpTarget): boolean {
    if (target.isDestroyed()) return false
    return this.sessions.get(target.id)?.attached ?? false
  }

  /** Best-effort CDP call: reports failure instead of propagating it. */
  private async send(target: CdpTarget, method: string, params: object): Promise<boolean> {
    try {
      await target.debugger.sendCommand(method, params)
      return true
    } catch (error) {
      console.error(`cdp: ${method} failed on view ${target.id}`, error)
      return false
    }
  }

  /** `send`, for the calls whose answer is the point of making them. */
  private async request<T>(target: CdpTarget, method: string, params: object): Promise<T | null> {
    try {
      return (await target.debugger.sendCommand(method, params)) as T
    } catch (error) {
      console.error(`cdp: ${method} failed on view ${target.id}`, error)
      return null
    }
  }
}
