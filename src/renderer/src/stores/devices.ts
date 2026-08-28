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
import { useSync } from './sync'

/** Ceiling shared with main's `store:save` validator. */
const MAX_CUSTOM_DEVICES = 64
/** The same ceiling for suites. A document past it is junk, not a workflow. */
const MAX_SUITES = 64
/** A suite name is a label; the field is capped so it stays one. */
export const MAX_SUITE_NAME_LENGTH = 60

/**
 * How many devices one suite may hold.
 *
 * Deliberately far below the 64 main's validator tolerates: that number is a
 * guard against junk, this one is the canvas. Every device in the active suite
 * is a live `WebContentsView` with its own renderer process, and the budgets in
 * spec §8 are written for a canvas of that order — a suite of 65 would be
 * refused by `views:sync-devices` with nothing on screen to say why.
 */
export const MAX_SUITE_DEVICES = 20

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
 * - `last-in-suite`: removing it would leave *some* suite with no devices, and
 *   a canvas with nothing on it is not a state the user asked for — including
 *   the one they would find on switching to that suite later.
 * - `too-many`: the document's own cap on custom devices.
 */
export type DeviceMutationError = 'unknown-device' | 'last-in-suite' | 'too-many'

export type DeviceMutationResult =
  { ok: true; device: DeviceSpec } | { ok: false; reason: DeviceMutationError }

/**
 * Adding a device also tries to put it on the canvas, and that half can fail on
 * its own: the suite may already be full. `joinedSuite` is how the UI knows
 * whether to say so.
 */
export type DeviceAddResult =
  | { ok: true; device: DeviceSpec; joinedSuite: boolean }
  | { ok: false; reason: DeviceMutationError }

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
   * then has to go and find is a second step for no reason. A full suite is the
   * one case where it cannot happen — the device is still added, and the result
   * says it did not join so the library can.
   */
  addCustom: (input: CustomDeviceInput) => DeviceAddResult
  /** Rewrite one user-defined device in place, keeping its id and placement. */
  updateCustom: (id: string, input: CustomDeviceInput) => DeviceMutationResult
  /**
   * Delete a user-defined device and drop it from every suite.
   *
   * Refused while any suite holds nothing else: the device is gone from all of
   * them at once, and a suite the user switches to later must not be empty.
   */
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
  /**
   * Move one device to another's place in the active suite. Canvas order *is*
   * suite order.
   *
   * Addressed by id rather than by index on purpose: the canvas is the *resolved*
   * suite, and an id nothing answers to is skipped on the way there — so the
   * two lists share positions only while every id resolves, and a drag keyed on
   * a canvas index would move the wrong device the moment one did not.
   */
  reorderSuiteDevices: (fromId: string, toId: string) => void

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

/**
 * The suites that would be left with nothing if `deviceId` were deleted.
 *
 * Exported because the delete dialog has to say *which* suite is in the way
 * before the user commits to a button that is going to refuse.
 */
export function suitesEmptiedBy(suites: readonly Suite[], deviceId: string): Suite[] {
  return suites.filter(
    (suite) => suite.deviceIds.includes(deviceId) && suite.deviceIds.every((id) => id === deviceId)
  )
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
    // The library takes the device either way; only the canvas has a ceiling.
    const joinedSuite =
      (suiteById(suites, activeSuiteId)?.deviceIds.length ?? 0) < MAX_SUITE_DEVICES
    const nextSuites = joinedSuite
      ? suites.map((suite) =>
          suite.id === activeSuiteId
            ? { ...suite, deviceIds: [...suite.deviceIds, device.id] }
            : suite
        )
      : suites

    set({
      customDevices: nextCustom,
      allDevices: catalogWithCustom(nextCustom),
      suites: nextSuites,
      active: resolveDevices(suiteById(nextSuites, activeSuiteId)?.deviceIds ?? [], nextCustom)
    })
    savePersistedState(
      joinedSuite
        ? { customDevices: nextCustom, suites: nextSuites }
        : { customDevices: nextCustom }
    )
    return { ok: true, device, joinedSuite }
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

    // Every suite has to keep at least one device: the canvas is the product,
    // and an empty one is a dead end the user cannot see their way out of. The
    // check covers *all* suites because the delete does — guarding only the
    // active one leaves the dead end waiting behind the next suite switch.
    if (suitesEmptiedBy(suites, id).length > 0) return { ok: false, reason: 'last-in-suite' }

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
    // The id goes with the device. Ids are slugs of the name, so leaving a mute
    // behind would silence the *next* "My phone" the user makes.
    useSync.getState().forgetDevice(id)
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
    // And at most `MAX_SUITE_DEVICES`, so the canvas the user builds here is one
    // main will actually accept.
    if (!present && suite.deviceIds.length >= MAX_SUITE_DEVICES) {
      return { ok: false, reason: 'too-many' }
    }

    const deviceIds = present
      ? suite.deviceIds.filter((id) => id !== deviceId)
      : [...suite.deviceIds, deviceId]
    const nextSuites = withSuite(suites, suite.id, deviceIds)

    set({ suites: nextSuites, active: resolveDevices(deviceIds, customDevices) })
    savePersistedState({ suites: nextSuites })
    return { ok: true, suite: { ...suite, deviceIds } }
  },

  reorderSuiteDevices: (fromId, toId) => {
    const { suites, activeSuiteId, customDevices } = get()
    const suite = suiteById(suites, activeSuiteId)
    if (suite === undefined) return

    const deviceIds = [...suite.deviceIds]
    // Resolved here, against the list actually being rewritten: the caller
    // knows which chip was dragged onto which, and nothing more.
    const from = deviceIds.indexOf(fromId)
    const to = deviceIds.indexOf(toId)
    if (from === -1 || to === -1 || from === to) return

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
    // "Reset everything" includes the switches: every muted id named a device
    // that no longer exists, and one of them would come back with the next
    // device to be given the same name.
    useSync.getState().resetSwitches()
  }
}))
