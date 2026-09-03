/**
 * Payload validation for the channels main *receives* (CLAUDE.md §6).
 *
 * The renderer is typed, but types are a compile-time promise and IPC is a
 * runtime boundary: a compromised renderer can invoke any registered channel
 * with anything at all. Every validator here throws, so the bad call rejects
 * back at its caller instead of reaching `ViewManager` or `nativeTheme`.
 */

import {
  normalizeUrl,
  type ClearTarget,
  type DockPosition,
  type InputEventPayload,
  type ShotRequest,
  type ThemeSource
} from '@shared/ipc'
import {
  clampDockSize,
  isCanvasLayoutMode,
  MAX_BOOKMARKS,
  MAX_PATH_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  type Bookmark,
  type DevtoolsSettings,
  type LayoutSettings,
  type PersistedState,
  type ScreenshotSettings,
  type Suite,
  type SyncSettings
} from '@shared/persistence-types'
import { isAbsolute } from 'node:path'
import type { DeviceSpec, Rect } from '@shared/types'

/** More device views than a canvas could ever show is a bug or an attack. */
const MAX_DEVICES = 64
/** Same order of magnitude: a document with more suites than this is junk. */
const MAX_SUITES = 64
/** A name — of a suite, of a device — is a label, not a payload. */
const MAX_NAME_LENGTH = 200
/** Longer than any user agent Chromium ships, short of a payload. */
const MAX_USER_AGENT_LENGTH = 512
/** Rotation is one flag per device the user ever turned; junk past this is junk. */
const MAX_ROTATED = 256
/** Well past the largest real display, still far short of an allocation bomb. */
const MAX_DIMENSION = 10_000
const MAX_DPR = 10

function fail(what: string): never {
  throw new Error(`Invalid IPC payload: ${what}`)
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Finite, strictly positive, and no larger than `max`. */
function isBounded(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
}

/**
 * Validate a `views:sync-devices` payload. Throws on anything malformed.
 *
 * The returned array is *rebuilt* rather than the caller's own: the payload
 * comes from the renderer and one branch of this ends up on disk, so a device
 * carrying twenty extra keys must not be able to store them there — and a later
 * mutation of the sender's object must not be able to reach what main kept.
 */
export function validateDeviceSpecs(value: unknown): DeviceSpec[] {
  if (!Array.isArray(value)) fail('views:sync-devices expects an array of devices')
  if (value.length > MAX_DEVICES) fail(`views:sync-devices accepts at most ${MAX_DEVICES} devices`)

  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) fail('device must be an object')
    const device = entry as Partial<Record<keyof DeviceSpec, unknown>>

    if (!isFilledString(device.id) || device.id.length > MAX_NAME_LENGTH) {
      fail(`device.id must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`)
    }
    if (!isFilledString(device.name) || device.name.length > MAX_NAME_LENGTH) {
      fail(`device.name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`)
    }
    if (!isFilledString(device.userAgent) || device.userAgent.length > MAX_USER_AGENT_LENGTH) {
      fail(
        `device.userAgent must be a non-empty string of at most ${MAX_USER_AGENT_LENGTH} characters`
      )
    }
    if (!isBounded(device.width, MAX_DIMENSION)) {
      fail(`device.width must be in (0, ${MAX_DIMENSION}]`)
    }
    if (!isBounded(device.height, MAX_DIMENSION)) {
      fail(`device.height must be in (0, ${MAX_DIMENSION}]`)
    }
    if (!isBounded(device.dpr, MAX_DPR)) fail(`device.dpr must be in (0, ${MAX_DPR}]`)
    if (typeof device.touch !== 'boolean') fail('device.touch must be a boolean')

    // Optional on a catalog device, present on a user-defined one.
    const type = device.type
    if (type !== undefined && type !== 'phone' && type !== 'tablet' && type !== 'desktop') {
      fail("device.type must be 'phone', 'tablet' or 'desktop'")
    }
    const rotatable = device.rotatable
    if (rotatable !== undefined && typeof rotatable !== 'boolean') {
      fail('device.rotatable must be a boolean')
    }

    return {
      id: device.id,
      name: device.name,
      width: device.width,
      height: device.height,
      dpr: device.dpr,
      userAgent: device.userAgent,
      touch: device.touch,
      ...(type === undefined ? {} : { type }),
      ...(rotatable === undefined ? {} : { rotatable })
    }
  })
}

function validateSuites(value: unknown): Suite[] {
  if (!Array.isArray(value)) fail('store:save suites must be an array')
  if (value.length > MAX_SUITES) fail(`store:save accepts at most ${MAX_SUITES} suites`)

  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) fail('suite must be an object')
    const suite = entry as Record<string, unknown>

    if (!isFilledString(suite['id'])) fail('suite.id must be a non-empty string')
    if (!isFilledString(suite['name']) || suite['name'].length > MAX_NAME_LENGTH) {
      fail(`suite.name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`)
    }
    if (!Array.isArray(suite['deviceIds'])) fail('suite.deviceIds must be an array')
    if (suite['deviceIds'].length > MAX_DEVICES) {
      fail(`suite.deviceIds accepts at most ${MAX_DEVICES} ids`)
    }
    for (const id of suite['deviceIds']) {
      if (!isFilledString(id)) fail('suite.deviceIds entries must be non-empty strings')
    }

    return {
      id: suite['id'],
      name: suite['name'],
      deviceIds: [...(suite['deviceIds'] as string[])]
    }
  })
}

/**
 * The fields main fills in itself when it merges a renderer patch.
 *
 * Everything here is a value the renderer may *read* but must never *set*: the
 * patch it sends carries a copy, and this is the copy that wins.
 */
export type PersistedPatchContext = {
  /**
   * The screenshots folder main currently holds. The renderer's copy of it is
   * dropped — see `validateScreenshotSettings`.
   */
  screenshotDirectory?: string
}

/**
 * Validate a `store:save` payload.
 *
 * Unknown keys are *dropped* rather than rejected: a newer renderer talking to
 * an older main should degrade, not fail. `schemaVersion` is dropped with them
 * — main owns the version, and a patch that could set it would let a
 * compromised renderer make the next boot discard the user's document. The
 * screenshots folder is dropped for a sharper reason; see below.
 */
export function validatePersistedPatch(
  value: unknown,
  context: PersistedPatchContext = {}
): Partial<PersistedState> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('store:save expects a patch object')
  }
  const patch = value as Record<string, unknown>
  const out: Partial<PersistedState> = {}

  if (patch['customDevices'] !== undefined) {
    out.customDevices = validateDeviceSpecs(patch['customDevices'])
  }
  if (patch['suites'] !== undefined) out.suites = validateSuites(patch['suites'])
  if (patch['activeSuiteId'] !== undefined) {
    if (!isFilledString(patch['activeSuiteId'])) {
      fail('store:save activeSuiteId must be a non-empty string')
    }
    out.activeSuiteId = patch['activeSuiteId']
  }
  if (patch['ui'] !== undefined) {
    const ui = patch['ui']
    if (typeof ui !== 'object' || ui === null || Array.isArray(ui)) {
      fail('store:save ui must be an object')
    }
    out.ui = { theme: validateThemeSource((ui as Record<string, unknown>)['theme']) }
  }
  if (patch['sync'] !== undefined) out.sync = validateSyncSettings(patch['sync'])
  if (patch['rotated'] !== undefined) out.rotated = validateRotated(patch['rotated'])
  if (patch['layout'] !== undefined) out.layout = validateLayoutSettings(patch['layout'])
  if (patch['devtools'] !== undefined) out.devtools = validateDevtoolsSettings(patch['devtools'])
  if (patch['screenshots'] !== undefined) {
    out.screenshots = validateScreenshotSettings(patch['screenshots'], context.screenshotDirectory)
  }
  if (patch['bookmarks'] !== undefined) out.bookmarks = validateBookmarks(patch['bookmarks'])
  if (patch['homeUrl'] !== undefined) out.homeUrl = validateHomeUrl(patch['homeUrl'])

  return out
}

/**
 * Validate the persisted bookmark list.
 *
 * Every url is put through `normalizeUrl` and the *normalized* one is stored:
 * this list is a set of things a view will later be told to load, so "it
 * parsed" is not the bar — it has to be a url a device view is allowed to open
 * at all (spec §7a). A junk entry throws rather than being skipped, unlike the
 * disk-repair path: this payload comes from code, not from a file someone
 * edited, and a renderer sending one is a bug worth surfacing.
 */
export function validateBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) fail('store:save bookmarks must be an array')
  if (value.length > MAX_BOOKMARKS) {
    fail(`store:save accepts at most ${MAX_BOOKMARKS} bookmarks`)
  }

  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) fail('bookmark must be an object')
    const bookmark = entry as Record<string, unknown>

    if (!isFilledString(bookmark['id']) || bookmark['id'].length > MAX_NAME_LENGTH) {
      fail('bookmark.id must be a non-empty string')
    }
    const title = bookmark['title']
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      fail(`bookmark.title must be a string of at most ${MAX_TITLE_LENGTH} characters`)
    }
    const rawUrl = bookmark['url']
    if (!isFilledString(rawUrl) || rawUrl.length > MAX_URL_LENGTH) {
      fail(`bookmark.url must be a non-empty string of at most ${MAX_URL_LENGTH} characters`)
    }
    const url = normalizeUrl(rawUrl)
    if (url === null) fail('bookmark.url is not a url a device view could load')

    const addedAt = bookmark['addedAt']
    if (typeof addedAt !== 'number' || !Number.isFinite(addedAt) || addedAt < 0) {
      fail('bookmark.addedAt must be a non-negative timestamp')
    }

    return { id: bookmark['id'], title, url, addedAt }
  })
}

/** Validate the persisted home page: a loadable url, or `''` for none. */
export function validateHomeUrl(value: unknown): string {
  if (value === '') return ''
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    fail(`store:save homeUrl must be a string of at most ${MAX_URL_LENGTH} characters`)
  }
  const url = normalizeUrl(value)
  if (url === null) fail('store:save homeUrl is not a url a device view could load')
  return url
}

/**
 * Validate a `history:query` prefix.
 *
 * Nothing is looked up by it and nothing is executed with it — it is matched
 * against strings — so the only thing worth refusing is a payload big enough to
 * be an attack on the matcher itself.
 */
export function validateHistoryQuery(value: unknown): string {
  if (typeof value !== 'string') fail('history:query expects a string')
  if (value.length > MAX_URL_LENGTH) fail('history:query prefix is too long')
  return value
}

/** Validate a `data:clear` target. */
export function validateClearTarget(value: unknown): ClearTarget {
  if (value !== 'storage' && value !== 'cookies' && value !== 'cache' && value !== 'all') {
    fail("data:clear expects 'storage', 'cookies', 'cache' or 'all'")
  }
  return value
}

/**
 * Validate the persisted screenshot settings.
 *
 * The folder is *not* taken from the patch at all. It is the one string in this
 * document main turns into a path it writes to, and a validator is a shape
 * check, not an authorization: a renderer that could set it could point the
 * next capture — and, through `shot:reveal`, the folder-containment check that
 * guards `showItemInFolder` — at any path on the machine, a UNC share included.
 * So the field is dropped here and main merges the value it already holds
 * (`current`), which only `shot:choose-dir` can move. Format and density are
 * ordinary preferences and come from the renderer as before.
 */
function validateScreenshotSettings(value: unknown, current = ''): ScreenshotSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('store:save screenshots must be an object')
  }
  const shots = value as Record<string, unknown>

  return {
    directory: current,
    format: validateShotFormat(shots['format']),
    dpr: validateShotDpr(shots['dpr'])
  }
}

/**
 * A folder to write screenshots into: absolute, sane length, no NUL.
 *
 * The one door left for this value is `shot:choose-dir`, where it comes back
 * out of a system dialog the user drove — and it is checked even there, because
 * "the OS gave it to us" is a reason to expect a good path, not to skip the
 * check that keeps a relative one from resolving against the working directory.
 */
export function validateScreenshotDirectory(value: unknown): string {
  if (value === '') return ''
  if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH) {
    fail(`screenshots.directory must be a string of at most ${MAX_PATH_LENGTH} characters`)
  }
  if (value.includes('\0')) fail('screenshots.directory must not contain NUL')
  if (!isAbsolute(value)) fail('screenshots.directory must be an absolute path')
  return value
}

function validateShotFormat(value: unknown): 'png' | 'jpeg' {
  if (value !== 'png' && value !== 'jpeg') fail("screenshot format must be 'png' or 'jpeg'")
  return value
}

function validateShotDpr(value: unknown): 'device' | 1 {
  if (value !== 'device' && value !== 1) fail("screenshot dpr must be 'device' or 1")
  return value
}

/**
 * Validate a `shot:device` / `shot:all` request.
 *
 * `format` and `dpr` are optional — main fills them from the saved settings —
 * but a *present* one still has to be one of the two values each accepts:
 * `format` reaches `Page.captureScreenshot` and decides a file extension.
 */
export function validateShotRequest(value: unknown): ShotRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('screenshot request must be an object')
  }
  const request = value as Record<string, unknown>
  if (typeof request['fullPage'] !== 'boolean') fail('screenshot fullPage must be a boolean')

  return {
    fullPage: request['fullPage'],
    ...(request['format'] === undefined ? {} : { format: validateShotFormat(request['format']) }),
    ...(request['dpr'] === undefined ? {} : { dpr: validateShotDpr(request['dpr']) })
  }
}

/**
 * Validate a `shot:reveal` path.
 *
 * Only the *shape* is checked here; whether it points inside the screenshots
 * folder is `ScreenshotQueue.reveal`'s job, because only it knows where that
 * folder currently is.
 */
export function validateShotPath(value: unknown): string {
  if (!isFilledString(value) || value.length > MAX_PATH_LENGTH) {
    fail(`shot:reveal expects a path of at most ${MAX_PATH_LENGTH} characters`)
  }
  if (value.includes('\0')) fail('shot:reveal path must not contain NUL')
  return value
}

/**
 * Validate the persisted canvas layout.
 *
 * The device id is a *label* here, not something main resolves: nothing on this
 * side looks a device up by it, the renderer falls back to the first frame when
 * it names nothing, and `null` is the honest way to say "no preference". So it
 * is length-checked like every other id and otherwise passed through.
 */
function validateLayoutSettings(value: unknown): LayoutSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('store:save layout must be an object')
  }
  const layout = value as Record<string, unknown>
  const mode = layout['mode']
  if (!isCanvasLayoutMode(mode)) fail('store:save layout.mode is not a known layout')

  const device = layout['individualDeviceId']
  if (device !== null && device !== undefined && !isFilledString(device)) {
    fail('store:save layout.individualDeviceId must be a device id or null')
  }
  if (typeof device === 'string' && device.length > MAX_NAME_LENGTH) {
    fail('store:save layout.individualDeviceId is too long')
  }

  return { mode, individualDeviceId: typeof device === 'string' ? device : null }
}

/** Validate the persisted DevTools panel shape. The size is clamped, not rejected. */
function validateDevtoolsSettings(value: unknown): DevtoolsSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('store:save devtools must be an object')
  }
  const devtools = value as Record<string, unknown>
  const size = devtools['size']
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    fail('store:save devtools.size must be a finite number')
  }
  return { dock: validateDockPosition(devtools['dock']), size: clampDockSize(size) }
}

/** Validate the per-device orientation map: `{ [deviceId]: isLandscape }`. */
function validateRotated(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('store:save rotated must be an object')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_ROTATED) {
    fail(`store:save rotated accepts at most ${MAX_ROTATED} devices`)
  }

  const out: Record<string, boolean> = {}
  for (const [id, landscape] of entries) {
    if (id.length === 0 || id.length > MAX_NAME_LENGTH) {
      fail('store:save rotated keys must be device ids')
    }
    if (typeof landscape !== 'boolean') fail('store:save rotated values must be booleans')
    out[id] = landscape
  }
  return out
}

function validateSyncSettings(value: unknown): SyncSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('store:save sync must be an object')
  }
  const sync = value as Record<string, unknown>

  if (typeof sync['enabled'] !== 'boolean') fail('store:save sync.enabled must be a boolean')
  if (!Array.isArray(sync['disabledDeviceIds'])) {
    fail('store:save sync.disabledDeviceIds must be an array')
  }
  if (sync['disabledDeviceIds'].length > MAX_DEVICES) {
    fail(`store:save sync.disabledDeviceIds accepts at most ${MAX_DEVICES} ids`)
  }
  for (const id of sync['disabledDeviceIds']) {
    if (!isFilledString(id) || id.length > MAX_NAME_LENGTH) {
      fail('store:save sync.disabledDeviceIds entries must be non-empty strings')
    }
  }

  return {
    enabled: sync['enabled'],
    disabledDeviceIds: [...(sync['disabledDeviceIds'] as string[])]
  }
}

/**
 * Validate a `sync:set-lead` payload: a device id, or `null` for "no lead".
 *
 * The id is not checked against the live registry — the engine ignores one it
 * does not know, and a lead elected a frame before its view finishes
 * registering is a race, not an attack.
 */
export function validateLeadDeviceId(value: unknown): string | null {
  if (value === null) return null
  if (!isFilledString(value) || value.length > MAX_NAME_LENGTH) {
    fail('sync:set-lead expects a device id or null')
  }
  return value
}

/** Validate the device id argument of `sync:set-enabled`. */
export function validateDeviceId(value: unknown): string {
  if (!isFilledString(value) || value.length > MAX_NAME_LENGTH) {
    fail('sync:set-enabled expects a device id')
  }
  return value
}

/** Validate a boolean argument. `what` names the channel for the error. */
export function validateBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} expects a boolean`)
  return value
}

/** Ceiling on one frame's worth of input. Matches the preload's own cap. */
const MAX_INPUT_BATCH = 64
/** No real `KeyboardEvent.key` or `.code` is longer than this. */
const MAX_KEY_LENGTH = 32
/** Alt | Ctrl | Meta | Shift — CDP defines no other modifier bits. */
const MAX_MODIFIERS = 15

function clamp01(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function validateInputEvent(entry: unknown): InputEventPayload | null {
  if (typeof entry !== 'object' || entry === null) return null
  const event = entry as Record<string, unknown>

  if (event['kind'] === 'scroll') {
    const ratioX = clamp01(event['ratioX'])
    const ratioY = clamp01(event['ratioY'])
    if (ratioX === null || ratioY === null) return null
    return { kind: 'scroll', ratioX, ratioY }
  }

  if (event['kind'] === 'mouse') {
    const xNorm = clamp01(event['xNorm'])
    const yNorm = clamp01(event['yNorm'])
    if (xNorm === null || yNorm === null) return null
    if (event['type'] !== 'down' && event['type'] !== 'up') return null
    const button = event['button']
    if (button !== 'left' && button !== 'middle' && button !== 'right') return null
    return { kind: 'mouse', type: event['type'], xNorm, yNorm, button }
  }

  if (event['kind'] === 'key') {
    if (event['type'] !== 'down' && event['type'] !== 'up') return null
    const key = event['key']
    const code = event['code']
    if (!isFilledString(key) || key.length > MAX_KEY_LENGTH) return null
    if (typeof code !== 'string' || code.length > MAX_KEY_LENGTH) return null
    const modifiers = event['modifiers']
    if (typeof modifiers !== 'number' || !Number.isInteger(modifiers)) return null
    if (modifiers < 0 || modifiers > MAX_MODIFIERS) return null
    return { kind: 'key', type: event['type'], key, code, modifiers }
  }

  return null
}

/**
 * Validate a `sync:input` batch.
 *
 * Unlike the invoke channels this one *drops* rather than throws. The sender is
 * an arbitrary web page reached through a one-way `send`: there is no promise
 * to reject, an exception here would surface as an unhandled error in main, and
 * a page that can make main log on demand is a nuisance of its own. Malformed
 * entries simply never reach the engine.
 */
export function validateSyncInputBatch(value: unknown): InputEventPayload[] {
  if (!Array.isArray(value)) return []

  const out: InputEventPayload[] = []
  for (const entry of value.slice(0, MAX_INPUT_BATCH)) {
    const event = validateInputEvent(entry)
    if (event !== null) out.push(event)
  }
  return out
}

/** Validate a `devtools:set-dock` payload (and the persisted mirror of it). */
export function validateDockPosition(value: unknown): DockPosition {
  if (value !== 'bottom' && value !== 'right' && value !== 'undocked') {
    fail("devtools:set-dock expects 'bottom', 'right' or 'undocked'")
  }
  return value
}

/**
 * Validate a `devtools:close` payload: a device id, or `null` for "the dock".
 *
 * Not checked against the live device set — the manager ignores an id it never
 * opened, and closing a panel that is already gone is a race, not an attack.
 */
export function validateOptionalDeviceId(value: unknown): string | null {
  if (value === null) return null
  if (!isFilledString(value) || value.length > MAX_NAME_LENGTH) {
    fail('devtools:close expects a device id or null')
  }
  return value
}

/**
 * Validate a `devtools:set-bounds` rect.
 *
 * A rect straight out of `getBoundingClientRect`: fractional, possibly negative
 * while the panel animates in, and never larger than a display. It is rounded
 * here rather than in main's hot path — `setBounds` takes integers, and a
 * fractional one would leave a hairline of window showing through the panel.
 */
export function validateBounds(value: unknown): Rect {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('devtools:set-bounds expects a rect')
  }
  const rect = value as Record<string, unknown>
  const out: Record<'x' | 'y' | 'width' | 'height', number> = { x: 0, y: 0, width: 0, height: 0 }

  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const side = rect[key]
    if (typeof side !== 'number' || !Number.isFinite(side) || Math.abs(side) > MAX_BOUNDS) {
      fail(`devtools:set-bounds ${key} must be a finite number within ±${MAX_BOUNDS}`)
    }
    out[key] = Math.round(side)
  }
  // A negative extent is not a small panel, it is a malformed one.
  if (out.width < 0 || out.height < 0) fail('devtools:set-bounds extents must not be negative')
  return out
}

/** Far outside any display arrangement, far short of an overflow. */
const MAX_BOUNDS = 100_000

/** Validate a `theme:set-source` payload. Throws on anything else. */
export function validateThemeSource(value: unknown): ThemeSource {
  if (value !== 'light' && value !== 'dark' && value !== 'system') {
    fail("theme:set-source expects 'light', 'dark' or 'system'")
  }
  return value
}
