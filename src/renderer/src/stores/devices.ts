import { create } from 'zustand'
import { mergeBackup, type BackupMergeResult, type RespoBackupV1 } from '@shared/backup'
import {
  catalogWithCustom,
  makeCustomDeviceId,
  type CustomDeviceInput
} from '@shared/custom-devices'
import { DEFAULT_ACTIVE_DEVICE_IDS, deviceById } from '@shared/deviceCatalog'
import {
  DEFAULT_SUITE_ID,
  defaultPersistedState,
  makeSuiteId,
  type PersistedState,
  type Suite
} from '@shared/persistence-types'
import type { DeviceSpec } from '@shared/types'
import { savePersistedState } from '@renderer/lib/persistence'

/** Ceiling shared with main's `store:save` validator. */
const MAX_CUSTOM_DEVICES = 64
/** The same ceiling for suites. A document past it is junk, not a workflow. */
const MAX_SUITES = 64
/** A suite name is a label; the field is capped so it stays one. */
export const MAX_SUITE_NAME_LENGTH = 60

/**
 * What a new suite starts with.
 *
 * A suite has to hold at least one device — an empty canvas is a dead end — so
 * "New suite" cannot mean "nothing". The most common phone is the least
 * surprising thing to find there, and it is one click to swap.
 */
export const NEW_SUITE_DEVICE_ID = 'iphone-15-pro'

/**
 * Why a device mutation was refused.
 *
 * - `unknown-device`: nothing answers to that id.
 * - `last-in-suite`: removing it would leave the active suite with no devices,
 *   and a canvas with nothing on it is not a state the user asked for.
 * - `too-many`: the document's own cap on custom devices.
 */
export type DeviceMutationError = 'unknown-device' | 'last-in-suite' | 'too-many'

export type DeviceMutationResult =
  { ok: true; device: DeviceSpec } | { ok: false; reason: DeviceMutationError }

/**
 * Why a suite mutation was refused.
 *
 * - `unknown-suite` / `unknown-device`: nothing answers to that id.
 * - `last-suite`: the document always keeps one suite to fall back to.
 * - `last-in-suite`: a suite always keeps one device (see `DeviceMutationError`).
 * - `invalid-name` / `duplicate-name`: the name is empty, too long, or taken.
 *   Names are how suites are told apart — in the selector, and when a backup is
 *   merged into an existing document.
 * - `too-many`: the document's own cap on suites.
 */
export type SuiteMutationError =
  | 'unknown-suite'
  | 'unknown-device'
  | 'last-suite'
  | 'last-in-suite'
  | 'invalid-name'
  | 'duplicate-name'
  | 'too-many'

export type SuiteMutationResult =
  { ok: true; suite: Suite } | { ok: false; reason: SuiteMutationError }

export interface DevicesState {
  /** Devices currently on the canvas, in display order. */
  active: DeviceSpec[]
  /** Every saved suite, in the order the user arranged them. */
  suites: Suite[]
  /** The suite `active` is resolved from. */
  activeSuiteId: string
  /** User-defined devices, resolvable by id alongside the catalog. */
  customDevices: DeviceSpec[]
  /** The catalog followed by `customDevices`. Kept in step with it. */
  allDevices: DeviceSpec[]

  /**
   * Replace the selection. Unknown ids are dropped and duplicates collapsed, so
   * whatever a picker (or a restored session) hands over is safe to pass in.
   * The result becomes the active suite's composition and is persisted.
   */
  setActive: (ids: string[]) => void
  /** Switch which suite the canvas shows. Unknown ids are ignored. */
  setActiveSuite: (id: string) => void
  /** Install the document main restored at boot. Writes nothing back. */
  hydrate: (state: PersistedState) => void

  /**
   * Add a user-defined device and put it on the canvas.
   *
   * Joining the active suite is the point: a device the user just described and
   * then has to go and find is a second step for no reason. (Suite membership
   * gets its own UI in the next task; this is the sensible default until then.)
   */
  addCustom: (input: CustomDeviceInput) => DeviceMutationResult
  /** Rewrite one user-defined device in place, keeping its id and placement. */
  updateCustom: (id: string, input: CustomDeviceInput) => DeviceMutationResult
  /** Delete a user-defined device and drop it from every suite. */
  removeCustom: (id: string) => DeviceMutationResult

  /** Add a suite holding one device and switch to it. Names must be distinct. */
  createSuite: (name: string) => SuiteMutationResult
  /** Delete a suite. The last one cannot go; the active one hands over first. */
  deleteSuite: (id: string) => SuiteMutationResult
  /**
   * Put a device in the active suite, or take it out — the one control suite
   * membership needs. Appends at the end, which is where the eye expects a
   * device that was just added to appear.
   */
  toggleDeviceInSuite: (deviceId: string) => SuiteMutationResult
  /** Move a device within the active suite. Canvas order *is* suite order. */
  reorderSuiteDevices: (from: number, to: number) => void

  /**
   * Fold an imported backup into the document. Merges by name, deletes nothing,
   * and reports what it did so the UI can say so.
   */
  importBackup: (backup: RespoBackupV1) => BackupMergeResult
  /** Throw the document away: the default suite, and no devices of your own. */
  reset: () => void
}

function sameSelection(a: readonly DeviceSpec[], b: readonly DeviceSpec[]): boolean {
  return a.length === b.length && a.every((device, i) => device === b[i])
}

/**
 * Resolve ids against the catalog *and* the user's own devices, keeping the
 * caller's order, skipping ids nothing answers to and collapsing duplicates —
 * one device never gets two views.
 */
function resolveDevices(ids: readonly string[], custom: readonly DeviceSpec[]): DeviceSpec[] {
  const byId = new Map(custom.map((d) => [d.id, d]))
  const seen = new Set<string>()
  const out: DeviceSpec[] = []

  for (const id of ids) {
    if (seen.has(id)) continue
    const device = byId.get(id) ?? deviceById(id)
    if (device === undefined) continue
    seen.add(id)
    out.push(device)
  }
  return out
}

function suiteById(suites: readonly Suite[], id: string): Suite | undefined {
  return suites.find((s) => s.id === id)
}

/** Names are compared the way a person compares them. */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Rewrite one suite in a list, leaving the others by identity. */
function withSuite(suites: readonly Suite[], id: string, deviceIds: string[]): Suite[] {
  return suites.map((suite) => (suite.id === id ? { ...suite, deviceIds } : suite))
}

const initial = defaultPersistedState()

export const useDevices = create<DevicesState>((set, get) => ({
  active: resolveDevices(DEFAULT_ACTIVE_DEVICE_IDS, []),
  suites: initial.suites,
  activeSuiteId: initial.activeSuiteId,
  customDevices: initial.customDevices,
  allDevices: catalogWithCustom(initial.customDevices),

  setActive: (ids) => {
    const { customDevices, suites, activeSuiteId } = get()
    const active = resolveDevices(ids, customDevices)
    // The canvas effects are keyed on this array: keeping the identity when the
    // selection did not actually change saves a full re-sync of every view —
    // and a write nobody asked for.
    if (sameSelection(active, get().active)) return

    const deviceIds = active.map((d) => d.id)
    const nextSuites = suites.map((suite) =>
      suite.id === activeSuiteId ? { ...suite, deviceIds } : suite
    )

    set({ active, suites: nextSuites })
    savePersistedState({ suites: nextSuites })
  },

  setActiveSuite: (id) => {
    const { suites, activeSuiteId, customDevices } = get()
    if (id === activeSuiteId) return
    const suite = suiteById(suites, id)
    if (suite === undefined) return

    set({ activeSuiteId: id, active: resolveDevices(suite.deviceIds, customDevices) })
    savePersistedState({ activeSuiteId: id })
  },

  hydrate: (state) => {
    const suite = suiteById(state.suites, state.activeSuiteId) ?? state.suites[0]
    set({
      customDevices: state.customDevices,
      allDevices: catalogWithCustom(state.customDevices),
      suites: state.suites,
      activeSuiteId: suite?.id ?? DEFAULT_SUITE_ID,
      active: resolveDevices(suite?.deviceIds ?? [], state.customDevices)
    })
  },

  addCustom: (input) => {
    const { customDevices, suites, activeSuiteId } = get()
    if (customDevices.length >= MAX_CUSTOM_DEVICES) return { ok: false, reason: 'too-many' }

    const taken = new Set([...get().allDevices.map((d) => d.id)])
    const device: DeviceSpec = { ...input, id: makeCustomDeviceId(input.name, taken) }

    const nextCustom = [...customDevices, device]
    const nextSuites = suites.map((suite) =>
      suite.id === activeSuiteId ? { ...suite, deviceIds: [...suite.deviceIds, device.id] } : suite
    )

    set({
      customDevices: nextCustom,
      allDevices: catalogWithCustom(nextCustom),
      suites: nextSuites,
      active: resolveDevices(suiteById(nextSuites, activeSuiteId)?.deviceIds ?? [], nextCustom)
    })
    savePersistedState({ customDevices: nextCustom, suites: nextSuites })
    return { ok: true, device }
  },

  updateCustom: (id, input) => {
    const { customDevices, suites, activeSuiteId } = get()
    if (!customDevices.some((d) => d.id === id)) return { ok: false, reason: 'unknown-device' }

    const device: DeviceSpec = { ...input, id }
    const nextCustom = customDevices.map((d) => (d.id === id ? device : d))

    // `active` holds the spec objects themselves, so an edit has to rebuild it
    // — that is what makes main re-apply the emulation for the changed device.
    set({
      customDevices: nextCustom,
      allDevices: catalogWithCustom(nextCustom),
      active: resolveDevices(suiteById(suites, activeSuiteId)?.deviceIds ?? [], nextCustom)
    })
    savePersistedState({ customDevices: nextCustom })
    return { ok: true, device }
  },

  removeCustom: (id) => {
    const { customDevices, suites, activeSuiteId } = get()
    const device = customDevices.find((d) => d.id === id)
    if (device === undefined) return { ok: false, reason: 'unknown-device' }

    // A suite has to keep at least one device: the canvas is the product, and
    // an empty one is a dead end the user cannot see their way out of.
    const activeSuite = suiteById(suites, activeSuiteId)
    if (activeSuite !== undefined && activeSuite.deviceIds.filter((x) => x !== id).length === 0) {
      return { ok: false, reason: 'last-in-suite' }
    }

    const nextCustom = customDevices.filter((d) => d.id !== id)
    // Out of every suite, not just the active one: the device is gone, and a
    // suite naming it would resolve to nothing the next time it was opened.
    const nextSuites = suites.map((suite) =>
      suite.deviceIds.includes(id)
        ? { ...suite, deviceIds: suite.deviceIds.filter((x) => x !== id) }
        : suite
    )

    set({
      customDevices: nextCustom,
      allDevices: catalogWithCustom(nextCustom),
      suites: nextSuites,
      active: resolveDevices(suiteById(nextSuites, activeSuiteId)?.deviceIds ?? [], nextCustom)
    })
    savePersistedState({ customDevices: nextCustom, suites: nextSuites })
    return { ok: true, device }
  },

  createSuite: (name) => {
    const { suites, customDevices } = get()

    const trimmed = name.trim()
    if (trimmed === '' || trimmed.length > MAX_SUITE_NAME_LENGTH) {
      return { ok: false, reason: 'invalid-name' }
    }
    if (suites.some((s) => nameKey(s.name) === nameKey(trimmed))) {
      return { ok: false, reason: 'duplicate-name' }
    }
    if (suites.length >= MAX_SUITES) return { ok: false, reason: 'too-many' }

    const suite: Suite = {
      id: makeSuiteId(trimmed, new Set(suites.map((s) => s.id))),
      name: trimmed,
      deviceIds: [NEW_SUITE_DEVICE_ID]
    }
    const nextSuites = [...suites, suite]

    // Creating a suite is a statement about what you want to look at now, so
    // the canvas follows it. Anything else would need a second click to mean
    // what the first one already said.
    set({
      suites: nextSuites,
      activeSuiteId: suite.id,
      active: resolveDevices(suite.deviceIds, customDevices)
    })
    savePersistedState({ suites: nextSuites, activeSuiteId: suite.id })
    return { ok: true, suite }
  },

  deleteSuite: (id) => {
    const { suites, activeSuiteId, customDevices } = get()
    const suite = suiteById(suites, id)
    if (suite === undefined) return { ok: false, reason: 'unknown-suite' }
    // There is always somewhere to be: a document with no suites has no canvas.
    if (suites.length <= 1) return { ok: false, reason: 'last-suite' }

    const nextSuites = suites.filter((s) => s.id !== id)
    const nextActiveId =
      activeSuiteId === id ? (nextSuites[0]?.id ?? DEFAULT_SUITE_ID) : activeSuiteId

    set({
      suites: nextSuites,
      activeSuiteId: nextActiveId,
      active: resolveDevices(suiteById(nextSuites, nextActiveId)?.deviceIds ?? [], customDevices)
    })
    savePersistedState({ suites: nextSuites, activeSuiteId: nextActiveId })
    return { ok: true, suite }
  },

  toggleDeviceInSuite: (deviceId) => {
    const { suites, activeSuiteId, customDevices, allDevices } = get()
    const suite = suiteById(suites, activeSuiteId)
    if (suite === undefined) return { ok: false, reason: 'unknown-suite' }
    if (!allDevices.some((d) => d.id === deviceId)) return { ok: false, reason: 'unknown-device' }

    const present = suite.deviceIds.includes(deviceId)
    // A suite has to keep at least one device — the same rule that stops the
    // last custom device from being deleted out from under the canvas.
    if (present && suite.deviceIds.length <= 1) return { ok: false, reason: 'last-in-suite' }

    const deviceIds = present
      ? suite.deviceIds.filter((id) => id !== deviceId)
      : [...suite.deviceIds, deviceId]
    const nextSuites = withSuite(suites, suite.id, deviceIds)

    set({ suites: nextSuites, active: resolveDevices(deviceIds, customDevices) })
    savePersistedState({ suites: nextSuites })
    return { ok: true, suite: { ...suite, deviceIds } }
  },

  reorderSuiteDevices: (from, to) => {
    const { suites, activeSuiteId, customDevices } = get()
    const suite = suiteById(suites, activeSuiteId)
    if (suite === undefined) return

    const deviceIds = [...suite.deviceIds]
    if (!Number.isInteger(from) || !Number.isInteger(to)) return
    if (from < 0 || from >= deviceIds.length) return
    if (to < 0 || to >= deviceIds.length || to === from) return

    const [moved] = deviceIds.splice(from, 1)
    deviceIds.splice(to, 0, moved as string)
    const nextSuites = withSuite(suites, suite.id, deviceIds)

    // The canvas is laid out in this order, so the drag is the layout.
    set({ suites: nextSuites, active: resolveDevices(deviceIds, customDevices) })
    savePersistedState({ suites: nextSuites })
  },

  importBackup: (backup) => {
    const { customDevices, suites, activeSuiteId } = get()
    const merged = mergeBackup({ customDevices, suites }, backup)

    // Stay where the user was if that suite survived — an import adds to a
    // document, it does not take the window somewhere else.
    const nextActiveId =
      suiteById(merged.suites, activeSuiteId)?.id ?? merged.suites[0]?.id ?? DEFAULT_SUITE_ID

    set({
      customDevices: merged.customDevices,
      allDevices: catalogWithCustom(merged.customDevices),
      suites: merged.suites,
      activeSuiteId: nextActiveId,
      active: resolveDevices(
        suiteById(merged.suites, nextActiveId)?.deviceIds ?? [],
        merged.customDevices
      )
    })
    savePersistedState({
      customDevices: merged.customDevices,
      suites: merged.suites,
      activeSuiteId: nextActiveId
    })
    return merged
  },

  reset: () => {
    const fresh = defaultPersistedState()
    set({
      customDevices: fresh.customDevices,
      allDevices: catalogWithCustom(fresh.customDevices),
      suites: fresh.suites,
      activeSuiteId: fresh.activeSuiteId,
      active: resolveDevices(fresh.suites[0]?.deviceIds ?? [], fresh.customDevices)
    })
    savePersistedState({
      customDevices: fresh.customDevices,
      suites: fresh.suites,
      activeSuiteId: fresh.activeSuiteId
    })
  }
}))
