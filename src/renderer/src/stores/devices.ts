import { create } from 'zustand'
import {
  catalogWithCustom,
  makeCustomDeviceId,
  type CustomDeviceInput
} from '@shared/custom-devices'
import { DEFAULT_ACTIVE_DEVICE_IDS, deviceById } from '@shared/deviceCatalog'
import {
  DEFAULT_SUITE_ID,
  defaultPersistedState,
  type PersistedState,
  type Suite
} from '@shared/persistence-types'
import type { DeviceSpec } from '@shared/types'
import { savePersistedState } from '@renderer/lib/persistence'

/** Ceiling shared with main's `store:save` validator. */
const MAX_CUSTOM_DEVICES = 64

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
  }
}))
