/**
 * Payload validation for the channels main *receives* (CLAUDE.md §6).
 *
 * The renderer is typed, but types are a compile-time promise and IPC is a
 * runtime boundary: a compromised renderer can invoke any registered channel
 * with anything at all. Every validator here throws, so the bad call rejects
 * back at its caller instead of reaching `ViewManager` or `nativeTheme`.
 */

import type { ThemeSource } from '@shared/ipc'
import type { PersistedState, Suite } from '@shared/persistence-types'
import type { DeviceSpec } from '@shared/types'

/** More device views than a canvas could ever show is a bug or an attack. */
const MAX_DEVICES = 64
/** Same order of magnitude: a document with more suites than this is junk. */
const MAX_SUITES = 64
/** A suite name is a label, not a payload. */
const MAX_NAME_LENGTH = 200
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

/** Validate a `views:sync-devices` payload. Throws on anything malformed. */
export function validateDeviceSpecs(value: unknown): DeviceSpec[] {
  if (!Array.isArray(value)) fail('views:sync-devices expects an array of devices')
  if (value.length > MAX_DEVICES) fail(`views:sync-devices accepts at most ${MAX_DEVICES} devices`)

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) fail('device must be an object')
    const device = entry as Partial<Record<keyof DeviceSpec, unknown>>

    if (!isFilledString(device.id)) fail('device.id must be a non-empty string')
    if (!isFilledString(device.name)) fail('device.name must be a non-empty string')
    if (!isFilledString(device.userAgent)) fail('device.userAgent must be a non-empty string')
    if (!isBounded(device.width, MAX_DIMENSION)) {
      fail(`device.width must be in (0, ${MAX_DIMENSION}]`)
    }
    if (!isBounded(device.height, MAX_DIMENSION)) {
      fail(`device.height must be in (0, ${MAX_DIMENSION}]`)
    }
    if (!isBounded(device.dpr, MAX_DPR)) fail(`device.dpr must be in (0, ${MAX_DPR}]`)
    if (typeof device.touch !== 'boolean') fail('device.touch must be a boolean')
  }

  return value as DeviceSpec[]
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

  return out
}

/** Validate a `theme:set-source` payload. Throws on anything else. */
export function validateThemeSource(value: unknown): ThemeSource {
  if (value !== 'light' && value !== 'dark' && value !== 'system') {
    fail("theme:set-source expects 'light', 'dark' or 'system'")
  }
  return value
}
