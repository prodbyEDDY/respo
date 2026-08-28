import { create } from 'zustand'
import { DEFAULT_ACTIVE_DEVICE_IDS, deviceById } from '@shared/deviceCatalog'
import {
  DEFAULT_SUITE_ID,
  defaultPersistedState,
  type PersistedState,
  type Suite
} from '@shared/persistence-types'
import type { DeviceSpec } from '@shared/types'
import { savePersistedState } from '@renderer/lib/persistence'

export interface DevicesState {
  /** Devices currently on the canvas, in display order. */
  active: DeviceSpec[]
  /** Every saved suite, in the order the user arranged them. */
  suites: Suite[]
  /** The suite `active` is resolved from. */
  activeSuiteId: string
  /** User-defined devices, resolvable by id alongside the catalog. */
  customDevices: DeviceSpec[]

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
      suites: state.suites,
      activeSuiteId: suite?.id ?? DEFAULT_SUITE_ID,
      active: resolveDevices(suite?.deviceIds ?? [], state.customDevices)
    })
  }
}))
