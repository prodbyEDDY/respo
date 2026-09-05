import { create } from 'zustand'
import {
  defaultEmulationProfile,
  isEmulationActive,
  type EmulationProfile,
  type VisionDeficiency
} from '@shared/emulation'
import type { RespoApi } from '@shared/ipc'
import type { EmulationSettings } from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'

/**
 * The renderer's half of the emulation pack: the profile as the popover shows
 * it, and the per-device vision overrides the kebab menus show.
 *
 * The *behaviour* lives in main (`main/emulation.ts`) — this store holds what
 * the UI has to draw and forwards each change once, whole. Main is the side
 * that restores the profile at boot, before the first view exists, so
 * `hydrate` writes nothing back and sends nothing.
 */
export interface EmulationState {
  profile: EmulationProfile
  /** Per-device vision overrides. An absent id inherits `profile.vision`. */
  deviceVision: Record<string, VisionDeficiency>

  /** Change any part of the profile. One IPC, one write, whatever the size. */
  setProfile: (patch: Partial<EmulationProfile>) => void
  /** Override one device's vision simulation, or (`null`) inherit again. */
  setDeviceVision: (deviceId: string, vision: VisionDeficiency | null) => void
  /** Back to the real environment, everywhere. */
  resetAll: () => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (emulation: EmulationSettings) => void
}

function invoke(run: (bridge: RespoApi) => Promise<void>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).catch((error: unknown) => {
    console.error('emulation ipc failed', error)
  })
}

export const useEmulation = create<EmulationState>((set, get) => ({
  profile: defaultEmulationProfile(),
  deviceVision: {},

  setProfile: (patch) => {
    const profile = { ...get().profile, ...patch }
    set({ profile })
    invoke((bridge) => bridge.invoke('emulation:set', profile))
    savePersistedState({ emulation: { profile, deviceVision: get().deviceVision } })
  },

  setDeviceVision: (deviceId, vision) => {
    const { deviceVision } = get()
    if ((deviceVision[deviceId] ?? null) === vision) return
    // Only the exceptions are kept: inheriting again removes the key rather
    // than storing "inherit" as a value that would then be persisted forever.
    const next = { ...deviceVision }
    if (vision === null) delete next[deviceId]
    else next[deviceId] = vision

    set({ deviceVision: next })
    invoke((bridge) => bridge.invoke('emulation:set-device-vision', deviceId, vision))
    savePersistedState({ emulation: { profile: get().profile, deviceVision: next } })
  },

  resetAll: () => {
    const { profile, deviceVision } = get()
    const overridden = Object.keys(deviceVision)
    if (!isEmulationActive(profile) && overridden.length === 0) return

    const fresh = defaultEmulationProfile()
    set({ profile: fresh, deviceVision: {} })
    invoke((bridge) => bridge.invoke('emulation:set', fresh))
    for (const deviceId of overridden) {
      invoke((bridge) => bridge.invoke('emulation:set-device-vision', deviceId, null))
    }
    savePersistedState({ emulation: { profile: fresh, deviceVision: {} } })
  },

  hydrate: (emulation) => {
    // Main already applied these to the views before the renderer existed;
    // re-sending them would be noise.
    set({ profile: { ...emulation.profile }, deviceVision: { ...emulation.deviceVision } })
  }
}))

/** Whether the toolbar button should wear its badge. */
export function selectEmulationActive(state: EmulationState): boolean {
  return isEmulationActive(state.profile)
}

/** The simulation one device is actually under: its override, or the profile's. */
export function selectDeviceVision(state: EmulationState, deviceId: string): VisionDeficiency {
  return state.deviceVision[deviceId] ?? state.profile.vision
}
