/**
 * One DevTools panel per device, and the single dock they share.
 *
 * Respo has many pages open at once, so DevTools cannot be the singleton a
 * browser can afford: the manager keeps a map of device id -> the frontend open
 * for it. Two shapes, deliberately asymmetric:
 *
 * - **docked** (`bottom` / `right`) — the frontend lives in a `WebContentsView`
 *   parented to the main window. The renderer reserves a strip with ordinary
 *   flex layout and reports where it ended up; the canvas shrinks, and every
 *   device frame re-measures on its own. There is exactly one dock, because
 *   there is exactly one strip — opening it for another device retargets it.
 * - **undocked** — the frontend lives in a window of its own. Those are free to
 *   multiply: they cost the canvas nothing, and comparing two devices side by
 *   side is the reason someone would want a second one.
 *
 * Both shapes go through the same Electron call pair, which is the whole point
 * of the design: `setDevToolsWebContents(frontend)` followed by
 * `openDevTools({ mode: 'detach' })`. Respo always supplies the frontend, so
 * Electron never creates a DevTools surface it would then want to position —
 * `detach` here means "Electron is not docking this", not "loose window". A
 * frontend is single-use (Electron requires one that has never navigated), so
 * every open builds a fresh one and every close destroys it.
 *
 * Nothing here touches Electron: `DevtoolsHost` is the slice of `WebContents`
 * the manager drives and `DevtoolsPanel` the slice of the frontend surface, so
 * the part that has to be correct — which panel is open for whom, and what a
 * dock switch does to it — is unit-testable without booting a browser.
 */

import type { DevtoolsStatePayload, DockPosition } from '@shared/ipc'
import type { Rect } from '@shared/types'

/**
 * Opaque stand-in for the frontend's `webContents`.
 *
 * The manager never calls anything on it — it only carries it from the panel to
 * `setDevToolsWebContents`. Typing it as the one field every `WebContents` has
 * is what lets a real one satisfy these interfaces without this module
 * importing Electron.
 */
export type DevtoolsFrontend = { readonly id: number }

/**
 * The slice of a device view's `WebContents` the manager drives.
 *
 * Deliberately no `isDevToolsOpened`: Electron's answers `false` whenever the
 * frontend is one the embedder supplied, because it only reports on a frontend
 * Electron manages itself — and Respo never lets it manage one. This class is
 * the record of what is open.
 */
export interface DevtoolsHost {
  isDestroyed(): boolean
  /**
   * Show DevTools. Always `detach`, because the frontend is always one Respo
   * supplied: the mode only tells the frontend that Electron is not the thing
   * docking it.
   */
  openDevTools(options: { mode: 'detach'; activate?: boolean }): void
  closeDevTools(): void
  /**
   * Show this page's DevTools inside a `WebContents` we own.
   *
   * Electron's contract: the frontend must not have navigated, must not be used
   * for anything else afterwards, and closing DevTools does *not* free it. That
   * is why every open builds a fresh panel instead of moving the one it has.
   */
  setDevToolsWebContents(devToolsWebContents: DevtoolsFrontend): void
  /** Open DevTools if needed and select the element at this point. */
  inspectElement(x: number, y: number): void
}

/** Where a frontend surface lives. */
export type PanelMode = 'docked' | 'window'

/** The DevTools frontend surface main hosts for one device. */
export interface DevtoolsPanel {
  /** Handed to `setDevToolsWebContents`; never called by the manager. */
  readonly frontend: DevtoolsFrontend
  /** Position the docked strip. A window panel ignores it. */
  setBounds(bounds: Rect): void
  /**
   * Bring one of the frontend's own panels to the front — `'console'`, say.
   *
   * Best-effort by nature: this is the embedder API the frontend exposes to
   * whatever is hosting it, not a contract Electron carries. A frontend that
   * does not answer stays on the panel it opened with, which is Elements — a
   * worse answer to "Open Console", not a broken one.
   */
  showPanel(name: string): void
  /**
   * The user closed this panel's own window. A docked panel never calls it —
   * the dock is closed through the manager, not around it.
   */
  onClosed(listener: () => void): void
  /** Take it off the screen and free it. Electron will not do this for us. */
  destroy(): void
}

export type CreateDevtoolsPanel = (options: {
  mode: PanelMode
  deviceId: string
  /** Window title for a `window` panel; ignored by the dock. */
  title: string
}) => DevtoolsPanel

export type DevtoolsManagerOptions = {
  createPanel: CreateDevtoolsPanel
  /** Where a panel opens, as restored from disk. */
  dock?: DockPosition
  /**
   * Told whenever the state changes — including for reasons the renderer could
   * not know about, such as a DevTools window closed from its own title bar or
   * a device leaving the canvas with its panel open.
   */
  onState?: (state: DevtoolsStatePayload) => void
  /** Human name for a device, used to title its own DevTools window. */
  deviceName?: (deviceId: string) => string | undefined
  /**
   * The window's content area, in the same coordinates `setBounds` speaks.
   *
   * The rect the renderer reports is a `getBoundingClientRect` from a page main
   * does not trust: `validateBounds` only keeps it finite and sanely-scaled,
   * because a validator cannot know how big the window is. This can, so it is
   * where a panel is stopped from being placed off-screen or given a size no
   * window could hold. Absent outside Electron, where there is no window.
   */
  contentSize?: () => { width: number; height: number }
}

/**
 * How a view backend tells the manager which pages exist.
 *
 * Deliberately the same shape as `SyncRegistry`: a device view is created in
 * one place, and everything that needs a handle on it registers there.
 */
export interface DevtoolsRegistry {
  registerDevice(deviceId: string, host: DevtoolsHost): void
  unregisterDevice(deviceId: string): void
}

/**
 * What something acting on a device — a context menu, the inspector — asks the
 * manager to do. Separate from the registry for the same reason: one is about
 * a view's lifetime, the other about what the user just chose.
 */
export interface DevtoolsCommands {
  inspectElement(deviceId: string, x: number, y: number): unknown
  openConsole(deviceId: string): unknown
  openFor(deviceId: string): unknown
}

const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 }

/** `value`, held between `low` and `high`. A junk number becomes `low`. */
function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, value))
}

type Entry = { panel: DevtoolsPanel; mode: PanelMode }

function sameState(a: DevtoolsStatePayload, b: DevtoolsStatePayload): boolean {
  return (
    a.dockedDeviceId === b.dockedDeviceId &&
    a.dock === b.dock &&
    a.detachedDeviceIds.length === b.detachedDeviceIds.length &&
    a.detachedDeviceIds.every((id, index) => id === b.detachedDeviceIds[index])
  )
}

export class DevtoolsManager implements DevtoolsRegistry {
  private readonly hosts = new Map<string, DevtoolsHost>()
  /** Insertion-ordered, which is what makes "the newest window" well defined. */
  private readonly open = new Map<string, Entry>()
  private readonly createPanel: CreateDevtoolsPanel
  private readonly onState: ((state: DevtoolsStatePayload) => void) | null
  private readonly deviceName: ((deviceId: string) => string | undefined) | null
  private readonly contentSize: (() => { width: number; height: number }) | null

  private dock: DockPosition
  private dockedDeviceId: string | null = null
  /** Last strip the renderer reported. Zero until it has measured one. */
  private bounds: Rect = ZERO_RECT
  private lastNotified: DevtoolsStatePayload | null = null
  private disposed = false

  constructor(options: DevtoolsManagerOptions) {
    this.createPanel = options.createPanel
    this.dock = options.dock ?? 'bottom'
    this.onState = options.onState ?? null
    this.deviceName = options.deviceName ?? null
    this.contentSize = options.contentSize ?? null
  }

  state(): DevtoolsStatePayload {
    const detachedDeviceIds: string[] = []
    for (const [deviceId, entry] of this.open) {
      if (entry.mode === 'window') detachedDeviceIds.push(deviceId)
    }
    return { dockedDeviceId: this.dockedDeviceId, dock: this.dock, detachedDeviceIds }
  }

  registerDevice(deviceId: string, host: DevtoolsHost): void {
    if (this.disposed) return
    this.hosts.set(deviceId, host)
  }

  unregisterDevice(deviceId: string): void {
    // Shut down *before* forgetting the host: closing DevTools is something
    // only the host can do, and the view is still alive at this point.
    const changed = this.disposed ? false : this.shut(deviceId)
    this.hosts.delete(deviceId)
    if (changed) this.notify()
  }

  /** Drop every device outside `live`. Called after the device set changes. */
  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.hosts.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  /** Whether this device has DevTools open anywhere. */
  isOpen(deviceId: string): boolean {
    return this.open.has(deviceId)
  }

  /** Open (or focus) DevTools for one device, in the current dock mode. */
  openFor(deviceId: string): DevtoolsStatePayload {
    if (this.disposed) return this.state()
    this.show(deviceId, this.dock === 'undocked' ? 'window' : 'docked')
    this.notify()
    return this.state()
  }

  /**
   * Close one device's DevTools, or — for `null` — whatever is in the dock.
   *
   * `null` is what the dock header's close button sends: it is closing the
   * panel it can see, and should not have to name the device to do it.
   */
  close(deviceId: string | null): DevtoolsStatePayload {
    if (this.disposed) return this.state()

    const target = deviceId ?? this.dockedDeviceId
    if (target === null) return this.state()
    if (this.shut(target)) this.notify()
    return this.state()
  }

  /**
   * Move the panel between the docked edges and a window of its own.
   *
   * Switching between `bottom` and `right` keeps the panel exactly as it is:
   * only the renderer's reservation moves, and the new strip arrives as the
   * next `setBounds`. The two crossings in and out of `undocked` are real
   * migrations, and both carry the open device across — a dock switch that
   * closed someone's DevTools would read as a bug, not a preference.
   */
  setDock(dock: DockPosition): DevtoolsStatePayload {
    if (this.disposed || dock === this.dock) return this.state()

    const previous = this.dock
    this.dock = dock

    if (dock === 'undocked') {
      const deviceId = this.dockedDeviceId
      if (deviceId !== null) this.show(deviceId, 'window')
    } else if (previous === 'undocked') {
      // The newest window is the one the user is looking at, so it is the one
      // that comes back into the dock. The rest stay where they are.
      const deviceId = this.state().detachedDeviceIds.at(-1)
      if (deviceId !== undefined) this.show(deviceId, 'docked')
    }

    this.notify()
    return this.state()
  }

  /**
   * Put the docked panel where the renderer reserved room for it.
   *
   * Called at most once per animation frame while the resize handle is being
   * dragged (CLAUDE.md §4). Cheap enough to be called with an unchanged rect.
   */
  setBounds(bounds: Rect): void {
    if (this.disposed) return
    this.bounds = this.clampToWindow(bounds)
    if (this.dockedDeviceId === null) return
    this.open.get(this.dockedDeviceId)?.panel.setBounds(this.bounds)
  }

  /**
   * Keep a reported strip inside the window it is docked in.
   *
   * The rect crosses IPC from the renderer, and `validateBounds` lets anything
   * finite and within ±100 000 through — enough for a compromised renderer to
   * ask for a panel a hundred screens wide, or one placed at a negative origin
   * so it covers the toolbar. The window is the authority on what fits, so the
   * clamp lives here rather than in the validator. Without a window (a unit
   * test, a headless harness) the rect is taken as it came.
   */
  private clampToWindow(bounds: Rect): Rect {
    const size = this.contentSize?.()
    if (size === undefined) return bounds

    const limitX = Math.max(0, size.width)
    const limitY = Math.max(0, size.height)
    const x = clamp(bounds.x, 0, limitX)
    const y = clamp(bounds.y, 0, limitY)
    return {
      x,
      y,
      width: clamp(bounds.width, 0, limitX - x),
      height: clamp(bounds.height, 0, limitY - y)
    }
  }

  /**
   * Open this device's DevTools and select the element at a point.
   *
   * The coordinates are in the space Electron's own `context-menu` params use —
   * see `inspector.ts` for what that means for a point Respo computed itself.
   */
  inspectElement(deviceId: string, x: number, y: number): DevtoolsStatePayload {
    if (this.disposed) return this.state()

    const host = this.hosts.get(deviceId)
    if (host === undefined || host.isDestroyed()) return this.state()

    this.openFor(deviceId)
    host.inspectElement(Math.round(x), Math.round(y))
    return this.state()
  }

  /**
   * Open this device's DevTools with the console showing.
   *
   * The panel request is made every time rather than only on a fresh open: a
   * frontend that is already up is exactly the case where the user is asking
   * for a *different* panel than the one they are looking at.
   */
  openConsole(deviceId: string): DevtoolsStatePayload {
    if (this.disposed) return this.state()

    this.openFor(deviceId)
    this.open.get(deviceId)?.panel.showPanel('console')
    return this.state()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const deviceId of [...this.open.keys()]) this.shut(deviceId)
    this.hosts.clear()
  }

  /**
   * Put this device's DevTools into `mode`, building whatever that needs.
   *
   * The one place a panel is created, and therefore the one place the
   * "at most one dock" rule is enforced.
   */
  private show(deviceId: string, mode: PanelMode): void {
    const host = this.hosts.get(deviceId)
    if (host === undefined || host.isDestroyed()) return

    const existing = this.open.get(deviceId)
    if (existing !== undefined && existing.mode === mode) {
      // Already there. Re-opening is how a window is brought to the front, and
      // a no-op for the dock, which is always in front of nothing.
      if (mode === 'window') host.openDevTools({ mode: 'detach', activate: true })
      return
    }

    // A device is in one place at a time, and only one device is in the dock.
    this.shut(deviceId)
    if (mode === 'docked' && this.dockedDeviceId !== null) this.shut(this.dockedDeviceId)

    const name = this.deviceName?.(deviceId)
    const panel = this.createPanel({
      mode,
      deviceId,
      title: name === undefined || name === '' ? 'DevTools' : `DevTools — ${name}`
    })
    // A window the user closes from its own title bar is a close like any
    // other: the host has to hear about it, and so does the renderer.
    panel.onClosed(() => {
      if (this.disposed) return
      if (this.open.get(deviceId)?.panel !== panel) return
      if (this.shut(deviceId)) this.notify()
    })

    this.open.set(deviceId, { panel, mode })
    if (mode === 'docked') {
      this.dockedDeviceId = deviceId
      panel.setBounds(this.bounds)
    }

    // Order matters: Electron binds the frontend at open time, so the target
    // has to be in place before DevTools is asked to appear.
    host.setDevToolsWebContents(panel.frontend)
    host.openDevTools({ mode: 'detach', activate: mode === 'window' })
  }

  /**
   * Tear down whatever is open for a device. Returns whether anything was.
   *
   * State is cleared *before* Electron is told, so a close event arriving
   * synchronously out of `closeDevTools` finds nothing left to undo.
   */
  private shut(deviceId: string): boolean {
    const entry = this.open.get(deviceId)
    if (entry === undefined) return false

    this.open.delete(deviceId)
    if (this.dockedDeviceId === deviceId) this.dockedDeviceId = null

    const host = this.hosts.get(deviceId)
    // Closing DevTools first, destroying the frontend second: Electron still
    // holds a pointer to it while the session is live.
    if (host !== undefined && !host.isDestroyed()) host.closeDevTools()
    entry.panel.destroy()
    return true
  }

  private notify(): void {
    const state = this.state()
    if (this.lastNotified !== null && sameState(this.lastNotified, state)) return
    this.lastNotified = state
    this.onState?.(state)
  }
}
