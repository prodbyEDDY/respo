import { create } from 'zustand'
import type {
  MainEvent,
  RespoApi,
  ShotDpr,
  ShotFormat,
  ShotRequest,
  ShotStatePayload
} from '@shared/ipc'
import type { ScreenshotSettings } from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'

/**
 * The renderer's half of screenshots: what is in flight, and what to say when
 * it lands.
 *
 * Main owns the queue, the disk and the settings — the renderer starts captures
 * and listens. Everything here is derived from the batched `shot-state` events,
 * which is why a batch is counted rather than tracked: main says "job 3 of 5 is
 * done" and the count is a fold over what has arrived, not a second copy of
 * main's state that could drift from it.
 */

/** One line of feedback about a finished gesture. */
export type ShotNotice = {
  id: number
  tone: 'ok' | 'error'
  text: string
  /**
   * The file to offer "Show in folder" for. Only set when exactly one landed —
   * a folder is the answer to five of them, and that is where they all are.
   */
  path?: string
}

/** What one gesture is doing, as the toolbar shows it. */
export type ShotProgress = { done: number; total: number }

type Batch = {
  size: number
  /** Paths written so far, in the order they landed. */
  paths: string[]
  failed: number
}

export interface ShotsState {
  /** Where screenshots go and what they look like. Mirrors the document. */
  settings: ScreenshotSettings
  /** The folder main actually writes to — the default, resolved. */
  directory: string
  /**
   * Devices with a capture queued or running. Derived from `jobs`, never
   * written directly.
   */
  busy: Record<string, true>
  /**
   * The device behind every job that has not reached a terminal state, by job
   * id.
   *
   * Keyed by job rather than by device because a device can be in two batches
   * at once — "screenshot everything" while one device's own capture is still
   * queued — and a terminal event for the first job would otherwise clear a
   * spinner the second one still needs.
   */
  jobs: Record<string, string>
  /**
   * Bumped every time a device's screenshot lands. The frame watches the number
   * rather than a boolean, so two shots in a row flash twice.
   */
  flash: Record<string, number>
  /** Unfinished batches, by id. */
  batches: Record<string, Batch>
  notice: ShotNotice | null

  /** Screenshot one device. `fullPage` is the whole document. */
  capture: (deviceId: string, request?: Partial<ShotRequest>) => void
  /** Screenshot every device on the canvas. */
  captureAll: (request?: Partial<ShotRequest>) => void
  /** Put one device's viewport on the clipboard instead of on disk. */
  copy: (deviceId: string) => void
  /** Ask main to show a saved file in the file manager. */
  reveal: (path: string) => void

  /** Install a batch of `shot-state` events. Idempotent per job. */
  apply: (batch: readonly ShotStatePayload[]) => void
  /** Put the notice away — the timer, or the user. */
  dismiss: (id?: number) => void

  setFormat: (format: ShotFormat) => void
  setDpr: (dpr: ShotDpr) => void
  /** Open the folder dialog in main and keep what the user picked. */
  chooseDirectory: () => Promise<void>
  /** Ask main where screenshots are going right now. */
  refreshDirectory: () => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (settings: ScreenshotSettings) => void
}

export const DEFAULT_SHOT_SETTINGS: ScreenshotSettings = {
  directory: '',
  format: 'png',
  dpr: 'device'
}

/** Long enough to read a path, short enough to stay out of the way. */
const NOTICE_MS = 6000
/** A failure is worth a longer look — it usually names something to fix. */
const ERROR_NOTICE_MS = 10_000

let noticeSequence = 0
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** Run something against the bridge, or do nothing outside Electron. */
function withBridge<T>(run: (bridge: RespoApi) => Promise<T>, then?: (answer: T) => void): void {
  const bridge = ipcBridge()
  if (bridge === null) return
  void run(bridge).then(
    (answer) => then?.(answer),
    (error: unknown) => {
      console.error('screenshot ipc failed', error)
    }
  )
}

export const useShots = create<ShotsState>((set, get) => ({
  settings: { ...DEFAULT_SHOT_SETTINGS },
  directory: '',
  busy: {},
  jobs: {},
  flash: {},
  batches: {},
  notice: null,

  capture: (deviceId, request = {}) => {
    withBridge((bridge) => bridge.invoke('shot:device', deviceId, { fullPage: false, ...request }))
  },

  captureAll: (request = {}) => {
    withBridge(
      (bridge) => bridge.invoke('shot:all', { fullPage: false, ...request }),
      (started) => {
        // Nothing on the canvas is not a failure, but it is worth saying:
        // otherwise the click looks broken.
        if (started.queued === 0) say(set, 'error', 'There are no devices to screenshot.')
      }
    )
  },

  copy: (deviceId) => {
    withBridge(
      (bridge) => bridge.invoke('shot:copy', deviceId),
      (ok) => {
        if (ok) {
          say(set, 'ok', 'Copied to the clipboard')
          bumpFlash(set, deviceId)
        } else say(set, 'error', 'That device could not be copied.')
      }
    )
  },

  reveal: (path) => {
    withBridge((bridge) => bridge.invoke('shot:reveal', path))
  },

  apply: (batch) => {
    const state = get()
    const jobs = { ...state.jobs }
    const flash = { ...state.flash }
    const batches = { ...state.batches }
    const finished: { batchId: string; batch: Batch }[] = []

    for (const event of batch) {
      const current = batches[event.batchId] ?? { size: event.batchSize, paths: [], failed: 0 }

      if (event.state === 'queued' || event.state === 'active') {
        jobs[event.id] = event.deviceId
        batches[event.batchId] = current
        continue
      }

      // Only this job. Another batch may still have one queued for the same
      // device, and its spinner has to survive this one landing.
      delete jobs[event.id]
      const next: Batch = {
        size: event.batchSize,
        paths:
          event.state === 'done' && event.path !== undefined
            ? [...current.paths, event.path]
            : current.paths,
        failed: event.state === 'failed' ? current.failed + 1 : current.failed
      }
      batches[event.batchId] = next
      if (event.state === 'done') flash[event.deviceId] = (flash[event.deviceId] ?? 0) + 1

      if (next.paths.length + next.failed >= next.size) {
        delete batches[event.batchId]
        finished.push({ batchId: event.batchId, batch: next })
      }
    }

    set({ jobs, busy: busyOf(jobs), flash, batches })
    // One notice per gesture, and the newest one wins: two batches finishing in
    // the same message is a race the user does not need narrated twice.
    for (const { batch: done } of finished) report(set, done)
  },

  dismiss: (id) => {
    const notice = get().notice
    if (notice === null) return
    if (id !== undefined && notice.id !== id) return
    clearNoticeTimer()
    set({ notice: null })
  },

  setFormat: (format) => {
    if (get().settings.format === format) return
    persist(set, get, { format })
  },

  setDpr: (dpr) => {
    if (get().settings.dpr === dpr) return
    persist(set, get, { dpr })
  },

  chooseDirectory: async () => {
    const bridge = ipcBridge()
    if (bridge === null) return
    try {
      const directory = await bridge.invoke('shot:choose-dir')
      // Dismissing the dialog is a decision, not a failure: nothing changes.
      if (directory === null) return
      // Nothing is written back. Main ran the dialog *and* the write — the
      // folder is its field, and a `store:save` carrying one is ignored (see
      // `validateScreenshotSettings`). This only reflects what it reported.
      set({ settings: { ...get().settings, directory }, directory })
    } catch (error) {
      console.error('shot:choose-dir failed', error)
    }
  },

  refreshDirectory: () => {
    withBridge(
      (bridge) => bridge.invoke('shot:get-dir'),
      (directory) => set({ directory })
    )
  },

  hydrate: (settings) => {
    set({ settings: { ...settings } })
  }
}))

type Set = (partial: Partial<ShotsState>) => void

/** Which devices have at least one unfinished job. See `ShotsState.jobs`. */
function busyOf(jobs: Record<string, string>): Record<string, true> {
  const busy: Record<string, true> = {}
  for (const deviceId of Object.values(jobs)) busy[deviceId] = true
  return busy
}

function clearNoticeTimer(): void {
  if (noticeTimer === null) return
  clearTimeout(noticeTimer)
  noticeTimer = null
}

/** Show one line of feedback, and take it away again on its own. */
function say(set: Set, tone: ShotNotice['tone'], text: string, path?: string): void {
  clearNoticeTimer()
  noticeSequence += 1
  const notice: ShotNotice = {
    id: noticeSequence,
    tone,
    text,
    ...(path === undefined ? {} : { path })
  }
  set({ notice })

  noticeTimer = setTimeout(
    () => {
      noticeTimer = null
      useShots.getState().dismiss(notice.id)
    },
    tone === 'error' ? ERROR_NOTICE_MS : NOTICE_MS
  )
  // A pending notice must never keep a test process alive.
  ;(noticeTimer as { unref?: () => void }).unref?.()
}

/** Turn a finished batch into the one sentence it is worth. */
function report(set: Set, batch: Batch): void {
  const saved = batch.paths.length
  const first = batch.paths[0]

  if (batch.failed === 0) {
    if (saved === 1 && first !== undefined) {
      say(set, 'ok', `Saved ${fileNameOf(first)}`, first)
      return
    }
    say(set, 'ok', `Saved ${saved} screenshots`)
    return
  }

  if (saved === 0) {
    say(
      set,
      'error',
      saved + batch.failed === 1 ? 'The screenshot failed' : 'Every screenshot failed'
    )
    return
  }
  say(set, 'error', `Saved ${saved} of ${saved + batch.failed} screenshots`)
}

function bumpFlash(set: Set, deviceId: string): void {
  const flash = { ...useShots.getState().flash }
  flash[deviceId] = (flash[deviceId] ?? 0) + 1
  set({ flash })
}

/** Change one setting and write the whole slice back. */
function persist(set: Set, get: () => ShotsState, patch: Partial<ScreenshotSettings>): void {
  const settings = { ...get().settings, ...patch }
  set({ settings })
  savePersistedState({ screenshots: settings })
}

/**
 * How far along the gestures currently in flight are, or `null` for idle.
 *
 * Takes the batches rather than the whole state, and must be called on a
 * *memoized* value in a component — it builds a fresh object every time, and a
 * zustand selector that never returns the same reference twice re-renders
 * forever (React error #185). `useShotProgress` is the safe way in; this is
 * kept exported for the store's own tests.
 */
export function progressOf(batches: Record<string, Batch>): ShotProgress | null {
  let done = 0
  let total = 0
  for (const batch of Object.values(batches)) {
    total += batch.size
    done += batch.paths.length + batch.failed
  }
  return total === 0 ? null : { done, total }
}

/** `progressOf`, against the whole state. For tests and non-React callers. */
export function selectProgress(state: ShotsState): ShotProgress | null {
  return progressOf(state.batches)
}

/** Whether this device has a capture queued or running. */
export function selectIsBusy(state: ShotsState, deviceId: string): boolean {
  return state.busy[deviceId] === true
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's batched `shot-state` messages.
 *
 * Reference-counted like the other bridges: React StrictMode mounts, tears down
 * and re-mounts in development, and the subscription must survive that without
 * ending up attached twice.
 */
export function attachShotsBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type === 'shot-state') useShots.getState().apply(event.payload)
      }) ?? (() => undefined)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    subscribers -= 1
    if (subscribers > 0) return
    unsubscribe?.()
    unsubscribe = null
  }
}
