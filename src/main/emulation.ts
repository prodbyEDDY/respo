/**
 * The emulation pack, applied: one environment profile over every device
 * view, with a per-device escape hatch for the vision simulation.
 *
 * A `DeviceSpec` says what the screen is; the profile says what the *person*
 * is — dark mode, less motion, a slow connection, a city, a language, a time
 * zone, a colour vision deficiency (spec §5.2, research §C). All of it is
 * global, because there is one page across many viewports and it is being
 * checked against one environment at a time. Vision is the exception: the
 * question it answers is "how does this look to someone with deuteranopia",
 * and the best way to answer it is two identical frames side by side, one
 * with and one without. So a device may override the profile's vision, and
 * only that.
 *
 * Nothing here touches Electron. `EmulationCdp` is the slice of
 * `CDPController` the manager drives, so what gets applied, to whom, and
 * when, is unit-testable against a recording double. The controller owns the
 * diffing (a profile change is one call per view per changed group) and the
 * replay after a re-attach; this owns *which* environment each view gets.
 */

import {
  defaultEmulationProfile,
  NETWORK_CONDITIONS,
  type EmulationProfile,
  type VisionDeficiency
} from '@shared/emulation'
import type { EmulationStatePayload } from '@shared/ipc'
import type { EmulationSettings } from '@shared/persistence-types'
import type { CdpTarget, ViewEmulation } from './cdp-controller'

/** The slice of `CDPController` the manager drives. */
export interface EmulationCdp {
  applyEmulation(
    target: CdpTarget,
    next: ViewEmulation,
    options?: { force?: boolean }
  ): Promise<void>
}

export type EmulationDeviceRegistration = {
  deviceId: string
  /** The CDP session behind the view. */
  target: CdpTarget
}

/**
 * How a view backend tells the manager which pages exist.
 *
 * The same shape as `SyncRegistry`, `DevtoolsRegistry` and `InspectRegistry`:
 * a view is created in one place, and everything that needs a handle on it
 * registers there. `registerDevice` answers with the application of the
 * current profile, so the backend can queue the first navigation behind it —
 * the `Accept-Language` a document is fetched with is the one it keeps.
 */
export interface EmulationRegistry {
  registerDevice(registration: EmulationDeviceRegistration): Promise<void>
  unregisterDevice(deviceId: string): void
}

export type EmulationManagerOptions = {
  cdp: EmulationCdp
  /** What the last session left, as restored from disk. */
  initial?: EmulationSettings
}

/**
 * Ceiling on remembered per-device overrides. A user can only set one on a
 * device they can see; the cap is here so a compromised renderer cannot grow
 * the map without bound by naming ids that never existed.
 */
const MAX_DEVICE_VISION = 256

type Entry = {
  deviceId: string
  target: CdpTarget
}

/**
 * The environment one device gets, resolved from the profile and its own
 * override. Exported for its unit test.
 */
export function resolveViewEmulation(
  profile: EmulationProfile,
  visionOverride: VisionDeficiency | undefined
): ViewEmulation {
  return {
    media: profile.media,
    colorScheme: profile.colorScheme,
    reducedMotion: profile.reducedMotion,
    forcedColors: profile.forcedColors,
    vision: visionOverride ?? profile.vision,
    network: NETWORK_CONDITIONS[profile.network],
    geolocation: profile.geolocation === null ? null : { ...profile.geolocation },
    locale: profile.locale,
    timezone: profile.timezone
  }
}

export class EmulationManager implements EmulationRegistry {
  private readonly cdp: EmulationCdp
  private readonly devices = new Map<string, Entry>()
  private profile: EmulationProfile
  /**
   * Per-device vision overrides, whether or not the device currently has a
   * view: a device that leaves the suite and comes back must come back with
   * its override, and the restored session sets these before any view exists.
   */
  private readonly deviceVision = new Map<string, VisionDeficiency>()
  private disposed = false

  constructor(options: EmulationManagerOptions) {
    this.cdp = options.cdp
    this.profile = options.initial?.profile ?? defaultEmulationProfile()
    for (const [deviceId, vision] of Object.entries(options.initial?.deviceVision ?? {})) {
      if (this.deviceVision.size >= MAX_DEVICE_VISION) break
      this.deviceVision.set(deviceId, vision)
    }
  }

  /** What is being applied, as the renderer would ask for it. */
  state(): EmulationStatePayload {
    return {
      profile: { ...this.profile, geolocation: this.profile.geolocation },
      deviceVision: Object.fromEntries(this.deviceVision)
    }
  }

  /** Devices currently registered, in registration order. Test seam. */
  deviceIds(): string[] {
    return [...this.devices.keys()]
  }

  /**
   * Replace the profile and put it on every view.
   *
   * The whole profile every time: the controller diffs it per view, so the
   * cost of restating an unchanged field is a comparison, and the manager
   * never has to know which field the user touched.
   */
  setProfile(profile: EmulationProfile): void {
    if (this.disposed) return
    this.profile = profile
    for (const entry of this.devices.values()) this.apply(entry)
  }

  /**
   * Override the vision simulation on one device, or (`null`) let it inherit
   * the profile again. Accepted for a device that has no view yet — the
   * restored session and a device joining a suite both need that.
   */
  setDeviceVision(deviceId: string, vision: VisionDeficiency | null): void {
    if (this.disposed) return
    if (vision === null) {
      if (!this.deviceVision.delete(deviceId)) return
    } else {
      if (this.deviceVision.get(deviceId) === vision) return
      if (!this.deviceVision.has(deviceId) && this.deviceVision.size >= MAX_DEVICE_VISION) return
      this.deviceVision.set(deviceId, vision)
    }
    const entry = this.devices.get(deviceId)
    if (entry !== undefined) this.apply(entry)
  }

  registerDevice(registration: EmulationDeviceRegistration): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const entry: Entry = { deviceId: registration.deviceId, target: registration.target }
    this.devices.set(entry.deviceId, entry)
    return this.apply(entry)
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId)
  }

  /**
   * Drop every view outside `live`. Called after the device set changes.
   *
   * The overrides stay: they are keyed by id like the orientation map, and a
   * device taken off the canvas and put back should still be the one that
   * simulates deuteranopia.
   */
  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.devices.clear()
    this.deviceVision.clear()
  }

  private apply(entry: Entry): Promise<void> {
    const emulation = resolveViewEmulation(this.profile, this.deviceVision.get(entry.deviceId))
    return this.cdp.applyEmulation(entry.target, emulation)
  }
}
