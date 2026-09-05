/**
 * The single source of truth for every IPC channel in Respo.
 *
 * Rules (CLAUDE.md §6): no channel exists outside this module, main validates
 * everything it receives, and there is no per-event traffic — main -> renderer
 * updates travel batched over the one `MAIN_EVENT_CHANNEL`.
 */

import type { RespoBackupV1 } from './backup'
import type { EmulationProfile, VisionDeficiency } from './emulation'
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

/**
 * The site capabilities Respo is willing to talk about.
 *
 * Eight, and deliberately not "whatever Chromium supports": every entry here is
 * something a person can be asked a yes/no question about and answer without
 * knowing what a permission is. Anything else a page asks for — display capture,
 * idle detection, window management, storage access — has no row in the panel
 * and is refused without a prompt, because a dialog nobody can evaluate is worse
 * than a no (`mapPermission` in `main/permissions.ts`).
 *
 * `camera` and `microphone` are one Electron permission (`media`) split by the
 * media types the page asked for; a request for both carries both.
 */
export type PermissionType =
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'notifications'
  | 'clipboard-read'
  | 'fullscreen'
  | 'midi'
  | 'pointerLock'

/** Every permission type, in the order the panel lists them. */
export const PERMISSION_TYPES: readonly PermissionType[] = [
  'camera',
  'microphone',
  'geolocation',
  'notifications',
  'clipboard-read',
  'fullscreen',
  'midi',
  'pointerLock'
]

export function isPermissionType(value: unknown): value is PermissionType {
  return PERMISSION_TYPES.includes(value as PermissionType)
}

/**
 * What an origin is allowed to do with one capability.
 *
 * `ask` is the absence of a decision, not a third stored value: only `allow` and
 * `block` are written to disk, and a permission *check* — the silent question
 * Chromium asks before it even reaches the request handler — answers `false` for
 * `ask`, because "we would have asked" is not consent.
 */
export type PermissionDecision = 'allow' | 'block' | 'ask'

export function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === 'allow' || value === 'block' || value === 'ask'
}

/**
 * What an origin may do before anyone has said anything about it.
 *
 * `ask` everywhere except fullscreen, and that exception is a UX call rather
 * than a security one: fullscreen is what a video player requests the instant
 * someone clicks play, it is visible the moment it happens, it is undone with
 * Escape, and it reveals nothing. Prompting for it would put a dialog between
 * the user and every video on the web. Every other row here reaches a camera, a
 * location, a clipboard or a notification tray, and none of those may start on.
 *
 * The panel can still set fullscreen to `ask` or `block` per origin — this is
 * the default, not a floor.
 */
export const DEFAULT_PERMISSION_DECISIONS: Readonly<Record<PermissionType, PermissionDecision>> = {
  camera: 'ask',
  microphone: 'ask',
  geolocation: 'ask',
  notifications: 'ask',
  'clipboard-read': 'ask',
  fullscreen: 'allow',
  midi: 'ask',
  pointerLock: 'ask'
}

/**
 * One question waiting for an answer.
 *
 * `types` is usually a single entry. `getUserMedia({ video: true, audio: true })`
 * is the exception: one Electron request covering two of Respo's types, and both
 * have to be granted for it to be granted at all.
 */
export type PermissionPrompt = {
  /**
   * Correlation id. The renderer answers *this* question — never "the pending
   * one" — so a second request arriving between render and click cannot be
   * answered by a button the user pressed for the first.
   */
  id: string
  /** The site that asked, as main derived it. Never taken from the renderer. */
  origin: string
  types: PermissionType[]
}

/**
 * Everything the permission UI draws, in one payload.
 *
 * `origin` is the site the canvas is on — computed in main, from the url the
 * views are actually showing, for the same reason a clear's origin is
 * (`main/clear-data.ts`): a renderer that could name an origin could grant a
 * capability to any site on the machine.
 */
export type PermissionStatePayload = {
  origin: string | null
  /** The decision for every type at `origin`, defaults already applied. */
  decisions: Record<PermissionType, PermissionDecision>
  /** Questions waiting for an answer, oldest first. */
  prompts: PermissionPrompt[]
}

/**
 * One HTTP authentication challenge, as the renderer hears about it.
 *
 * Coalesced in main: five viewports loading the same protected page produce
 * five `login` events and exactly one of these.
 */
export type AuthPrompt = {
  /**
   * Correlation id, for the same reason a permission prompt has one — and here
   * it carries more weight: an answer that reached the *wrong* challenge would
   * send one site's password to another server. Every reply names the challenge
   * it belongs to; nothing here answers "the pending one".
   */
  id: string
  /** `host` or `host:port`, as a person would read it back. */
  host: string
  /** A proxy asking, rather than the site. Worth saying out loud. */
  isProxy: boolean
  /**
   * The realm the server named, when it named one.
   *
   * Server-controlled text, shown to the user, so main truncates it before it
   * travels — a "realm" a kilobyte long is not a realm.
   */
  realm?: string
}

/**
 * A username and password on their way to one challenge.
 *
 * They travel once and are never written to disk, never logged, and dropped
 * from the renderer's own state the moment they are sent. Respo has no password
 * store and is not going to grow one: the OS and the browser the user already
 * trusts are better at that than a development tool.
 */
export type AuthCredentials = { username: string; password: string }

/**
 * The emulation pack as main is applying it: the global profile, and the
 * devices whose vision simulation overrides it.
 *
 * The renderer owns the document (it persists this like every other slice);
 * main mirrors it into every view and restores it at boot before the first
 * view exists, so this payload is only what a renderer that has just started
 * asks for when it wants to be sure.
 */
export type EmulationStatePayload = {
  profile: EmulationProfile
  /** Per-device vision overrides. An absent id inherits the profile. */
  deviceVision: Record<string, VisionDeficiency>
}

/**
 * Where one device's page is.
 *
 * `crashed` is its renderer process going away underneath it (`render-process-gone`):
 * the document is gone but the view is not, and `view:restart` brings it back.
 * It is kept apart from `failed` because the two need different words and a
 * different button — a page that could not be fetched is retried, a page
 * whose process died is restarted — and because a crash is the one state a
 * reload of *every* device must not be the answer to (spec §7).
 */
export type LoadState = 'loading' | 'ready' | 'failed' | 'crashed'

export type LoadStatePayload = {
  deviceId: string
  state: LoadState
  url: string
  title?: string
  errorCode?: number
  /** For `failed`, Chromium's error name; for `crashed`, the exit reason. */
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

/** One console message worth keeping: the level, and the first line of it. */
export type DiagnosticMessage = {
  /** `exception` is an uncaught error; the other two are `console.error` / `console.assert`. */
  level: 'exception' | 'error' | 'assert'
  /** Truncated in main; page text, so the renderer renders it as text only. */
  text: string
}

/** One element that sticks out past the viewport's right edge. */
export type OverflowItem = {
  /** `tag#id.class`, for reading. The selector main highlights by stays in main. */
  label: string
  /** The element's rendered width, in the page's CSS pixels. */
  width: number
  /** How far its right edge is from the document's left edge, CSS pixels. */
  right: number
}

/** What the overflow scan found, once a page has settled. */
export type OverflowReport = {
  clientWidth: number
  scrollWidth: number
  /** Up to ten offenders, outermost first; empty when nothing overflows. */
  items: OverflowItem[]
}

/**
 * What one device's page has been complaining about since it last navigated.
 *
 * `errors` counts every exception and error-level console call; `messages`
 * keeps only the last few, so a page in a logging loop costs a bounded amount
 * of memory and IPC. `overflow` is `null` until the first scan after a load.
 */
export type DiagnosticsPayload = {
  deviceId: string
  errors: number
  messages: DiagnosticMessage[]
  overflow: OverflowReport | null
}

/**
 * What `diagnostics:highlight` points at: one offender by its index in the
 * last report, all of them, or nothing (clear). An index rather than a
 * selector on purpose — the selector is page-derived text, and it never
 * leaves main.
 */
export type HighlightTarget = number | 'all' | 'none'

/** The DevTools panels Respo can open a frontend on. */
export type DevtoolsPanelName = 'elements' | 'console'

/** Where one device's document is scrolled to, in its own CSS pixels. */
export type ScrollStatePayload = { deviceId: string; x: number; y: number }

/**
 * Live reload, as the address bar shows it.
 *
 * `off` for anything that is not a local file — there is nothing to watch
 * on `http(s)`, and the indicator is simply absent. `paused` keeps the watch
 * and ignores it: the way to edit a file without every device jumping.
 */
export type WatcherState = {
  state: 'watching' | 'paused' | 'off'
  /** The watched page's path, for the tooltip. */
  file: string | null
  /** When the last change was acted on, epoch milliseconds. */
  lastReloadAt: number | null
}

/** A design image main keeps, as the renderer sees it. */
export type OverlayImage = {
  /** Content id: the first sixteen hex digits of the bytes' SHA-256. */
  id: string
  width: number
  height: number
  bytes: number
  /** The image itself. Sent on request only — the dialog and the side panel. */
  dataUrl: string
}

/** Largest design image worth keeping. Past this it is not a mockup, it is a photo. */
export const MAX_OVERLAY_IMAGE_BYTES = 10 * 1024 * 1024

export type OverlayStoreResult =
  | { ok: true; image: Omit<OverlayImage, 'dataUrl'> }
  /** Larger than `MAX_OVERLAY_IMAGE_BYTES`, or not an image Chromium can decode. */
  | { ok: false; reason: 'too-large' | 'unreadable'; message: string }

/** How the overlay is shown: over the page, or in a panel beside the frame. */
export type OverlayMode = 'overlay' | 'side-by-side'

/** What the CSS layer over one page looks like. */
export type OverlayApply = {
  imageId: string
  /** 0..1. */
  opacity: number
  /** How much of the image, from the left, is hidden: 0..1. */
  curtain: number
}

/**
 * The guides of one viewport size: `h` are horizontal lines (y positions),
 * `v` vertical ones (x positions), in the page's CSS pixels from the
 * document's origin. Keyed by `WxH` in the document, because a guide at
 * 320px means something on a 320px-wide phone and nothing on a monitor.
 */
export type GuideSet = { h: number[]; v: number[] }

/**
 * Batched main -> renderer notification. One `load-state` message carries many
 * devices; the DevTools and inspect messages carry one whole state each and are
 * only sent when something main knows about — and the renderer does not —
 * actually changed.
 */
export type MainEvent =
  | { type: 'load-state'; payload: LoadStatePayload[] }
  /**
   * Console errors and overflow, coalesced like `load-state`: a page throwing
   * in a loop is one message per flush window carrying the count, not one
   * message per throw (CLAUDE.md §4).
   */
  | { type: 'diagnostics'; payload: DiagnosticsPayload[] }
  /**
   * Scroll offsets of the devices whose rulers are showing, one message per
   * turn while any of them scrolls and nothing at all otherwise. The samples
   * come from the same preload stream mirroring rides on — no second stream —
   * and only devices with rulers on are asked to report (CLAUDE.md §4).
   */
  | { type: 'scroll-state'; payload: ScrollStatePayload[] }
  /** The live-reload watcher's state, whenever it changes. Never per file event. */
  | { type: 'watcher'; payload: WatcherState }
  | { type: 'devtools-state'; payload: DevtoolsStatePayload }
  | { type: 'inspect-mode'; payload: { active: boolean } }
  /**
   * Screenshot progress, coalesced the same way `load-state` is: five devices
   * moving through queued -> active -> done is one message per turn, keyed by
   * job, not fifteen (CLAUDE.md §4).
   */
  | { type: 'shot-state'; payload: ShotStatePayload[] }
  /**
   * The whole permission picture: the canvas's origin, its decisions, and every
   * question waiting for an answer.
   *
   * One message rather than an event per request — five viewports asking for the
   * microphone at once is one prompt and one push (CLAUDE.md §4) — and the whole
   * state rather than a delta, so the renderer never has to reconcile.
   */
  | { type: 'permission-state'; payload: PermissionStatePayload }
  /**
   * Authentication challenges waiting for an answer, oldest first. The whole
   * list, coalesced the same way everything else is — a page with a protected
   * image on every viewport is one message, not ten.
   */
  | { type: 'auth-state'; payload: AuthPrompt[] }

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
  /**
   * `x`/`y` are the absolute offsets in the page's own CSS pixels, next to
   * the ratios mirroring works in: the rulers need to know *where* a page is,
   * not only how far along. Same message, two more numbers.
   */
  | { kind: 'scroll'; ratioX: number; ratioY: number; x: number; y: number }
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

/**
 * What one reload asks for.
 *
 * Both fields are optional because the common gesture — the toolbar button —
 * says neither: every device, from cache. A device's own kebab names the
 * device, and "Reload ignoring cache" (`mod+shift+r`) sets the flag; the
 * combination is the whole space.
 */
export type ReloadRequest = {
  /** One device, or every device when absent. */
  deviceId?: string
  /** `webContents.reloadIgnoringCache()` rather than `reload()`. */
  ignoreCache?: boolean
}

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
  /** Reload every view, or one — see `ReloadRequest`. No argument is "all, from cache". */
  'nav:reload': { args: [ReloadRequest?]; result: void }
  /**
   * Bring back a device whose renderer process died.
   *
   * Per device on purpose, unlike reload: the other viewports are alive and
   * showing the page, and a crash in one must not cost the others their
   * scroll position (spec §7). Ignored for a device that is not crashed.
   */
  'view:restart': { args: [string]; result: void }
  /** Put one device's document back at its top. A user gesture, not a stream. */
  'view:scroll-to-top': { args: [string]; result: void }
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
   * a `WebContentsView` main owns, and there is exactly one of it. The panel
   * is optional and defaults to whatever the frontend opens on (Elements);
   * the errors chip asks for the console.
   */
  'devtools:open': { args: [string, DevtoolsPanelName?]; result: DevtoolsStatePayload }
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
  /**
   * The permission state for the site the canvas is on.
   *
   * Asked when the panel opens rather than mirrored continuously: main pushes
   * `permission-state` whenever something changes, and this is the answer for a
   * renderer that has just started and has not been pushed anything yet.
   */
  'permissions:get': { args: []; result: PermissionStatePayload }
  /**
   * Answer one prompt: `(id, allow)`.
   *
   * The id is the whole point — see `PermissionPrompt.id`. Every callback that
   * was coalesced behind that question is resolved, and the answer is *kept* for
   * the origin, the way a browser keeps it: the panel is where it is changed
   * back.
   */
  'permissions:respond': { args: [string, boolean]; result: void }
  /**
   * Put one prompt away without answering it.
   *
   * What clicking outside the bubble means, and it is deliberately *not* a
   * block: dismissing a question is "not now", and turning an accidental click
   * on the canvas into a decision remembered forever would be a trap. The
   * request is refused this time and the page is free to ask again.
   */
  'permissions:dismiss': { args: [string]; result: void }
  /**
   * Set one capability for the site the canvas is on.
   *
   * The renderer names the type and the decision, never the origin: main is the
   * side that knows which site the views are showing, and an origin taken from
   * a payload would be a compromised renderer granting the camera to any site
   * on the machine.
   */
  'permissions:set': { args: [PermissionType, PermissionDecision]; result: PermissionStatePayload }
  /** Forget every decision for the site the canvas is on. */
  'permissions:reset': { args: []; result: PermissionStatePayload }
  /**
   * Answer one authentication challenge: `(id, credentials)`, or `null` to
   * cancel.
   *
   * Cancelling is a decision, not an error: the request goes on without
   * credentials and the server answers with whatever it answers — usually a
   * 401 page, which is a perfectly good thing to be looking at.
   */
  'auth:respond': { args: [string, AuthCredentials | null]; result: void }
  /**
   * Put one environment on every device view at once.
   *
   * The whole profile, not a delta: main diffs it against what each view is
   * already emulating and sends only the CDP calls that change something, so
   * a colour-scheme flip costs one `Emulation.setEmulatedMedia` per view. The
   * renderer persists the profile itself (`emulation` slice), and main
   * restores it at boot before the first view exists.
   */
  'emulation:set': { args: [EmulationProfile]; result: void }
  /**
   * Simulate a vision deficiency on one device only, or (`null`) let it
   * inherit the profile again. Wins over the profile's `vision` for that
   * device — the way to compare two identical frames with and without.
   */
  'emulation:set-device-vision': { args: [string, VisionDeficiency | null]; result: void }
  /** What main is actually applying. For a renderer that wants to be sure. */
  'emulation:get': { args: []; result: EmulationStatePayload }
  /**
   * Outline one overflow offender, all of them, or none, on one device.
   *
   * A CSS layer (`webContents.insertCSS`) rather than DevTools' overlay: the
   * outline then scrolls with the element and several can be shown at once.
   * The selector is looked up in main by index — see `HighlightTarget`.
   */
  'diagnostics:highlight': { args: [string, HighlightTarget]; result: void }
  /** Every device's diagnostics, for a renderer that has just started. */
  'diagnostics:get': { args: []; result: DiagnosticsPayload[] }
  /**
   * Ask one device to report its scroll offsets, or stop (see `scroll-state`).
   * The rulers and a side-by-side overlay both need it; the renderer counts
   * the reasons and main sees a boolean. Answers with where the page is right
   * now, so a ruler starts in the right place rather than at zero until the
   * first scroll.
   */
  'scroll:track': { args: [string, boolean]; result: ScrollStatePayload | null }
  /**
   * Put a set of guides on one device's page, as a CSS layer that scrolls
   * with the document. An empty set removes the layer. The renderer sends
   * the set for the device's current size; the document is its to keep.
   */
  'guides:set': { args: [string, GuideSet]; result: void }
  /**
   * Keep a design image the user picked.
   *
   * The renderer reads the file it was handed (`<input type="file">` — it
   * learns no path and writes nothing) and sends the data url once; main
   * checks the size and that it decodes as an image, stores it under a
   * content id in its own store key (100 MB total, least recently used goes
   * first), and answers with the id and the dimensions.
   */
  'overlay:store-image': { args: [string]; result: OverlayStoreResult }
  /** A stored image, for the dialog's thumbnail and the side-by-side panel. `null` if evicted. */
  'overlay:image': { args: [string]; result: OverlayImage | null }
  /**
   * Put a design image over one device's page as a CSS layer, or (`null`)
   * take it off. Opacity and curtain travel with it; the image is looked up
   * by id in main, so the renderer never ships megabytes per change.
   */
  'overlay:set': { args: [string, OverlayApply | null]; result: void }
  /** Pause or resume live reload of the local page. Answers with the state. */
  'watcher:toggle': { args: []; result: WatcherState }
  /** The watcher's state, for a renderer that has just started. */
  'watcher:get': { args: []; result: WatcherState }
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
  'view:restart': true,
  'view:scroll-to-top': true,
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
  'data:clear': true,
  'permissions:get': true,
  'permissions:respond': true,
  'permissions:dismiss': true,
  'permissions:set': true,
  'permissions:reset': true,
  'auth:respond': true,
  'emulation:set': true,
  'emulation:set-device-vision': true,
  'emulation:get': true,
  'diagnostics:highlight': true,
  'diagnostics:get': true,
  'scroll:track': true,
  'guides:set': true,
  'overlay:store-image': true,
  'overlay:image': true,
  'overlay:set': true,
  'watcher:toggle': true,
  'watcher:get': true
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
