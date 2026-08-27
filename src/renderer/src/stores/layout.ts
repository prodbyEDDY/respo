import { create } from 'zustand'
import { deviceById } from '@shared/deviceCatalog'
import type { DeviceSpec } from '@shared/types'
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

export interface LayoutState {
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
 * Only touch devices rotate. A desktop monitor has one orientation, and a
 * "landscape 1440×900 desktop" frame would be a viewport no user ever has.
 */
function canRotate(deviceId: string): boolean {
  return deviceById(deviceId)?.touch === true
}

export const useLayout = create<LayoutState>((set, get) => ({
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
    set({ rotated: { ...rotated, [deviceId]: rotated[deviceId] !== true } })
  },

  rotateAll: () => {
    const { rotated } = get()
    const targets = useDevices
      .getState()
      .active.filter((device) => device.touch)
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
  }
}))

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
    rotated[device.id] === true ? { ...device, width: device.height, height: device.width } : device
  )
}
