import { create } from 'zustand'
import { isRotatable } from '@shared/custom-devices'
import type { DeviceSpec } from '@shared/types'
import { savePersistedState } from '@renderer/lib/persistence'
import { useDevices } from './devices'

/**
 * The zoom ladder the buttons and the menu step through. Chrome's own ladder,
 * trimmed to the range a canvas of device frames is legible in.
 */
export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2
]

export const MIN_ZOOM = ZOOM_STEPS[0] as number
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] as number

/** The full-screen surface the window is showing. */
export type WindowView = 'canvas' | 'devices'

export interface LayoutState {
  /**
   * What fills the window below the toolbar. The Device Manager *replaces* the
   * canvas rather than floating over it: device views are native surfaces
   * composited above everything the renderer draws, so there is no such thing
   * as a panel on top of them.
   */
  view: WindowView
  setView: (view: WindowView) => void

  /**
   * Canvas zoom. The frames shrink in the DOM; main hands the logical viewport
   * back to the page with `webContents.setZoomFactor`, so the *emulated*
   * viewport — and therefore every media query — is untouched by it.
   */
  zoom: number
  zoomIn: () => void
  zoomOut: () => void
  /** Free-form zoom, for the ctrl+wheel gesture. Clamped, not snapped. */
  setZoom: (zoom: number) => void
  resetZoom: () => void

  /** Device ids currently in landscape. Absent id means portrait. */
  rotated: Record<string, boolean>
  /** Flip one device. Devices without a touch screen do not rotate. */
  rotate: (deviceId: string) => void
  /** Flip every active touch device to the same orientation, in one click. */
  rotateAll: () => void
  /** Install the orientations main restored at boot. Writes nothing back. */
  hydrateRotation: (rotated: Record<string, boolean>) => void
}

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Nearest rung strictly above `zoom`; the top rung when there is none. */
function stepUp(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? MAX_ZOOM
}

/** Nearest rung strictly below `zoom`; the bottom rung when there is none. */
function stepDown(zoom: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    const step = ZOOM_STEPS[i] as number
    if (step < zoom - 1e-6) return step
  }
  return MIN_ZOOM
}

/**
 * Only devices you can pick up rotate. A desktop monitor has one orientation,
 * and a "landscape 1440×900 desktop" frame would be a viewport no user has.
 *
 * Resolved against the user's own devices too, not just the catalog: a custom
 * phone rotates like any other phone.
 */
function canRotate(deviceId: string): boolean {
  const device = useDevices.getState().allDevices.find((d) => d.id === deviceId)
  return device !== undefined && isRotatable(device)
}

export const useLayout = create<LayoutState>((set, get) => ({
  view: 'canvas',
  setView: (view) => set({ view }),

  zoom: 1,

  zoomIn: () => set({ zoom: stepUp(get().zoom) }),
  zoomOut: () => set({ zoom: stepDown(get().zoom) }),

  setZoom: (zoom) => {
    if (!Number.isFinite(zoom)) return
    set({ zoom: clamp(zoom) })
  },

  resetZoom: () => set({ zoom: 1 }),

  rotated: {},

  rotate: (deviceId) => {
    if (!canRotate(deviceId)) return
    const { rotated } = get()
    const next = { ...rotated, [deviceId]: rotated[deviceId] !== true }
    set({ rotated: next })
    persistRotation(next)
  },

  rotateAll: () => {
    const { rotated } = get()
    const targets = useDevices
      .getState()
      .active.filter(isRotatable)
      .map((device) => device.id)

    // Nothing on the canvas can rotate: keep the object identity, so the
    // derived device specs below do not change and no view is re-emulated.
    if (targets.length === 0) return

    // One click, one predictable outcome: a mixed canvas levels to landscape,
    // an all-landscape canvas goes back to portrait.
    const next = !targets.every((id) => rotated[id] === true)
    const updated = { ...rotated }
    for (const id of targets) updated[id] = next
    set({ rotated: updated })
    persistRotation(updated)
  },

  hydrateRotation: (rotated) => set({ rotated: { ...rotated } })
}))

/**
 * Write the orientations, keeping only the landscape ones.
 *
 * `rotated` holds a `false` for every device turned back, because the toggle
 * reads it — but the document only needs the exceptions, and a map that grew by
 * one dead entry per rotation would be persisted forever.
 */
function persistRotation(rotated: Record<string, boolean>): void {
  const landscape: Record<string, boolean> = {}
  for (const [id, value] of Object.entries(rotated)) {
    if (value) landscape[id] = true
  }
  savePersistedState({ rotated: landscape })
}

/**
 * Project the rotation state onto a device list.
 *
 * A rotated device is a plain `DeviceSpec` with its width and height swapped,
 * which is all that is needed end to end: the frame in the DOM gets the new
 * box, and `ViewManager` sees changed metrics and re-runs
 * `Emulation.setDeviceMetricsOverride` with them.
 *
 * Devices that did not rotate are returned by identity, because
 * `views:sync-devices` re-emulates any spec whose metrics differ.
 */
export function applyRotation(
  devices: readonly DeviceSpec[],
  rotated: Record<string, boolean>
): DeviceSpec[] {
  return devices.map((device) =>
    // `isRotatable` again, not just the flag: a custom device can be edited to
    // stop rotating while a stale `true` is still sitting in the map.
    rotated[device.id] === true && isRotatable(device)
      ? { ...device, width: device.height, height: device.width }
      : device
  )
}
