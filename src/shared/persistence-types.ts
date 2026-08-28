/**
 * The shape Respo keeps on disk, and the pure functions that reason about it.
 *
 * Nothing here touches Electron or the filesystem: main owns the store (rule
 * §7 — the renderer never writes disk), but both sides need the same
 * vocabulary, and the merge/migration logic is where the bugs would be, so it
 * lives somewhere a unit test can reach it.
 */

import { DEFAULT_ACTIVE_DEVICE_IDS } from './deviceCatalog'
import type { ThemeSource } from './ipc'
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

export type PersistedState = {
  schemaVersion: number
  customDevices: DeviceSpec[]
  suites: Suite[]
  activeSuiteId: string
  ui: { theme: ThemeSource }
}

export const DEFAULT_SUITE_ID = 'default'
export const DEFAULT_SUITE_NAME = 'Default'

/** Guard rails for anything read back off disk. Same spirit as `main/validate`. */
const MAX_DEVICES = 64
const MAX_SUITES = 64
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
    ui: { theme: 'system' }
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
      ui: { theme: sanitizeTheme((doc['ui'] as Record<string, unknown> | undefined)?.['theme']) }
    },
    backup: null
  }
}

function cloneSuite(suite: Suite): Suite {
  return { id: suite.id, name: suite.name, deviceIds: [...suite.deviceIds] }
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
    out.push({
      id: device['id'],
      name: device['name'],
      width: device['width'],
      height: device['height'],
      dpr: device['dpr'],
      userAgent: device['userAgent'],
      touch: device['touch']
    })
  }
  return out
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
