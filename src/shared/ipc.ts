/**
 * The single source of truth for every IPC channel in Respo.
 *
 * Rules (CLAUDE.md §6): no channel exists outside this module, main validates
 * everything it receives, and there is no per-event traffic — main -> renderer
 * updates travel batched over the one `MAIN_EVENT_CHANNEL`.
 */

import type { RespoBackupV1 } from './backup'
import type { PersistedState } from './persistence-types'
import type { DeviceSpec, Rect } from './types'

/**
 * Placement of one device view on the canvas, in renderer CSS pixels relative
 * to the window's content area (i.e. straight out of `getBoundingClientRect`).
 *
 * `width`/`height` are the *on-screen* size — the device viewport already
 * multiplied by `zoom`. Main restores the logical viewport with
 * `webContents.setZoomFactor(zoom)`.
 */
export type ViewRect = {
  deviceId: string
  x: number
  y: number
  width: number
  height: number
  zoom: number
}

/** Mirrors Electron's `nativeTheme.themeSource`. */
export type ThemeSource = 'light' | 'dark' | 'system'

/**
 * Where a device's DevTools opens.
 *
 * `bottom` and `right` are the *docked* modes: main hosts the DevTools frontend
 * in a `WebContentsView` of its own and the renderer reserves the strip it sits
 * in, so the canvas simply gets smaller and every frame re-measures. `undocked`
 * is Electron's own detached window — many of those may be open at once, while
 * there is only ever one dock.
 */
export type DockPosition = 'bottom' | 'right' | 'undocked'

/**
 * Everything the renderer needs to draw the DevTools chrome.
 *
 * Main is the authority: it is the side that knows a detached window was closed
 * from its own title bar, or that a device left the canvas with its panel open.
 * The renderer never guesses — every mutation answers with this, and main pushes
 * it whenever something changes without being asked.
 */
export type DevtoolsStatePayload = {
  /** The device filling the dock, or `null` when the dock is closed. */
  dockedDeviceId: string | null
  /** Where a panel opens. Persisted; survives a restart. */
  dock: DockPosition
  /** Devices with a detached DevTools window open, in the order they opened. */
  detachedDeviceIds: string[]
}

/**
 * Image encoding for a screenshot. The two `Page.captureScreenshot` speaks, and
 * the only two worth offering: one lossless, one small.
 */
export type ShotFormat = 'png' | 'jpeg'

/**
 * The pixel density a screenshot is taken at.
 *
 * `device` is the honest answer — an iPhone shot comes out at 3× like the phone
 * itself — and `1` is the practical one: a CSS-pixel-for-pixel image, for a bug
 * report or a design review where a 1179px-wide "393px viewport" is a nuisance.
 */
export type ShotDpr = 'device' | 1

/**
 * What one screenshot gesture asks for.
 *
 * `format` and `dpr` are optional because the settings dialog is where they
 * normally live: main fills them in from the saved document, so the common call
 * is `{ fullPage: false }` and nothing has to restate a preference.
 */
export type ShotRequest = {
  /** The whole document rather than the emulated viewport. */
  fullPage: boolean
  format?: ShotFormat
  dpr?: ShotDpr
}

/** Where one screenshot job is in its life. */
export type ShotState = 'queued' | 'active' | 'done' | 'failed'

/**
 * One screenshot job, as the renderer hears about it.
 *
 * `batchId`/`batchSize` are what make "3 of 5 saved" expressible without the
 * renderer tracking anything: every job of one gesture carries the same batch
 * id and the size it started at, so counting the terminal states of a batch is
 * a fold over the events it has already been given.
 */
export type ShotStatePayload = {
  id: string
  batchId: string
  batchSize: number
  deviceId: string
  /** The device's name as it was when the shot was taken. For the toast. */
  deviceName: string
  state: ShotState
  /** Where the file landed. Present on `done` only. */
  path?: string
  /** Why it did not. Present on `failed` only. */
  error?: string
}

/** What `shot:device` / `shot:all` answer with: the batch they just started. */
export type ShotStartResult = {
  batchId: string
  /** Jobs actually queued. Zero means there was nothing on the canvas. */
  queued: number
}

/**
 * One row of the address bar's suggestion list.
 *
 * Built in main, where the history lives: the renderer asks for the few entries
 * that match what is being typed rather than holding a copy of two thousand of
 * them (`history:query`).
 */
export type HistorySuggestion = {
  url: string
  /** The page's own `<title>` as it was when it was visited. May be empty. */
  title: string
  /** When it was last visited, in epoch milliseconds. */
  ts: number
  /**
   * The site's own icon as a `data:` url, when one was captured.
   *
   * A `data:` url and not a remote one: rendering `<img src="https://…">` in
   * the toolbar would be Respo fetching a third-party asset from the *chrome*,
   * outside the device session and outside anything the user asked for. Main
   * downloads it once through the device session and caches it by origin.
   */
  favicon?: string
}

/** What one "Clear…" gesture asks to be forgotten. */
export type ClearTarget = 'storage' | 'cookies' | 'cache' | 'all'

/**
 * The answer to a clear.
 *
 * `no-origin` is not a failure so much as a question that has no subject: a
 * blank canvas, or a `file://` page, has no site whose storage could be cleared.
 * The cache is the exception — it is the session's, not an origin's.
 */
export type ClearResult =
  | { ok: true; target: ClearTarget; origin: string | null }
  | { ok: false; reason: 'no-origin' }
  | { ok: false; reason: 'failed'; message: string }

export type LoadState = 'loading' | 'ready' | 'failed'

export type LoadStatePayload = {
  deviceId: string
  state: LoadState
  url: string
  title?: string
  errorCode?: number
  errorDesc?: string
  /**
   * This view's own history, as of this event.
   *
   * Optional because they are a late addition and a payload without them is
   * still a valid one — a renderer that has not heard from a device yet simply
   * assumes it cannot go anywhere. Back and forward act on every view at once
   * (there is one page across many viewports), so the toolbar enables a button
   * when *any* device could take that step.
   */
  canGoBack?: boolean
  canGoForward?: boolean
}

/**
 * Batched main -> renderer notification. One `load-state` message carries many
 * devices; the DevTools and inspect messages carry one whole state each and are
 * only sent when something main knows about — and the renderer does not —
 * actually changed.
 */
export type MainEvent =
  | { type: 'load-state'; payload: LoadStatePayload[] }
  | { type: 'devtools-state'; payload: DevtoolsStatePayload }
  | { type: 'inspect-mode'; payload: { active: boolean } }
  /**
   * Screenshot progress, coalesced the same way `load-state` is: five devices
   * moving through queued -> active -> done is one message per turn, keyed by
   * job, not fifteen (CLAUDE.md §4).
   */
  | { type: 'shot-state'; payload: ShotStatePayload[] }

/**
 * One interaction captured in a device view, in device-independent terms.
 *
 * Everything is normalized at the source so a 393px phone and a 1920px desktop
 * can be described by the same numbers: positions are fractions of the
 * viewport, scroll is a fraction of the scrollable distance. Nothing about the
 * *page* travels with it — no text, no urls, no element identity. These
 * payloads originate in pages Respo does not control, so the less they can
 * carry, the less there is to abuse.
 */
export type InputEventPayload =
  | { kind: 'scroll'; ratioX: number; ratioY: number }
  | {
      kind: 'mouse'
      type: 'down' | 'up'
      xNorm: number
      yNorm: number
      button: 'left' | 'middle' | 'right'
    }
  | { kind: 'key'; type: 'down' | 'up'; key: string; code: string; modifiers: number }

/**
 * device view -> main input stream. One-way (`ipcRenderer.send`) and therefore
 * outside the invoke map, like `MAIN_EVENT_CHANNEL` — but still declared here,
 * because no channel exists outside this module (CLAUDE.md §6).
 *
 * A message is always a *batch*: the device preload coalesces to one send per
 * animation frame (CLAUDE.md §4).
 */
export const SYNC_INPUT_CHANNEL = 'sync:input'

/**
 * The channel's literal type. The device-view preload has to restate the string
 * rather than import it — a sandboxed preload cannot load a shared bundle chunk
 * — so it annotates its own copy with this and a rename here fails the build
 * there instead of silently muting input sync.
 */
export type SyncInputChannel = typeof SYNC_INPUT_CHANNEL

/**
 * main -> device view: "you are (not) the input source right now".
 *
 * Purely an optimisation, and a safe-by-default one. Main already drops input
 * from anything that is not the lead — that is what stops a follower scrolled
 * by CDP from echoing back — so a view that never hears this message keeps
 * reporting and stays correct. Hearing it lets nine followers stop spending an
 * IPC message per frame each on input main would only throw away.
 *
 * Sent once per lead/enablement change, never per event (CLAUDE.md §4).
 */
export const SYNC_CAPTURE_CHANNEL = 'sync:capture'

/** The capture channel's literal type. Same restated-constant contract. */
export type SyncCaptureChannel = typeof SYNC_CAPTURE_CHANNEL

/**
 * The answer to a backup round trip through a system dialog.
 *
 * `cancelled` is not an error and must never be reported as one: dismissing a
 * file dialog is a decision, and telling the user it failed would be a lie.
 */
export type BackupExportResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'failed'; message: string }

export type BackupImportResult =
  | { ok: true; backup: RespoBackupV1; path: string }
  | { ok: false; reason: 'cancelled' }
  /** The file is not a backup this build can read. `message` says which part. */
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'failed'; message: string }

/** renderer -> main request/response channels. Extended by later tasks. */
export type IpcInvokeMap = {
  'app:get-version': { args: []; result: string }
  /**
   * The url the session opens on: a CLI/deep-link argument when there is one,
   * otherwise the built-in default. Already normalized by main.
   */
  'app:get-start-url': { args: []; result: string }
  /**
   * Sent at most once per animation frame. The trailing `Rect` is the canvas
   * viewport in window CSS pixels: views are positioned relative to it and
   * culled against it.
   */
  'views:set-layout': { args: [ViewRect[], Rect]; result: void }
  'views:sync-devices': { args: [DeviceSpec[]]; result: void }
  'nav:navigate': { args: [string]; result: void }
  /**
   * History and reload act on every view at once: Respo drives one page across
   * many viewports, so there is no per-device history to steer.
   */
  'nav:back': { args: []; result: void }
  'nav:forward': { args: []; result: void }
  'nav:reload': { args: []; result: void }
  'theme:set-source': { args: [ThemeSource]; result: void }
  /** Read the whole persisted document, already migrated and repaired by main. */
  'store:load': { args: []; result: PersistedState }
  /**
   * Post a partial update. Main merges it onto the document it holds and writes
   * behind a debounce — the renderer never touches disk (CLAUDE.md §7).
   */
  'store:save': { args: [Partial<PersistedState>]; result: void }
  /**
   * Elect the view whose interactions drive the others, or `null` for none.
   *
   * Called on hover, coalesced to one message per animation frame by the
   * renderer — a pointer crossing five frames must not cost five round trips
   * (CLAUDE.md §4).
   */
  'sync:set-lead': { args: [string | null]; result: void }
  /** Take one device in or out of mirroring. */
  'sync:set-enabled': { args: [string, boolean]; result: void }
  /** The master switch: off means no view mirrors anything. */
  'sync:set-global': { args: [boolean]; result: void }
  /**
   * Write the document's portable half to a file the user picks.
   *
   * The renderer hands over the *value* and main does the dialog, the
   * validation and the write: the renderer never touches disk (CLAUDE.md §7),
   * and a path it could name would be a path it could choose.
   */
  'backup:export': { args: [RespoBackupV1]; result: BackupExportResult }
  /** Read a backup the user picks. Main validates it before it comes back. */
  'backup:import': { args: []; result: BackupImportResult }
  /**
   * Open DevTools for one device, in whatever mode `dock` currently names.
   *
   * Opening the dock for a second device retargets it: the DevTools frontend is
   * a `WebContentsView` main owns, and there is exactly one of it.
   */
  'devtools:open': { args: [string]; result: DevtoolsStatePayload }
  /** Close one device's DevTools, or (`null`) whatever is in the dock. */
  'devtools:close': { args: [string | null]; result: DevtoolsStatePayload }
  /**
   * Where the docked panel goes, in window CSS pixels — the strip the renderer
   * reserved, measured the same way device frames are.
   *
   * Sent at most once per animation frame: dragging the dock's resize handle
   * moves this rect continuously, and a message per pointer event is exactly
   * what CLAUDE.md §4 forbids.
   */
  'devtools:set-bounds': { args: [Rect]; result: void }
  /** Move the panel between the two docked edges and a window of its own. */
  'devtools:set-dock': { args: [DockPosition]; result: DevtoolsStatePayload }
  /**
   * Arm or disarm the element picker on every device at once.
   *
   * Answers with the mode main is actually in. It turns itself off again as
   * soon as something is picked, and says so through the `inspect-mode` event —
   * the renderer never has to time that itself.
   */
  'inspect:set': { args: [boolean]; result: boolean }
  /**
   * Screenshot one device. Answers with the batch it queued, not with a file:
   * a capture is asynchronous and the result travels as `shot-state`.
   */
  'shot:device': { args: [string, ShotRequest]; result: ShotStartResult }
  /** Screenshot every device on the canvas. Same contract, M jobs. */
  'shot:all': { args: [ShotRequest]; result: ShotStartResult }
  /**
   * Put one device's viewport on the clipboard instead of on disk.
   *
   * `false` means the view could not be captured (it is gone, or its debugger
   * is unavailable) — the renderer says so rather than claiming a copy.
   */
  'shot:copy': { args: [string]; result: boolean }
  /**
   * Show a saved screenshot in the file manager.
   *
   * Main refuses any path outside the screenshots folder: this is a renderer
   * handing main a path, and `showItemInFolder` on an arbitrary one is a
   * disclosure lever, not a convenience.
   */
  'shot:reveal': { args: [string]; result: boolean }
  /** The folder screenshots are written to, resolved (never the empty default). */
  'shot:get-dir': { args: []; result: string }
  /**
   * Pick the screenshots folder through a system dialog. `null` when the user
   * dismissed it. The renderer persists what comes back; it never names a path
   * of its own (CLAUDE.md §7).
   */
  'shot:choose-dir': { args: []; result: string | null }
  /**
   * The few history entries that match what is being typed.
   *
   * History lives in main — it is durable, it is capped at two thousand entries
   * and it carries icons — so the renderer asks rather than holds. Called on a
   * ~100ms debounce behind the address bar, which is typing rate and not an
   * event stream (CLAUDE.md §4). An empty query answers with the most recent
   * pages, which is what a freshly focused address bar should offer.
   */
  'history:query': { args: [string]; result: HistorySuggestion[] }
  /** Forget every visited page, and the icons cached alongside them. */
  'history:clear': { args: []; result: void }
  /**
   * Pick a local page through a system dialog. Answers with a `file:` url, or
   * `null` when the user dismissed it.
   *
   * The dialog lives here for the same reason the backup ones do: the renderer
   * names no paths of its own (CLAUDE.md §7), and it receives a url — already
   * normalized — rather than a path it could then do something else with.
   */
  'file:open': { args: []; result: string | null }
  /**
   * Forget storage, cookies or the cache.
   *
   * The renderer names the *kind*, never the origin: main is the side that
   * knows what the views are actually showing, and an origin taken from the
   * renderer would be a renderer choosing whose data to delete. Every view is
   * reloaded afterwards, because a page that outlives its own storage is a page
   * showing state that no longer exists.
   */
  'data:clear': { args: [ClearTarget]; result: ClearResult }
}

export type IpcChannel = keyof IpcInvokeMap

/**
 * Runtime mirror of `IpcInvokeMap`. Typed as a total `Record`, so adding a
 * channel to the map without listing it here is a compile error.
 */
const CHANNEL_REGISTRY: Record<IpcChannel, true> = {
  'app:get-version': true,
  'app:get-start-url': true,
  'views:set-layout': true,
  'views:sync-devices': true,
  'nav:navigate': true,
  'nav:back': true,
  'nav:forward': true,
  'nav:reload': true,
  'theme:set-source': true,
  'store:load': true,
  'store:save': true,
  'sync:set-lead': true,
  'sync:set-enabled': true,
  'sync:set-global': true,
  'backup:export': true,
  'backup:import': true,
  'devtools:open': true,
  'devtools:close': true,
  'devtools:set-bounds': true,
  'devtools:set-dock': true,
  'inspect:set': true,
  'shot:device': true,
  'shot:all': true,
  'shot:copy': true,
  'shot:reveal': true,
  'shot:get-dir': true,
  'shot:choose-dir': true,
  'history:query': true,
  'history:clear': true,
  'file:open': true,
  'data:clear': true
}

export const IPC_CHANNELS: readonly IpcChannel[] = Object.keys(CHANNEL_REGISTRY) as IpcChannel[]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHANNEL_REGISTRY, value)
}

/** The only main -> renderer channel. Deliberately not part of the invoke map. */
export const MAIN_EVENT_CHANNEL = 'respo:main-event'

/** Shape exposed to the renderer as `window.respo`. */
export interface RespoApi {
  invoke<K extends IpcChannel>(
    channel: K,
    ...args: IpcInvokeMap[K]['args']
  ): Promise<IpcInvokeMap[K]['result']>
  onMainEvent(callback: (event: MainEvent) => void): () => void
}

/** Schemes a device view is ever allowed to load (spec §7a). */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'file:'])

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i
/** `host:1234` — a bare authority, not a scheme, despite the colon. */
const HOST_PORT_RE = /^[^\s/?#:]+:\d+(?:[/?#]|$)/

function isLoopbackHost(input: string): boolean {
  const host = input.split(/[/?#]/, 1)[0]?.split(':', 1)[0]?.toLowerCase() ?? ''
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  )
}

function parseAllowed(candidate: string): string | null {
  try {
    const url = new URL(candidate)
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
    // `file:` is legitimately host-less; anything else without a host is junk.
    if (url.protocol !== 'file:' && url.hostname === '') return null
    return url.href
  } catch {
    return null
  }
}

/**
 * Turn user input (address bar, deep link, CLI, drag & drop) into a URL safe to
 * hand to a view, or `null` when it is not loadable.
 *
 * - bare hosts get `https://`, loopback hosts get `http://`
 * - an explicit `http:`/`https:`/`file:` scheme is preserved
 * - every other scheme (`javascript:`, `data:`, `about:`, ...) is rejected
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  const scheme = SCHEME_RE.exec(trimmed)
  if (scheme !== null && !HOST_PORT_RE.test(trimmed)) {
    if (!ALLOWED_PROTOCOLS.has(`${scheme[1]?.toLowerCase()}:`)) return null
    return parseAllowed(trimmed)
  }

  const authority = trimmed.replace(/^\/+/, '')
  if (authority === '') return null
  return parseAllowed(`${isLoopbackHost(authority) ? 'http' : 'https'}://${authority}`)
}
