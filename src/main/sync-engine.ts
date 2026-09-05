/**
 * Interaction mirroring across device views (spec §4.2) — the heart of Respo.
 *
 * One view leads: whatever the user does in it is replayed, over CDP, in every
 * other view that has mirroring switched on. The lead's preload has already
 * described the interaction in device-independent terms (fractions of the
 * viewport, fractions of the scrollable distance); this module turns those back
 * into each follower's own pixels.
 *
 * Two rules keep it from feeding on itself:
 *
 * - only the *current lead* is a source. A follower scrolled by CDP fires a
 *   `scroll` event of its own and its preload dutifully reports it; that report
 *   is dropped here, which is what stops the echo.
 * - an event is never applied to the view it came from.
 */

import type { InputEventPayload } from '@shared/ipc'
import type { CdpTarget, KeyInput, MouseInput, SyncDispatcher } from './cdp-controller'

/** One live device view, as the engine needs to know it. */
export type SyncDeviceRegistration = {
  deviceId: string
  /** The CDP session behind the view. `target.id` is its `webContents` id. */
  target: CdpTarget
  /** The emulated viewport, in device CSS pixels — what ratios scale against. */
  width: number
  height: number
  /**
   * Tell this view's preload whether it is currently the input source.
   *
   * Optional, and only ever an optimisation: `handleInput` drops everything
   * that is not the lead regardless, so a backend that supplies nothing here
   * behaves identically — it just pays for one IPC message per follower per
   * frame that main immediately discards.
   */
  setCapturing?: (capturing: boolean) => void
}

/**
 * The lifetime half of the engine, as `view-backend` uses it. Split out so the
 * backend depends on "tell me about views" rather than on the whole engine.
 */
export interface SyncRegistry {
  registerDevice(registration: SyncDeviceRegistration): void
  /** A rotation, or an edited spec: the viewport a normalized coordinate scales against. */
  updateDevice(deviceId: string, device: { width: number; height: number }): void
  unregisterDevice(deviceId: string): void
  /**
   * Re-tell one view whether it is the source.
   *
   * A preload is a *document's* script: it runs again on every navigation, and
   * the fresh copy starts from its own safe default. The backend calls this
   * when a view commits a document so the view is not left reporting input for
   * the rest of the session.
   */
  refreshCapture(deviceId: string): void
}

/** Defer a task by roughly one frame. Returns a canceller. */
export type FrameScheduler = (task: () => void) => () => void

export type SyncEngineOptions = {
  scheduleFrame?: FrameScheduler
  /**
   * Told where a view's document is scrolled to, for every view that reports
   * — the lead, and any device asked to report through `setReporting`. Not a
   * mirroring concern: the rulers follow it. Called at the preload's own
   * rate (one batch per frame per view), never more.
   */
  onScroll?: (deviceId: string, x: number, y: number) => void
}

/** One animation frame at 60Hz. Scrolls are applied at most this often. */
const FRAME_MS = 16

/**
 * Ceiling on remembered mutes. A user can only mute devices they can see; the
 * cap is here so a compromised renderer cannot grow the set without bound by
 * muting ids that never existed.
 */
const MAX_DISABLED = 256

const defaultScheduler: FrameScheduler = (task) => {
  const handle = setTimeout(task, FRAME_MS)
  handle.unref?.()
  return () => {
    clearTimeout(handle)
  }
}

/** CDP's `buttons` bitmask, which is what a page reads as `MouseEvent.buttons`. */
const BUTTON_MASK: Record<'left' | 'middle' | 'right', number> = {
  left: 1,
  right: 2,
  middle: 4
}

/**
 * Windows virtual key codes for the keys that *do* something rather than insert
 * something. Chromium ignores a `keyDown` for these unless it can identify the
 * key, and `text` (the printable path) is exactly what they do not have.
 */
const VIRTUAL_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

type Entry = SyncDeviceRegistration & {
  enabled: boolean
  /**
   * Last capture flag actually delivered, so an unchanged state costs nothing.
   * `null` until the view has been told once.
   */
  capturing: boolean | null
}

export class SyncEngine implements SyncRegistry {
  private readonly dispatcher: SyncDispatcher
  private readonly scheduleFrame: FrameScheduler
  private readonly onScroll: ((deviceId: string, x: number, y: number) => void) | null

  /**
   * Devices asked to keep reporting whether or not they lead — the ones with
   * rulers showing. Their input still mirrors nothing unless they lead; only
   * their scroll offsets are passed on.
   */
  private readonly reporting = new Set<string>()

  private readonly byDeviceId = new Map<string, Entry>()
  /** Reverse index: an input event names its source by `webContents` id. */
  private readonly byWcId = new Map<number, Entry>()

  private leadDeviceId: string | null = null
  private globalEnabled = true

  /**
   * Devices the user muted, whether or not they currently have a view.
   *
   * Kept apart from the registry on purpose: the restored session applies its
   * switches before the first view exists, and a device that leaves a suite and
   * comes back must come back muted. Only the exceptions are held, so the set
   * is empty for the session everybody actually has.
   */
  private readonly disabled = new Set<string>()

  /** Newest scroll target per follower, applied on the next frame. */
  private readonly pendingScroll = new Map<string, { ratioX: number; ratioY: number }>()
  private cancelFrame: (() => void) | null = null

  private disposed = false

  constructor(dispatcher: SyncDispatcher, options: SyncEngineOptions = {}) {
    this.dispatcher = dispatcher
    this.scheduleFrame = options.scheduleFrame ?? defaultScheduler
    this.onScroll = options.onScroll ?? null
  }

  /**
   * Keep one device's preload reporting even while it does not lead.
   *
   * What the rulers need: a follower's scroll offset is not something main
   * can compute (followers are placed by ratio), so the view says where it is
   * — at the same one-batch-per-frame rate the lead already reports at, and
   * only while its rulers are showing.
   */
  setReporting(deviceId: string, reporting: boolean): void {
    if (this.reporting.has(deviceId) === reporting) return
    if (reporting) this.reporting.add(deviceId)
    else this.reporting.delete(deviceId)
    this.publishCapture()
  }

  /** Devices currently registered, in registration order. Test/diagnostic seam. */
  deviceIds(): string[] {
    return [...this.byDeviceId.keys()]
  }

  registerDevice(registration: SyncDeviceRegistration): void {
    if (this.disposed) return
    // A re-registration under the same id is a replacement, so the old
    // `webContents` must not keep answering to it.
    const previous = this.byDeviceId.get(registration.deviceId)
    if (previous !== undefined) this.byWcId.delete(previous.target.id)

    const entry: Entry = {
      ...registration,
      enabled: !this.disabled.has(registration.deviceId),
      capturing: null
    }
    this.byDeviceId.set(entry.deviceId, entry)
    this.byWcId.set(entry.target.id, entry)

    // Something has to lead before the user has hovered anything, or a session
    // opens with mirroring silently inert. The hover election in the UI
    // overrides this the moment the pointer touches a frame — and a muted view
    // is no more a candidate here than it is there.
    if (this.leadDeviceId === null && entry.enabled) this.leadDeviceId = entry.deviceId
    this.publishCapture()
  }

  updateDevice(deviceId: string, device: { width: number; height: number }): void {
    const entry = this.byDeviceId.get(deviceId)
    if (entry === undefined) return
    entry.width = device.width
    entry.height = device.height
  }

  unregisterDevice(deviceId: string): void {
    const entry = this.byDeviceId.get(deviceId)
    if (entry === undefined) return
    this.byDeviceId.delete(deviceId)
    this.byWcId.delete(entry.target.id)
    this.pendingScroll.delete(deviceId)
    this.reporting.delete(deviceId)
    // Losing the lead must not leave the canvas with no source at all: hand it
    // to whoever is still here and still mirroring.
    if (this.leadDeviceId === deviceId) {
      this.leadDeviceId = null
      for (const candidate of this.byDeviceId.values()) {
        if (!candidate.enabled) continue
        this.leadDeviceId = candidate.deviceId
        break
      }
    }
    this.publishCapture()
  }

  /**
   * Re-tell one view whether it is the source. Called by the backend when a
   * view commits a document, because the new document's preload starts fresh.
   */
  refreshCapture(deviceId: string): void {
    const entry = this.byDeviceId.get(deviceId)
    if (entry === undefined) return
    entry.capturing = null
    this.publishCapture()
  }

  /**
   * The one view whose interactions drive the others. `null` disables sync.
   *
   * A muted device is not a candidate: it drives nothing, so electing one would
   * be indistinguishable from switching mirroring off — with a ring drawn on
   * the device that appeared to be in charge.
   */
  setLead(deviceId: string | null): void {
    if (deviceId !== null && this.disabled.has(deviceId)) return
    if (this.leadDeviceId === deviceId) return
    this.leadDeviceId = deviceId
    // Whatever the outgoing lead had queued belongs to the gesture that just
    // ended. Applying it a frame after the election would scroll the followers
    // on behalf of a device that is no longer driving them.
    this.clearPending()
    this.publishCapture()
  }

  /** Which view is currently leading. */
  lead(): string | null {
    return this.leadDeviceId
  }

  /**
   * Take one device in or out of mirroring. A disabled lead drives nothing.
   *
   * Accepted for a device that has no view yet: the restored session sets its
   * switches before the first `WebContentsView` exists.
   */
  setEnabled(deviceId: string, enabled: boolean): void {
    if (this.disabled.has(deviceId) === !enabled) return
    if (enabled) this.disabled.delete(deviceId)
    else if (this.disabled.size < MAX_DISABLED) this.disabled.add(deviceId)
    else return

    const entry = this.byDeviceId.get(deviceId)
    if (entry !== undefined) {
      entry.enabled = enabled
      if (!enabled) this.pendingScroll.delete(deviceId)
    }
    this.publishCapture()
  }

  /** The master switch. Off means no view mirrors anything. */
  setGlobalEnabled(enabled: boolean): void {
    if (this.globalEnabled === enabled) return
    this.globalEnabled = enabled
    if (!enabled) this.clearPending()
    this.publishCapture()
  }

  /**
   * Apply one batch of interactions captured in the view `sourceWcId`.
   *
   * Mouse and key events go out immediately — they happen at human rate and a
   * deferred click feels broken. Scrolls are held for the frame, because they
   * arrive in floods and only the last one is true.
   */
  handleInput(sourceWcId: number, batch: readonly InputEventPayload[]): void {
    if (this.disposed || batch.length === 0) return

    const source = this.byWcId.get(sourceWcId)
    if (source === undefined) return

    // Where the page is, for whoever asked — before any of the mirroring
    // rules, which are about what *drives* the others, not about knowing.
    if (this.onScroll !== null) {
      let last: Extract<InputEventPayload, { kind: 'scroll' }> | null = null
      for (const event of batch) if (event.kind === 'scroll') last = event
      if (last !== null) this.onScroll(source.deviceId, last.x, last.y)
    }

    // Not the lead, or a lead the user muted, or the master switch off: no source.
    if (!this.globalEnabled || !source.enabled) return
    if (source.deviceId !== this.leadDeviceId) return

    for (const event of batch) {
      switch (event.kind) {
        case 'scroll':
          this.queueScroll(source, clamp01(event.ratioX), clamp01(event.ratioY))
          break
        case 'mouse':
          this.applyMouse(source, event)
          break
        case 'key':
          this.applyKey(source, event)
          break
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearPending()
    this.byDeviceId.clear()
    this.byWcId.clear()
    this.disabled.clear()
    this.reporting.clear()
    this.leadDeviceId = null
  }

  /**
   * Tell every view whether it is currently worth reporting input.
   *
   * Exactly one view can be — the enabled lead, and only while the master
   * switch is on. This is what `handleInput` already enforces; saying it out
   * loud just means the other eight views stop sending messages that would be
   * dropped on arrival. Only changes are delivered, and a lead election is a
   * hover, not an event stream, so this is nowhere near the hot path.
   */
  private publishCapture(): void {
    for (const entry of this.byDeviceId.values()) {
      const capturing =
        (this.globalEnabled && entry.enabled && entry.deviceId === this.leadDeviceId) ||
        this.reporting.has(entry.deviceId)
      if (entry.capturing === capturing) continue
      entry.capturing = capturing
      entry.setCapturing?.(capturing)
    }
  }

  private *followers(source: Entry): Generator<Entry> {
    for (const entry of this.byDeviceId.values()) {
      if (entry.deviceId === source.deviceId || !entry.enabled) continue
      yield entry
    }
  }

  private applyMouse(source: Entry, event: Extract<InputEventPayload, { kind: 'mouse' }>): void {
    const xNorm = clamp01(event.xNorm)
    const yNorm = clamp01(event.yNorm)
    const pressed = event.type === 'down'

    for (const entry of this.followers(source)) {
      // The fraction becomes the follower's own device CSS pixels, which is
      // the space `Input.dispatchMouseEvent` reads at any canvas zoom: a
      // desktop view's page zoom is cancelled by its pre-divided override, a
      // mobile view is painted small by the override's `scale`, and Chromium
      // maps a dispatched coordinate through both itself (`metricsOf` in
      // `cdp-controller`, proven at 50% by `e2e/sync.spec.ts`).
      const x = Math.round(xNorm * entry.width)
      const y = Math.round(yNorm * entry.height)

      if (pressed) {
        // Hover state first: menus, tooltips and delegated handlers all key off
        // the cursor having arrived before the button went down.
        this.dispatcher.dispatchMouse(entry.target, {
          type: 'mouseMoved',
          x,
          y,
          button: 'none',
          buttons: 0,
          clickCount: 0
        })
      }

      const mask = BUTTON_MASK[event.button]
      const params: MouseInput = {
        type: pressed ? 'mousePressed' : 'mouseReleased',
        x,
        y,
        button: event.button,
        buttons: pressed ? mask : 0,
        clickCount: 1
      }
      this.dispatcher.dispatchMouse(entry.target, params)
    }
  }

  private applyKey(source: Entry, event: Extract<InputEventPayload, { kind: 'key' }>): void {
    // A single-character `key` *is* the character, and `text` is how Chromium
    // is told to insert it. Named keys ("Enter", "ArrowDown") get a virtual key
    // code instead — without one they arrive as an event nothing acts on.
    const printable = event.key.length === 1
    const virtualKeyCode = VIRTUAL_KEY_CODES[event.code] ?? VIRTUAL_KEY_CODES[event.key]

    const params: KeyInput = {
      type: event.type === 'down' ? 'keyDown' : 'keyUp',
      key: event.key,
      code: event.code,
      modifiers: event.modifiers,
      ...(printable ? { text: event.key } : {}),
      ...(virtualKeyCode === undefined ? {} : { windowsVirtualKeyCode: virtualKeyCode })
    }

    for (const entry of this.followers(source)) {
      this.dispatcher.dispatchKey(entry.target, params)
    }
  }

  /**
   * Remember where each follower should end up, and make sure a frame is armed.
   *
   * Latest-wins per device: a scroll gesture produces events far faster than a
   * frame, and every intermediate position is stale by the time it could be
   * applied. One CDP call per device per frame is the whole budget (spec §8).
   */
  private queueScroll(source: Entry, ratioX: number, ratioY: number): void {
    for (const entry of this.followers(source)) {
      this.pendingScroll.set(entry.deviceId, { ratioX, ratioY })
    }
    if (this.pendingScroll.size === 0 || this.cancelFrame !== null) return
    this.cancelFrame = this.scheduleFrame(() => this.flushScroll())
  }

  private flushScroll(): void {
    this.cancelFrame = null
    if (this.disposed) return

    for (const [deviceId, ratio] of this.pendingScroll) {
      const entry = this.byDeviceId.get(deviceId)
      // Gone or muted between the event and the frame.
      if (entry === undefined || !entry.enabled) continue
      this.dispatcher.scrollToRatio(entry.target, ratio.ratioX, ratio.ratioY)
    }
    this.pendingScroll.clear()
  }

  private clearPending(): void {
    this.pendingScroll.clear()
    this.cancelFrame?.()
    this.cancelFrame = null
  }
}
