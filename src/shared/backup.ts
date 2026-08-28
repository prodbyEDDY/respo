/**
 * Import and export of a Respo document: the user's own devices and their
 * suites, as one portable file.
 *
 * Everything here is pure. The renderer never touches disk (CLAUDE.md §7), main
 * owns the file dialogs — but *both* sides have to agree on what a backup is,
 * and main has to be able to refuse a malformed one before it reaches the
 * store, so the shape, the validator and the merge live together in `@shared`
 * where a unit test can reach them.
 *
 * What a backup deliberately does not carry: the theme, the mirroring switches,
 * the active suite, or anything about the session. A file someone mails to a
 * colleague should add devices to their setup, not take over their window.
 */

import { CUSTOM_ID_PREFIX, makeCustomDeviceId } from './custom-devices'
import { deviceById } from './deviceCatalog'
import { makeSuiteId, type Suite } from './persistence-types'
import type { DeviceSpec } from './types'

/** Bumped whenever a written file stops being readable by this code. */
export const BACKUP_VERSION = 1

/** The on-disk shape. Written by `serializeBackup`, read by `parseBackup`. */
export type RespoBackupV1 = {
  version: typeof BACKUP_VERSION
  customDevices: DeviceSpec[]
  suites: Suite[]
}

/** The slice of the document a backup is made of. */
export type BackupSource = {
  customDevices: readonly DeviceSpec[]
  suites: readonly Suite[]
}

/**
 * Guard rails, the same order of magnitude as `main/validate` and the store's
 * own caps: an import must never be able to grow a document past what the rest
 * of the app is willing to hold.
 */
const MAX_DEVICES = 64
const MAX_SUITES = 64
const MAX_NAME_LENGTH = 200
const MAX_USER_AGENT_LENGTH = 512
const MAX_DIMENSION = 10_000
const MAX_DPR = 10

export type BackupParseResult = { ok: true; backup: RespoBackupV1 } | { ok: false; error: string }

function isFilledString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isBounded(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
}

function cloneDevice(device: DeviceSpec): DeviceSpec {
  return { ...device }
}

function cloneSuite(suite: Suite): Suite {
  return { id: suite.id, name: suite.name, deviceIds: [...suite.deviceIds] }
}

/** Take a snapshot of the document's portable half. */
export function serializeBackup(state: BackupSource): RespoBackupV1 {
  return {
    version: BACKUP_VERSION,
    // Copied, not aliased: the file is written a tick later and the store keeps
    // moving underneath.
    customDevices: state.customDevices.map(cloneDevice),
    suites: state.suites.map(cloneSuite)
  }
}

function readDevice(entry: unknown, index: number): DeviceSpec | string {
  const at = `customDevices[${index}]`
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return `${at} is not a device`
  }
  const device = entry as Record<string, unknown>

  if (!isFilledString(device['id'], MAX_NAME_LENGTH)) return `${at}.id must be a name-length string`
  if (!isFilledString(device['name'], MAX_NAME_LENGTH)) return `${at}.name must be a string`
  if (!isFilledString(device['userAgent'], MAX_USER_AGENT_LENGTH)) {
    return `${at}.userAgent must be a string`
  }
  if (!isBounded(device['width'], MAX_DIMENSION)) return `${at}.width is out of range`
  if (!isBounded(device['height'], MAX_DIMENSION)) return `${at}.height is out of range`
  if (!isBounded(device['dpr'], MAX_DPR)) return `${at}.dpr is out of range`
  if (typeof device['touch'] !== 'boolean') return `${at}.touch must be a boolean`

  const type = device['type']
  if (type !== undefined && type !== 'phone' && type !== 'tablet' && type !== 'desktop') {
    return `${at}.type is not a device type`
  }
  const rotatable = device['rotatable']
  if (rotatable !== undefined && typeof rotatable !== 'boolean') {
    return `${at}.rotatable must be a boolean`
  }

  return {
    id: device['id'],
    name: device['name'],
    width: device['width'],
    height: device['height'],
    dpr: device['dpr'],
    userAgent: device['userAgent'],
    touch: device['touch'],
    ...(type === undefined ? {} : { type }),
    ...(rotatable === undefined ? {} : { rotatable })
  }
}

function readSuite(entry: unknown, index: number): Suite | string {
  const at = `suites[${index}]`
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return `${at} is not a suite`
  }
  const suite = entry as Record<string, unknown>

  if (!isFilledString(suite['id'], MAX_NAME_LENGTH)) return `${at}.id must be a string`
  if (!isFilledString(suite['name'], MAX_NAME_LENGTH)) return `${at}.name must be a string`
  if (!Array.isArray(suite['deviceIds'])) return `${at}.deviceIds must be an array`
  if (suite['deviceIds'].length > MAX_DEVICES) return `${at}.deviceIds is too long`

  const deviceIds: string[] = []
  for (const id of suite['deviceIds']) {
    if (!isFilledString(id, MAX_NAME_LENGTH)) return `${at}.deviceIds holds something else`
    deviceIds.push(id)
  }

  return { id: suite['id'], name: suite['name'], deviceIds }
}

/**
 * Validate an already-parsed value.
 *
 * Strict on purpose, and unlike `migratePersistedState` it repairs nothing: a
 * document Respo wrote itself can be trusted to be whole, so anything that is
 * not says the file is damaged or is not a Respo backup at all. Half an import
 * is worse than a refused one — the user still has the file.
 *
 * Unknown *top-level* keys are the one exception: they are dropped, so a file
 * written by a later build (which may annotate it) still imports here.
 */
export function validateBackup(value: unknown): BackupParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'This is not a Respo backup file.' }
  }
  const doc = value as Record<string, unknown>

  if (doc['version'] !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `Unsupported backup version: expected ${BACKUP_VERSION}, found ${String(doc['version'])}.`
    }
  }
  if (!Array.isArray(doc['customDevices'])) {
    return { ok: false, error: 'customDevices must be an array.' }
  }
  if (!Array.isArray(doc['suites'])) return { ok: false, error: 'suites must be an array.' }
  if (doc['customDevices'].length > MAX_DEVICES) {
    return { ok: false, error: `A backup holds at most ${MAX_DEVICES} devices.` }
  }
  if (doc['suites'].length > MAX_SUITES) {
    return { ok: false, error: `A backup holds at most ${MAX_SUITES} suites.` }
  }

  const customDevices: DeviceSpec[] = []
  for (const [index, entry] of doc['customDevices'].entries()) {
    const device = readDevice(entry, index)
    if (typeof device === 'string') return { ok: false, error: device }
    customDevices.push(device)
  }

  const suites: Suite[] = []
  for (const [index, entry] of doc['suites'].entries()) {
    const suite = readSuite(entry, index)
    if (typeof suite === 'string') return { ok: false, error: suite }
    suites.push(suite)
  }

  return { ok: true, backup: { version: BACKUP_VERSION, customDevices, suites } }
}

/** Read a file's text. Never throws — a damaged file is an answer, not a crash. */
export function parseBackup(json: string): BackupParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  return validateBackup(parsed)
}

export type BackupMergeResult = {
  customDevices: DeviceSpec[]
  suites: Suite[]
  devicesAdded: number
  devicesReplaced: number
  /** Devices dropped because the document was already at its cap. */
  devicesSkipped: number
  suitesAdded: number
  suitesReplaced: number
  /** Suites dropped because nothing in them resolved, or the caps were full. */
  suitesSkipped: number
}

/** Names are how a backup and a document recognise each other. */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Fold a backup into the document that is already there.
 *
 * Merge by name, overwriting: a device or suite the user already has under the
 * imported name is *updated in place*, keeping its id. Ids are what suites (and
 * the mirroring switches, and the rotation map) point at, so replacing a device
 * wholesale would silently empty every suite that named it. Anything whose name
 * is new is appended.
 *
 * Nothing is ever deleted by an import. Devices and suites the file does not
 * mention are the user's, and a file they were handed does not get to drop them.
 */
export function mergeBackup(current: BackupSource, incoming: RespoBackupV1): BackupMergeResult {
  const customDevices = current.customDevices.map(cloneDevice)
  const suites = current.suites.map(cloneSuite)

  const byName = new Map(customDevices.map((d, index) => [nameKey(d.name), index]))
  const takenDeviceIds = new Set(customDevices.map((d) => d.id))
  /** Imported id -> the id that device actually has in this document. */
  const idMap = new Map<string, string>()

  let devicesAdded = 0
  let devicesReplaced = 0
  let devicesSkipped = 0

  for (const device of incoming.customDevices) {
    const existingIndex = byName.get(nameKey(device.name))
    if (existingIndex !== undefined) {
      const kept = customDevices[existingIndex] as DeviceSpec
      // Everything but the id: the id is this document's, not the file's.
      customDevices[existingIndex] = { ...cloneDevice(device), id: kept.id }
      idMap.set(device.id, kept.id)
      devicesReplaced += 1
      continue
    }

    // Counted, not silent: the suites that named this device will come out
    // shorter, and the user is owed the reason.
    if (customDevices.length >= MAX_DEVICES) {
      devicesSkipped += 1
      continue
    }

    // Keep the file's own id when it is free and namespaced — a backup restored
    // onto a clean document should come back exactly as it left.
    const id =
      device.id.startsWith(CUSTOM_ID_PREFIX) &&
      !takenDeviceIds.has(device.id) &&
      deviceById(device.id) === undefined
        ? device.id
        : makeCustomDeviceId(device.name, takenDeviceIds)

    takenDeviceIds.add(id)
    // Recorded even when the id came through unchanged: the imported suites are
    // rewritten through this map, and an entry missing here would fall through
    // to the raw id — which may belong to somebody else's device entirely.
    idMap.set(device.id, id)
    byName.set(nameKey(device.name), customDevices.length)
    customDevices.push({ ...cloneDevice(device), id })
    devicesAdded += 1
  }

  const localById = new Set(customDevices.map((d) => d.id))
  const suiteByName = new Map(suites.map((s, index) => [nameKey(s.name), index]))
  const takenSuiteIds = new Set(suites.map((s) => s.id))

  let suitesAdded = 0
  let suitesReplaced = 0
  let suitesSkipped = 0

  for (const suite of incoming.suites) {
    const deviceIds: string[] = []
    const seen = new Set<string>()
    for (const raw of suite.deviceIds) {
      const id = idMap.get(raw) ?? raw
      // A catalog device, or one this document already had. Anything else was
      // never imported (a full document, a device dropped by the cap) and would
      // resolve to an empty frame.
      if (deviceById(id) === undefined && !localById.has(id)) continue
      if (seen.has(id)) continue
      seen.add(id)
      deviceIds.push(id)
    }

    if (deviceIds.length === 0) {
      suitesSkipped += 1
      continue
    }

    const existingIndex = suiteByName.get(nameKey(suite.name))
    if (existingIndex !== undefined) {
      const kept = suites[existingIndex] as Suite
      suites[existingIndex] = { id: kept.id, name: kept.name, deviceIds }
      suitesReplaced += 1
      continue
    }

    if (suites.length >= MAX_SUITES) {
      suitesSkipped += 1
      continue
    }

    const id =
      takenSuiteIds.has(suite.id) || suite.id === ''
        ? makeSuiteId(suite.name, takenSuiteIds)
        : suite.id
    takenSuiteIds.add(id)
    suiteByName.set(nameKey(suite.name), suites.length)
    suites.push({ id, name: suite.name, deviceIds })
    suitesAdded += 1
  }

  return {
    customDevices,
    suites,
    devicesAdded,
    devicesReplaced,
    devicesSkipped,
    suitesAdded,
    suitesReplaced,
    suitesSkipped
  }
}
