/**
 * The shape Respo keeps on disk, and the pure functions that reason about it.
 *
 * Nothing here touches Electron or the filesystem: main owns the store (rule
 * §7 — the renderer never writes disk), but both sides need the same
 * vocabulary, and the merge/migration logic is where the bugs would be, so it
 * lives somewhere a unit test can reach it.
 */

import { slugify } from './custom-devices'
import { DEFAULT_ACTIVE_DEVICE_IDS } from './deviceCatalog'
import {
  normalizeUrl,
  type DockPosition,
  type ShotDpr,
  type ShotFormat,
  type ThemeSource
} from './ipc'
import type { DeviceSpec } from './types'

/** Bumped whenever a stored document stops being readable by this code. */
export const SCHEMA_VERSION = 1

/** A named, ordered set of devices the canvas shows together. */
export type Suite = {
  id: string
  name: string
  /** Device ids, in canvas order. May name catalog or custom devices. */
  deviceIds: string[]
}

/**
 * Where the user left the mirroring switches.
 *
 * Only the *exceptions* are stored: a device is mirroring unless its id is in
 * `disabledDeviceIds`. Devices come and go (a suite change, a custom device
 * deleted) and a positive list would have to be reconciled with every one of
 * those; a list of opt-outs simply stops matching anything.
 */
export type SyncSettings = {
  /** Master switch. Off means no view mirrors anything. */
  enabled: boolean
  /** Devices the user took out of mirroring, by id. */
  disabledDeviceIds: string[]
}

/**
 * Where the user left the DevTools panel.
 *
 * Not *whether* it was open: a session that ended with DevTools on a device
 * should not reopen it — restoring a debugging tool nobody asked for costs a
 * frame's worth of canvas and a renderer process at every launch. Only the
 * shape of the panel is worth remembering.
 */
export type DevtoolsSettings = {
  dock: DockPosition
  /**
   * Thickness of the docked strip in window CSS pixels — its height at the
   * bottom, its width on the right. One number for both edges: the panel is
   * never docked to two of them at once, and carrying a second would only make
   * the first switch feel like it forgot something.
   */
  size: number
}

/**
 * How the canvas arranges the frames.
 *
 * - `column` — one device per row, in suite order. The narrow, predictable
 *   reading order: scroll down and you have seen every device, in the order the
 *   suite names them.
 * - `flex` — rows that wrap at the canvas width, each row as tall as its
 *   tallest frame. What Respo has always done, and the default.
 * - `masonry` — the same frames packed into columns by height, each device
 *   dropped into whichever column is currently shortest. Same information as
 *   `flex` with the ragged vertical gaps taken out.
 * - `individual` — one device fills the canvas, the rest wait in a tab strip.
 */
export type CanvasLayoutMode = 'column' | 'flex' | 'masonry' | 'individual'

/** Every canvas layout mode, in the order `mod+shift+l` cycles them. */
export const CANVAS_LAYOUT_MODES: readonly CanvasLayoutMode[] = [
  'column',
  'flex',
  'masonry',
  'individual'
]

/**
 * How the user left the canvas.
 *
 * `individualDeviceId` is remembered alongside the mode rather than derived: a
 * session that ended on one device should come back to *that* device, and the
 * canvas has no other way to know which of five it was. `null` — or an id no
 * longer on the canvas — means "the first device of the suite", which is what
 * the renderer falls back to anyway.
 */
export type LayoutSettings = {
  mode: CanvasLayoutMode
  individualDeviceId: string | null
}

/**
 * Where screenshots go and what they look like.
 *
 * `directory` is empty on a fresh install and stays empty until the user picks
 * a folder: the default is `Pictures/Respo`, which only main can resolve
 * (`app.getPath`), and writing a resolved path into the document would freeze a
 * profile copied to another machine onto a folder that does not exist there.
 */
export type ScreenshotSettings = {
  /** Absolute path, or `''` for "wherever main puts them by default". */
  directory: string
  format: ShotFormat
  dpr: ShotDpr
}

/**
 * One saved page.
 *
 * `title` is the page's own `<title>` at the moment it was starred, and it is
 * editable afterwards: a bookmark is the user's label for a place, not a mirror
 * of whatever that place currently calls itself. `id` exists because both of
 * the other two are editable — a list keyed by url could not survive the user
 * fixing a typo in one.
 */
export type Bookmark = {
  id: string
  title: string
  url: string
  /** Epoch milliseconds. What the list is ordered by, newest first. */
  addedAt: number
}

/** More saved pages than a toolbar menu could ever be a way into. */
export const MAX_BOOKMARKS = 500
/**
 * Longest url worth storing. Chromium's own limit is 2MB and browsers stop
 * displaying past ~32k; this is past any url a person types and far short of
 * something worth writing to a settings file.
 */
export const MAX_URL_LENGTH = 2048
/** A page title is a label. Longer ones are truncated, never rejected. */
export const MAX_TITLE_LENGTH = 300

/** Bounds on the dock strip, shared by the renderer's drag and main's repair. */
export const MIN_DOCK_SIZE = 160
export const MAX_DOCK_SIZE = 2000
export const DEFAULT_DOCK_SIZE = 320

/** Clamp a dock thickness into the range the panel is usable in. */
export function clampDockSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_DOCK_SIZE
  return Math.min(MAX_DOCK_SIZE, Math.max(MIN_DOCK_SIZE, Math.round(size)))
}

export type PersistedState = {
  schemaVersion: number
  customDevices: DeviceSpec[]
  suites: Suite[]
  activeSuiteId: string
  ui: { theme: ThemeSource }
  sync: SyncSettings
  /**
   * Which devices the user turned on their side, by id. An absent id is
   * portrait, which is why only the exceptions are written — the same reasoning
   * as `SyncSettings.disabledDeviceIds`.
   */
  rotated: Record<string, boolean>
  /** How the canvas arranges the frames. See `LayoutSettings`. */
  layout: LayoutSettings
  /** How the DevTools panel is shaped. See `DevtoolsSettings`. */
  devtools: DevtoolsSettings
  /** Where screenshots go and what they look like. See `ScreenshotSettings`. */
  screenshots: ScreenshotSettings
  /** Saved pages, newest first. See `Bookmark`. */
  bookmarks: Bookmark[]
  /**
   * The page every session opens on, or `''` for "no home page".
   *
   * Read by *main* at boot rather than applied by the renderer: the views are
   * created and pointed somewhere before the renderer has finished hydrating,
   * and a home page that arrived a round trip late would show as the default
   * page loading and then being replaced.
   */
  homeUrl: string
}

export const DEFAULT_SUITE_ID = 'default'
export const DEFAULT_SUITE_NAME = 'Default'

/**
 * A stable, readable id for a new suite, distinct from everything `taken`.
 *
 * Derived from the name for the same reason device ids are: a document someone
 * exports and reads should say `suite-marketing-site`, not a uuid.
 */
export function makeSuiteId(name: string, taken: ReadonlySet<string>): string {
  const base = `suite-${slugify(name, 'suite')}`
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** Guard rails for anything read back off disk. Same spirit as `main/validate`. */
const MAX_DEVICES = 64
const MAX_SUITES = 64
/** One orientation flag per device the user ever turned, catalog included. */
const MAX_ROTATED = 256
const MAX_DIMENSION = 10_000
const MAX_DPR = 10

/** What a fresh install starts from: the W1 selection, under one suite. */
export function defaultPersistedState(): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    customDevices: [],
    suites: [
      {
        id: DEFAULT_SUITE_ID,
        name: DEFAULT_SUITE_NAME,
        deviceIds: [...DEFAULT_ACTIVE_DEVICE_IDS]
      }
    ],
    activeSuiteId: DEFAULT_SUITE_ID,
    ui: { theme: 'system' },
    // Mirroring is the product: it is on out of the box, with nothing muted.
    sync: { enabled: true, disabledDeviceIds: [] },
    // Every device starts the way it is held.
    rotated: {},
    // Rows that wrap: the arrangement that shows the most devices at once on a
    // canvas of mixed widths, and the one Respo has always opened on.
    layout: { mode: 'flex', individualDeviceId: null },
    // Bottom is where a browser puts DevTools, and it is the edge that costs a
    // canvas of side-by-side viewports the least width.
    devtools: { dock: 'bottom', size: DEFAULT_DOCK_SIZE },
    // PNG at the device's own density: the truthful screenshot, which is the
    // one someone comparing two viewports came for.
    screenshots: { directory: '', format: 'png', dpr: 'device' },
    // Nothing saved and nowhere to call home: both are the user's to fill in,
    // and a starter bookmark would be an advertisement.
    bookmarks: [],
    homeUrl: ''
  }
}

/**
 * Apply one patch to a state.
 *
 * Top-level keys replace wholesale — a suite list is a value, not something to
 * concatenate — except `ui`, which merges field by field so a theme change does
 * not have to restate the rest of it. `schemaVersion` is owned by this module
 * and is never taken from a patch: the renderer must not be able to make a
 * document claim a version it is not.
 */
export function mergePersistedState(
  base: PersistedState,
  patch: Partial<PersistedState>
): PersistedState {
  const next: PersistedState = {
    ...base,
    ...(patch.customDevices === undefined ? {} : { customDevices: [...patch.customDevices] }),
    ...(patch.suites === undefined ? {} : { suites: patch.suites.map(cloneSuite) }),
    ...(patch.activeSuiteId === undefined ? {} : { activeSuiteId: patch.activeSuiteId }),
    ui: { ...base.ui, ...(patch.ui ?? {}) },
    sync: cloneSync(patch.sync ?? base.sync),
    rotated: { ...(patch.rotated ?? base.rotated) },
    layout: { ...(patch.layout ?? base.layout) },
    devtools: { ...(patch.devtools ?? base.devtools) },
    screenshots: { ...(patch.screenshots ?? base.screenshots) },
    bookmarks: (patch.bookmarks ?? base.bookmarks).map(cloneBookmark),
    homeUrl: patch.homeUrl ?? base.homeUrl,
    schemaVersion: SCHEMA_VERSION
  }
  return next
}

export type MigrationResult = {
  state: PersistedState
  /**
   * The unreadable document, when there was one. The caller parks it under a
   * backup key rather than deleting it — a user whose settings were reset
   * should still be able to get them back.
   */
  backup: unknown | null
}

/**
 * Turn whatever is on disk into a state this build can use.
 *
 * Two failure modes, handled differently:
 *
 * - the *document* is unreadable (not an object, or a `schemaVersion` this
 *   build has no migration for): reset to defaults and hand the original back
 *   for backup. This is the seam future migrations plug into — a `case 2:`
 *   before the fallthrough.
 * - a *field* is malformed: repair just that field. A junk theme must not cost
 *   the user their suites.
 */
export function migratePersistedState(raw: unknown): MigrationResult {
  if (raw === undefined || raw === null) return { state: defaultPersistedState(), backup: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { state: defaultPersistedState(), backup: raw }
  }

  const doc = raw as Record<string, unknown>
  if (doc['schemaVersion'] !== SCHEMA_VERSION) {
    return { state: defaultPersistedState(), backup: raw }
  }

  const defaults = defaultPersistedState()
  const suites = sanitizeSuites(doc['suites'])
  const resolvedSuites = suites.length > 0 ? suites : defaults.suites
  const activeSuiteId = doc['activeSuiteId']
  const active =
    typeof activeSuiteId === 'string' && resolvedSuites.some((s) => s.id === activeSuiteId)
      ? activeSuiteId
      : (resolvedSuites[0]?.id ?? DEFAULT_SUITE_ID)

  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      customDevices: sanitizeDevices(doc['customDevices']),
      suites: resolvedSuites,
      activeSuiteId: active,
      ui: { theme: sanitizeTheme((doc['ui'] as Record<string, unknown> | undefined)?.['theme']) },
      sync: sanitizeSync(doc['sync']),
      rotated: sanitizeRotated(doc['rotated']),
      layout: sanitizeLayout(doc['layout']),
      devtools: sanitizeDevtools(doc['devtools']),
      screenshots: sanitizeScreenshots(doc['screenshots']),
      bookmarks: sanitizeBookmarks(doc['bookmarks']),
      homeUrl: sanitizeHomeUrl(doc['homeUrl'])
    },
    backup: null
  }
}

function cloneSuite(suite: Suite): Suite {
  return { id: suite.id, name: suite.name, deviceIds: [...suite.deviceIds] }
}

function cloneBookmark(bookmark: Bookmark): Bookmark {
  return {
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    addedAt: bookmark.addedAt
  }
}

/**
 * Repair the bookmark list.
 *
 * Entry by entry, like the device list: one bookmark whose url stopped being
 * loadable — a document hand-edited, a build that narrowed the allowed schemes
 * — must not cost the user the other forty. The url is *normalized* rather than
 * merely checked, so what comes back is exactly what a view could be told to
 * load; a title is truncated rather than dropped, because a long one is still
 * the user's label for the page.
 */
function sanitizeBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return []

  const out: Bookmark[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, MAX_BOOKMARKS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const bookmark = entry as Record<string, unknown>
    if (!isFilledString(bookmark['id']) || seen.has(bookmark['id'])) continue

    const rawUrl = bookmark['url']
    if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LENGTH) continue
    const url = normalizeUrl(rawUrl)
    if (url === null) continue

    const title = bookmark['title']
    const addedAt = bookmark['addedAt']

    seen.add(bookmark['id'])
    out.push({
      id: bookmark['id'],
      title: typeof title === 'string' ? title.slice(0, MAX_TITLE_LENGTH) : '',
      url,
      addedAt: typeof addedAt === 'number' && Number.isFinite(addedAt) && addedAt >= 0 ? addedAt : 0
    })
  }
  return out
}

/** Repair the home page: a loadable url, or none at all. */
function sanitizeHomeUrl(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_URL_LENGTH) return ''
  return normalizeUrl(value) ?? ''
}

function cloneSync(sync: SyncSettings): SyncSettings {
  return { enabled: sync.enabled, disabledDeviceIds: [...sync.disabledDeviceIds] }
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isBounded(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
}

function sanitizeTheme(value: unknown): ThemeSource {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** Drop anything that is not a whole, plausible device. */
function sanitizeDevices(value: unknown): DeviceSpec[] {
  if (!Array.isArray(value)) return []
  const out: DeviceSpec[] = []
  const seen = new Set<string>()

  for (const entry of value.slice(0, MAX_DEVICES)) {
    if (typeof entry !== 'object' || entry === null) continue
    const device = entry as Record<string, unknown>
    if (!isFilledString(device['id']) || seen.has(device['id'])) continue
    if (!isFilledString(device['name']) || !isFilledString(device['userAgent'])) continue
    if (!isBounded(device['width'], MAX_DIMENSION)) continue
    if (!isBounded(device['height'], MAX_DIMENSION)) continue
    if (!isBounded(device['dpr'], MAX_DPR)) continue
    if (typeof device['touch'] !== 'boolean') continue

    seen.add(device['id'])
    const type = device['type']
    const rotatable = device['rotatable']
    out.push({
      id: device['id'],
      name: device['name'],
      width: device['width'],
      height: device['height'],
      dpr: device['dpr'],
      userAgent: device['userAgent'],
      touch: device['touch'],
      // Optional, and a junk value is dropped rather than costing the device:
      // both have a sane derivation when they are absent.
      ...(type === 'phone' || type === 'tablet' || type === 'desktop' ? { type } : {}),
      ...(typeof rotatable === 'boolean' ? { rotatable } : {})
    })
  }
  return out
}

/**
 * Repair the mirroring switches.
 *
 * A missing or malformed slice means "mirroring on, nothing muted" rather than
 * a reset of the document: the switches are a preference, and the safe reading
 * of a damaged one is the product working.
 */
function sanitizeSync(value: unknown): SyncSettings {
  const defaults: SyncSettings = { enabled: true, disabledDeviceIds: [] }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults

  const sync = value as Record<string, unknown>
  const raw = Array.isArray(sync['disabledDeviceIds']) ? sync['disabledDeviceIds'] : []
  const seen = new Set<string>()
  for (const id of raw.slice(0, MAX_DEVICES)) {
    if (!isFilledString(id)) continue
    seen.add(id)
  }

  return {
    enabled: typeof sync['enabled'] === 'boolean' ? sync['enabled'] : true,
    disabledDeviceIds: [...seen]
  }
}

/**
 * Repair the orientation map.
 *
 * A field, not a document: junk here costs the user their landscape frames and
 * nothing else, so it is dropped entry by entry. Only `true` survives — a
 * `false` is the default said out loud, and keeping it would grow the map by
 * one entry for every device ever turned back.
 */
function sanitizeRotated(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const out: Record<string, boolean> = {}
  for (const [id, landscape] of Object.entries(value).slice(0, MAX_ROTATED)) {
    if (id.length === 0 || landscape !== true) continue
    out[id] = true
  }
  return out
}

/** Whether `value` names a canvas layout this build knows how to draw. */
export function isCanvasLayoutMode(value: unknown): value is CanvasLayoutMode {
  return CANVAS_LAYOUT_MODES.includes(value as CanvasLayoutMode)
}

/**
 * Repair the canvas layout.
 *
 * Absent on every document written before this build, so "missing" means the
 * defaults rather than a reset — a field, not a document (see
 * `migratePersistedState`). The remembered device is kept independently of the
 * mode: a junk mode must not also cost the user the device they were on, and an
 * id that no longer names a device costs nothing because the canvas falls back
 * to the first one either way.
 */
function sanitizeLayout(value: unknown): LayoutSettings {
  const defaults: LayoutSettings = { mode: 'flex', individualDeviceId: null }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults

  const layout = value as Record<string, unknown>
  const device = layout['individualDeviceId']
  return {
    mode: isCanvasLayoutMode(layout['mode']) ? layout['mode'] : defaults.mode,
    individualDeviceId: isFilledString(device) ? device : null
  }
}

/**
 * Repair the DevTools panel shape.
 *
 * Absent on every document written before this build, so "missing" has to mean
 * the defaults rather than a reset — a field, not a document (see
 * `migratePersistedState`). A junk size is clamped rather than dropped: the
 * user's edge preference is worth keeping even when the number next to it is
 * not.
 */
function sanitizeDevtools(value: unknown): DevtoolsSettings {
  const defaults: DevtoolsSettings = { dock: 'bottom', size: DEFAULT_DOCK_SIZE }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults

  const devtools = value as Record<string, unknown>
  const dock = devtools['dock']
  return {
    dock: dock === 'bottom' || dock === 'right' || dock === 'undocked' ? dock : defaults.dock,
    size: typeof devtools['size'] === 'number' ? clampDockSize(devtools['size']) : defaults.size
  }
}

/**
 * Longest folder path worth keeping. Windows' extended limit is 32 767; this is
 * far past any real folder and far short of something worth storing.
 */
export const MAX_PATH_LENGTH = 1024

/**
 * Whether a stored path is absolute, on either platform's rules.
 *
 * Deliberately not `node:path` — this module is shared with the renderer bundle
 * and imports nothing — and deliberately platform-independent: a profile
 * written on Windows and read on macOS should have the same folder accepted or
 * rejected on both, rather than `C:\shots` silently becoming a relative path
 * that resolves against the working directory. POSIX roots, drive-absolute
 * paths and UNC shares are the three shapes a real folder comes in.
 */
export function isAbsolutePath(value: string): boolean {
  if (value.startsWith('/') || value.startsWith('\\')) return true
  return /^[A-Za-z]:[\\/]/.test(value)
}

/**
 * Repair the screenshot settings.
 *
 * A field, not a document, and every part of it degrades on its own: a junk
 * folder falls back to the default one rather than costing the user their
 * format. A path containing a NUL is not a path — Node throws on it — so it is
 * dropped here instead of at the first capture, and a *relative* one is dropped
 * for the same reason `main/validate` refuses one: the store file is not a
 * trusted input either, and "shots" would resolve against wherever the process
 * happens to have been started.
 */
function sanitizeScreenshots(value: unknown): ScreenshotSettings {
  const defaults: ScreenshotSettings = { directory: '', format: 'png', dpr: 'device' }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults

  const shots = value as Record<string, unknown>
  const directory = shots['directory']
  const format = shots['format']
  const dpr = shots['dpr']

  return {
    directory:
      typeof directory === 'string' &&
      directory.length <= MAX_PATH_LENGTH &&
      !directory.includes('\0') &&
      isAbsolutePath(directory)
        ? directory
        : defaults.directory,
    format: format === 'png' || format === 'jpeg' ? format : defaults.format,
    dpr: dpr === 1 || dpr === 'device' ? dpr : defaults.dpr
  }
}

/** Drop unusable suites; inside a usable one, drop only the junk ids. */
function sanitizeSuites(value: unknown): Suite[] {
  if (!Array.isArray(value)) return []
  const out: Suite[] = []
  const seen = new Set<string>()

  for (const entry of value.slice(0, MAX_SUITES)) {
    if (typeof entry !== 'object' || entry === null) continue
    const suite = entry as Record<string, unknown>
    if (!isFilledString(suite['id']) || seen.has(suite['id'])) continue
    if (!isFilledString(suite['name'])) continue

    const rawIds = Array.isArray(suite['deviceIds']) ? suite['deviceIds'] : []
    const deviceIds: string[] = []
    const seenIds = new Set<string>()
    for (const id of rawIds.slice(0, MAX_DEVICES)) {
      if (!isFilledString(id) || seenIds.has(id)) continue
      seenIds.add(id)
      deviceIds.push(id)
    }

    seen.add(suite['id'])
    out.push({ id: suite['id'], name: suite['name'], deviceIds })
  }
  return out
}
