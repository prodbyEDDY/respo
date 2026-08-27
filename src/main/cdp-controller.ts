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
}

export interface CdpTarget {
  readonly id: number
  readonly debugger: CdpDebugger
  isDestroyed(): boolean
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
}

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
      closing: false
    }
    this.sessions.set(target.id, session)

    // Registered once, before the first attach: Electron keeps the listener on
    // the debugger, and every later re-attach reuses it.
    target.debugger.on('detach', (_event, reason) => this.onDetach(session, reason))
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

    await this.send(target, 'Emulation.setDeviceMetricsOverride', {
      width: Math.round(spec.width),
      height: Math.round(spec.height),
      deviceScaleFactor: spec.dpr,
      mobile: isMobileDevice(spec)
    })

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
}
