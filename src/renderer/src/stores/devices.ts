import { create } from 'zustand'
import { DEFAULT_ACTIVE_DEVICE_IDS, devicesByIds } from '@shared/deviceCatalog'
import type { DeviceSpec } from '@shared/types'

export interface DevicesState {
  /** Devices currently on the canvas, in display order. */
  active: DeviceSpec[]
  /**
   * Replace the selection. Unknown ids are dropped and duplicates collapsed, so
   * whatever a picker (or a restored session) hands over is safe to pass in.
   */
  setActive: (ids: string[]) => void
}

function sameSelection(a: readonly DeviceSpec[], b: readonly DeviceSpec[]): boolean {
  return a.length === b.length && a.every((device, i) => device === b[i])
}

export const useDevices = create<DevicesState>((set, get) => ({
  active: devicesByIds(DEFAULT_ACTIVE_DEVICE_IDS),

  setActive: (ids) => {
    const active = devicesByIds(ids)
    // The canvas effects are keyed on this array: keeping the identity when the
    // selection did not actually change saves a full re-sync of every view.
    if (sameSelection(active, get().active)) return
    set({ active })
  }
}))
