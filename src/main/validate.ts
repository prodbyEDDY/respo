/**
 * Payload validation for the channels main *receives* (CLAUDE.md §6).
 *
 * The renderer is typed, but types are a compile-time promise and IPC is a
 * runtime boundary: a compromised renderer can invoke any registered channel
 * with anything at all. Every validator here throws, so the bad call rejects
 * back at its caller instead of reaching `ViewManager` or `nativeTheme`.
 */

import type { DockPosition, InputEventPayload, ThemeSource } from '@shared/ipc'
import {
  clampDockSize,
  type DevtoolsSettings,
  type PersistedState,
  type Suite,
  type SyncSettings
} from '@shared/persistence-types'
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
 * Validate a `store:save` payload.
 *
 * Unknown keys are *dropped* rather than rejected: a newer renderer talking to
 * an older main should degrade, not fail. `schemaVersion` is dropped with them
 * — main owns the version, and a patch that could set it would let a
 * compromised renderer make the next boot discard the user's document.
 */
export function validatePersistedPatch(value: unknown): Partial<PersistedState> {
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
  if (patch['devtools'] !== undefined) out.devtools = validateDevtoolsSettings(patch['devtools'])

  return out
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
