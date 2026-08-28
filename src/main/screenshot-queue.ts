/**
 * Screenshots, as a queue (spec §4.2, §8).
 *
 * "Screenshot every device" is the gesture Respo exists for, and it is also the
 * one that would take the app down if it were a `Promise.all`: ten
 * `Page.captureScreenshot` calls with `captureBeyondViewport` are ten full
 * document rasters at once, each of them a resize of the frame it renders. So
 * captures run three at a time (CLAUDE.md §4), each job is isolated in its own
 * `try`, and one page that will not raster costs exactly one file.
 *
 * The renderer hears about it through batched `shot-state` events — never one
 * message per job transition — and every job carries the id and size of the
 * batch it belongs to, so "3 of 5 saved" is a fold over what has already
 * arrived rather than state the renderer has to keep in step with main.
 *
 * Nothing here imports Electron: the CDP session, the filesystem, the clock and
 * the clipboard are all injected, which is what lets the parts that have to be
 * correct — concurrency, file naming, collision suffixes, the path check on
 * `reveal` — be unit-tested without booting a browser.
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ShotDpr,
  ShotFormat,
  ShotRequest,
  ShotStartResult,
  ShotStatePayload
} from '@shared/ipc'
import type { CaptureOptions, CdpTarget } from './cdp-controller'
import { immediateDeferrer, type Deferrer } from './load-state-batcher'

/** The slice of `CDPController` the queue drives. */
export interface ShotCdp {
  capture(target: CdpTarget, options: CaptureOptions): Promise<Buffer | null>
}

/**
 * The filesystem, behind an interface.
 *
 * `join` is part of it because the collision walk has to build candidate paths,
 * and a test that can hand it a POSIX join is a test that runs the same way on
 * either platform.
 */
export interface ShotFileSystem {
  join(directory: string, name: string): string
  /** Create the folder and everything above it. Existing is not an error. */
  mkdir(directory: string): Promise<void>
  exists(path: string): Promise<boolean>
  write(path: string, data: Buffer): Promise<void>
  /**
   * Whether `path` is inside `directory`. Both are resolved first: the point of
   * the check is that `..` cannot walk out of the screenshots folder.
   */
  contains(directory: string, path: string): boolean
}

/** One live device view, as the queue needs to know it. */
export type ShotDeviceRegistration = {
  deviceId: string
  /** Used to name the file, so it is the device's *display* name. */
  name: string
  /** The emulated viewport in device CSS pixels, rotation already applied. */
  width: number
  height: number
  /** The CDP session behind the view. */
  target: CdpTarget
}

/**
 * How a view backend tells the queue which pages exist.
 *
 * Deliberately the same shape as `SyncRegistry`, `DevtoolsRegistry` and
 * `InspectRegistry`: a device view is created in one place, and everything that
 * needs a handle on it registers there.
 */
export interface ShotRegistry {
  registerDevice(registration: ShotDeviceRegistration): void
  /** Rotation or an edited spec: the file name carries the size, so it matters. */
  updateDevice(deviceId: string, device: { name: string; width: number; height: number }): void
  unregisterDevice(deviceId: string): void
}

/** The defaults a request leaves out — the user's saved preferences. */
export type ShotDefaults = {
  format: ShotFormat
  dpr: ShotDpr
}

export type ScreenshotQueueOptions = {
  cdp: ShotCdp
  fs: ShotFileSystem
  /** The folder to write into, read at capture time. Never cached. */
  directory: () => string
  /** Format and density, read at capture time for the same reason. */
  defaults: () => ShotDefaults
  /** Batched progress. One call per turn, many jobs per call. */
  onState?: (batch: ShotStatePayload[]) => void
  /** Put an encoded image on the clipboard. Absent outside Electron. */
  copyImage?: (png: Buffer) => Promise<void> | void
  /** Show a saved file in the OS file manager. Absent outside Electron. */
  revealFile?: (path: string) => void
  concurrency?: number
  now?: () => Date
  deferrer?: Deferrer
}

/**
 * How many captures run at once (spec §8).
 *
 * Three is the number in the spec and it is not arbitrary: a full-page capture
 * resizes the frame it renders, so each one in flight is a live relayout of a
 * whole document.
 */
export const SHOT_CONCURRENCY = 3

/** Where the `-2`, `-3` collision walk gives up and the capture fails. */
const MAX_COLLISION_SUFFIX = 999

type Job = {
  id: string
  batchId: string
  batchSize: number
  deviceId: string
  deviceName: string
  request: Required<ShotRequest>
}

type Device = ShotDeviceRegistration

/** `2026-08-28` -> `20260828-143005`. Local time: so is the user. */
function timestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${date}-${time}`
}

/** The extension for a format. `jpeg` is the codec; `.jpg` is the file. */
export function shotExtension(format: ShotFormat): string {
  return format === 'jpeg' ? 'jpg' : 'png'
}

/**
 * A device name, reduced to something a filesystem will take.
 *
 * Deliberately strict — ASCII letters, digits and dashes — rather than a
 * blocklist of Windows' forbidden characters: the name comes from a field the
 * user types into, it ends up in a path main builds, and the safe reading of
 * "iPhone 15 Pro / test" is `iphone-15-pro-test`. Names that reduce to nothing
 * (an emoji, a Cyrillic-only name) fall back to `device`, so the shot still
 * lands somewhere sensible.
 */
export function sanitizeDeviceName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return cleaned === '' ? 'device' : cleaned
}

/**
 * `iphone-15-pro-393x852-20260828-143005.png`, and `-2` on a collision.
 *
 * The name has to answer "which device, what size, when" at a glance in a
 * folder of a hundred of them — that is the whole reason it is not a uuid.
 */
export function shotFileName(options: {
  deviceName: string
  width: number
  height: number
  now: Date
  format: ShotFormat
  /** 1 for the first candidate; 2 and up append the collision suffix. */
  attempt: number
}): string {
  const size = `${Math.round(options.width)}x${Math.round(options.height)}`
  const suffix = options.attempt <= 1 ? '' : `-${options.attempt}`
  const base = `${sanitizeDeviceName(options.deviceName)}-${size}-${timestamp(options.now)}${suffix}`
  return `${base}.${shotExtension(options.format)}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ScreenshotQueue implements ShotRegistry {
  private readonly devices = new Map<string, Device>()
  private readonly cdp: ShotCdp
  private readonly fs: ShotFileSystem
  private readonly directory: () => string
  private readonly defaults: () => ShotDefaults
  private readonly onState: ((batch: ShotStatePayload[]) => void) | null
  private readonly copyImage: ((png: Buffer) => Promise<void> | void) | null
  private readonly revealFile: ((path: string) => void) | null
  private readonly concurrency: number
  private readonly now: () => Date
  private readonly deferrer: Deferrer

  private readonly queued: Job[] = []
  /** Newest state per job, flushed as one message per turn (CLAUDE.md §4). */
  private readonly pending = new Map<string, ShotStatePayload>()
  /**
   * Paths a job in flight has claimed but not yet written.
   *
   * Two devices never collide (their names differ), but two shots of the *same*
   * device inside one second do, and the file the first one will write does not
   * exist yet when the second one looks.
   */
  private readonly claimed = new Set<string>()
  /**
   * The last job admitted for each device, so the next one waits for it.
   *
   * Two captures of the *same* view cannot overlap: a capture temporarily owns
   * that view's emulation — `dpr: 1` replaces the density override, a full-page
   * shot resizes the frame — and both put it back when they finish. Run two at
   * once and the first one's restore lands in the middle of the second one's
   * capture, so one of the two images comes out at the wrong density or the
   * wrong size. Different devices are different sessions and still run in
   * parallel, up to the global budget.
   */
  private readonly deviceTails = new Map<string, Promise<void>>()

  private cancelFlush: (() => void) | null = null
  private running = 0
  private sequence = 0
  private disposed = false

  constructor(options: ScreenshotQueueOptions) {
    this.cdp = options.cdp
    this.fs = options.fs
    this.directory = options.directory
    this.defaults = options.defaults
    this.onState = options.onState ?? null
    this.copyImage = options.copyImage ?? null
    this.revealFile = options.revealFile ?? null
    this.concurrency = Math.max(1, options.concurrency ?? SHOT_CONCURRENCY)
    this.now = options.now ?? ((): Date => new Date())
    this.deferrer = options.deferrer ?? immediateDeferrer
  }

  /** Device ids with a live view, in registration order. */
  deviceIds(): string[] {
    return [...this.devices.keys()]
  }

  registerDevice(registration: ShotDeviceRegistration): void {
    if (this.disposed) return
    this.devices.set(registration.deviceId, { ...registration })
  }

  updateDevice(deviceId: string, device: { name: string; width: number; height: number }): void {
    const existing = this.devices.get(deviceId)
    if (existing === undefined) return
    existing.name = device.name
    existing.width = device.width
    existing.height = device.height
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId)
  }

  /** Drop every device outside `live`. Called after the device set changes. */
  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  /** Queue one device's screenshot. Answers with the batch it started. */
  captureDevice(deviceId: string, request: ShotRequest): ShotStartResult {
    return this.enqueue([deviceId], request)
  }

  /** Queue every device on the canvas, in canvas order. */
  captureAll(request: ShotRequest): ShotStartResult {
    return this.enqueue(this.deviceIds(), request)
  }

  /**
   * Put one device's viewport on the clipboard.
   *
   * Outside the queue on purpose: it writes no file, there is exactly one of
   * it, and a user who pressed copy is waiting for the paste to work — putting
   * it behind three full-page captures would make it feel broken. Always PNG:
   * the clipboard is not a place lossy compression buys anything.
   */
  async copy(deviceId: string): Promise<boolean> {
    if (this.disposed || this.copyImage === null) return false

    const device = this.devices.get(deviceId)
    if (device === undefined) return false

    try {
      const bytes = await this.cdp.capture(device.target, {
        format: 'png',
        fullPage: false,
        dpr: this.defaults().dpr
      })
      if (bytes === null || bytes.length === 0) return false
      await this.copyImage(bytes)
      return true
    } catch (error) {
      console.error(`shots: could not copy ${deviceId}`, error)
      return false
    }
  }

  /**
   * Show a saved screenshot in the file manager.
   *
   * The path arrives from the renderer, so it is checked against the
   * screenshots folder rather than trusted: `showItemInFolder` on an arbitrary
   * path is a way to make the app open a window onto anything on the disk, and
   * the only paths the renderer ever legitimately has are the ones this queue
   * gave it.
   */
  reveal(path: string): boolean {
    if (this.disposed || this.revealFile === null) return false
    if (typeof path !== 'string' || path === '') return false
    if (!this.fs.contains(this.directory(), path)) {
      console.error('shots: refusing to reveal a path outside the screenshots folder')
      return false
    }

    this.revealFile(path)
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.queued.length = 0
    this.pending.clear()
    this.claimed.clear()
    this.deviceTails.clear()
    this.cancelFlush?.()
    this.cancelFlush = null
    this.devices.clear()
  }

  private enqueue(deviceIds: readonly string[], request: ShotRequest): ShotStartResult {
    const defaults = this.defaults()
    const resolved: Required<ShotRequest> = {
      fullPage: request.fullPage,
      format: request.format ?? defaults.format,
      dpr: request.dpr ?? defaults.dpr
    }

    this.sequence += 1
    const batchId = `shot-${this.sequence}`
    if (this.disposed) return { batchId, queued: 0 }

    // Only devices that actually have a view: queueing a job for an id that
    // left the canvas would report a failure the user cannot act on.
    const targets = deviceIds.filter((deviceId) => this.devices.has(deviceId))
    const jobs: Job[] = targets.map((deviceId, index) => ({
      id: `${batchId}-${index}`,
      batchId,
      batchSize: targets.length,
      deviceId,
      deviceName: this.devices.get(deviceId)?.name ?? deviceId,
      request: resolved
    }))

    for (const job of jobs) {
      this.queued.push(job)
      this.report(job, 'queued')
    }
    this.pump()

    return { batchId, queued: jobs.length }
  }

  /** Start jobs until the concurrency budget is spent. */
  private pump(): void {
    while (!this.disposed && this.running < this.concurrency && this.queued.length > 0) {
      const job = this.queued.shift()
      if (job === undefined) return
      this.running += 1
      this.run(job)
    }
  }

  /**
   * Admit one job to the pool, behind whatever is already running on its device.
   *
   * The concurrency slot is taken for the whole wait, which is the honest
   * accounting: the job *is* in flight from here on, and the alternative —
   * releasing the slot while it waits — would let a device with a queue of its
   * own start an unbounded number of captures. See `deviceTails`.
   */
  private run(job: Job): void {
    const tail = this.deviceTails.get(job.deviceId)
    // Started here and now when the device is free — a shot the user just asked
    // for should not wait a turn of the event loop for no reason. `capture`
    // never rejects, so neither does the chain: one device's failure must not
    // leave every later shot of it hanging off a rejected promise.
    const next = tail === undefined ? this.capture(job) : tail.then(() => this.capture(job))
    this.deviceTails.set(job.deviceId, next)

    void next.then(() => {
      // Only if nothing else queued behind us in the meantime.
      if (this.deviceTails.get(job.deviceId) === next) this.deviceTails.delete(job.deviceId)
      this.running -= 1
      this.pump()
    })
  }

  /**
   * One capture, start to finish.
   *
   * Every failure inside is this job's alone: the batch keeps going, and the
   * renderer is told which device did not make it and why (spec: "one failure
   * does not drop the batch").
   */
  private async capture(job: Job): Promise<void> {
    if (this.disposed) return
    this.report(job, 'active')

    try {
      const device = this.devices.get(job.deviceId)
      if (device === undefined) throw new Error('That device is no longer on the canvas.')

      const bytes = await this.cdp.capture(device.target, {
        format: job.request.format,
        fullPage: job.request.fullPage,
        dpr: job.request.dpr
      })
      if (bytes === null || bytes.length === 0) {
        throw new Error('The device view did not produce an image.')
      }

      const path = await this.write(job, device, bytes)
      this.report(job, 'done', { path })
    } catch (error) {
      this.report(job, 'failed', { error: messageOf(error) })
    }
  }

  /** Write the image under the first name that is free. */
  private async write(job: Job, device: Device, bytes: Buffer): Promise<string> {
    const directory = this.directory()
    await this.fs.mkdir(directory)

    const now = this.now()
    for (let attempt = 1; attempt <= MAX_COLLISION_SUFFIX; attempt += 1) {
      const path = this.fs.join(
        directory,
        shotFileName({
          deviceName: device.name,
          width: device.width,
          height: device.height,
          now,
          format: job.request.format,
          attempt
        })
      )
      if (this.claimed.has(path)) continue
      if (await this.fs.exists(path)) continue
      // Again, and this is the check that matters: the `exists` above is an
      // await, and a job running beside this one can claim the name during it.
      // Nothing suspends between here and the `add`, so this pair is atomic.
      if (this.claimed.has(path)) continue

      this.claimed.add(path)
      try {
        await this.fs.write(path, bytes)
      } finally {
        // The file now exists (or the write failed and the name is free
        // again); either way `exists` is the authority from here on.
        this.claimed.delete(path)
      }
      return path
    }

    throw new Error('Too many screenshots of this device in the same second.')
  }

  /** Record one transition. Sends nothing by itself — see `flush`. */
  private report(
    job: Job,
    state: ShotStatePayload['state'],
    extra: Partial<ShotStatePayload> = {}
  ): void {
    if (this.disposed || this.onState === null) return

    this.pending.set(job.id, {
      id: job.id,
      batchId: job.batchId,
      batchSize: job.batchSize,
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      state,
      ...extra
    })
    this.cancelFlush ??= this.deferrer.defer(() => this.flush())
  }

  private flush(): void {
    this.cancelFlush = null
    if (this.pending.size === 0) return

    const batch = [...this.pending.values()]
    this.pending.clear()
    this.onState?.(batch)
  }
}

/**
 * Whether `path` really is inside `directory`.
 *
 * `relative` rather than `startsWith`: string prefixes say `C:\shots-private`
 * is inside `C:\shots`, and a `..` segment says nothing at all until it has
 * been resolved away. Exported for its unit test — this is the check standing
 * between the renderer and `shell.showItemInFolder`.
 */
export function isInsideDirectory(directory: string, path: string): boolean {
  if (directory === '' || path === '') return false

  const step = relative(resolve(directory), resolve(path))
  if (step === '') return false
  return !step.startsWith('..') && !isAbsolute(step)
}

/** The production filesystem: plain Node, no Electron. */
export function createNodeShotFileSystem(): ShotFileSystem {
  return {
    join,
    mkdir: async (directory) => {
      await mkdir(directory, { recursive: true })
    },
    exists: async (path) => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    write: (path, data) => writeFile(path, data),
    contains: isInsideDirectory
  }
}
