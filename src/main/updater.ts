/**
 * Updates, as one small state machine over `electron-updater`.
 *
 * The rules the owner set (ROADMAP §11, 2026-09-05), in code:
 *
 * - a check on launch at most once a day, plus manual ones from About;
 * - nothing downloads without a click — `autoDownload` is off and
 *   `download()` is the chip's click and nothing else;
 * - one click more installs: silent NSIS install, the app relaunches itself;
 * - no dialogs, no notifications. The toolbar chip is the whole UI, and it is
 *   only there while there is something to say.
 *
 * `electron-updater` itself is behind `AutoUpdaterLike`, so the machine is unit
 * tested against a fake that emits the same five events — and so the module
 * never has to import Electron.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStage, UpdateStatePayload } from '@shared/ipc'
import type { UpdateSettings } from '@shared/persistence-types'
import type { Logger } from './log'

/** How long a "nothing new" answer is trusted before the next launch checks. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * How long after launch the daily check runs. Late enough that the window is
 * up and the first page is loading — an update is the least urgent thing that
 * happens at startup.
 */
export const STARTUP_CHECK_DELAY_MS = 10_000

/** An error message is one line in a tooltip; a stack trace is not. */
const MAX_ERROR_LENGTH = 300

/** What `update-available` / `update-downloaded` carry that matters here. */
export type UpdateInfoLike = { version: string }
export type ProgressLike = { percent: number }

/**
 * The slice of `electron-updater`'s `AppUpdater` this machine drives. Its
 * `autoUpdater` singleton satisfies it as is.
 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: ProgressLike) => void): unknown
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

/**
 * Whether this process checks for updates at all, and where.
 *
 * `feedUrl` is the e2e seam: a `generic` provider on a loopback address, so a
 * spec can serve a `latest.yml` and an installer from a local http server and
 * walk the whole chip path for real. Anything not loopback is refused — the
 * feed is the one thing that decides what gets installed, and an environment
 * variable is not a place to take that from (spec §7a).
 */
export type UpdaterMode =
  { enabled: true; feedUrl: string | null } | { enabled: false; reason: 'dev' | 'env' }

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** A loopback http(s) url, or `null` for anything else. */
export function loopbackFeedUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  return url.href
}

/**
 * Decide the mode from the environment.
 *
 * - `RESPO_NO_UPDATER=1` turns it off anywhere, packaged or not.
 * - `RESPO_UPDATE_URL=http://127.0.0.1:…/` turns it on anywhere, against that
 *   feed; a non-loopback value is ignored with a warning.
 * - otherwise: on when packaged, off in development (`npm run dev`, e2e).
 */
export function resolveUpdaterMode(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
  log?: Logger
): UpdaterMode {
  if (env['RESPO_NO_UPDATER'] === '1') return { enabled: false, reason: 'env' }

  const requested = env['RESPO_UPDATE_URL']
  if (requested !== undefined && requested.trim() !== '') {
    const feedUrl = loopbackFeedUrl(requested)
    if (feedUrl !== null) return { enabled: true, feedUrl }
    log?.warn(`ignoring RESPO_UPDATE_URL: not a loopback http(s) url`)
  }

  if (!isPackaged) return { enabled: false, reason: 'dev' }
  return { enabled: true, feedUrl: null }
}

/** The cache folder a test feed's pending installer goes to, never the real one's. */
export const TEST_FEED_CACHE_DIR = 'respo-updater-test'
export const TEST_FEED_CONFIG_FILE = 'respo-update-feed.yml'

/**
 * Write the update config a loopback feed runs against, and answer its path.
 *
 * The same shape electron-builder writes into `resources/app-update.yml`, and
 * handed to `electron-updater` the same way (`updateConfigPath`): the whole
 * pipeline — provider, cache folder name, manifest, download — then runs
 * exactly as it does in a packaged build. `setFeedURL` would not do: it swaps
 * the provider only, and the download step still reads the file on disk.
 */
export function writeFeedConfig(dir: string, feedUrl: string): string {
  const path = join(dir, TEST_FEED_CONFIG_FILE)
  // A JSON string is a valid YAML double-quoted scalar, whatever the url holds.
  const text = [
    'provider: generic',
    `url: ${JSON.stringify(feedUrl)}`,
    `updaterCacheDirName: ${TEST_FEED_CACHE_DIR}`,
    ''
  ].join('\n')
  writeFileSync(path, text, 'utf8')
  return path
}

export type UpdaterStore = {
  read(): UpdateSettings
  write(next: UpdateSettings): void
}

export type UpdaterOptions = {
  autoUpdater: AutoUpdaterLike
  currentVersion: string
  mode: UpdaterMode
  store: UpdaterStore
  onState: (state: UpdateStatePayload) => void
  log: Logger
  /** Test seams. */
  now?: () => number
  startupDelayMs?: number
}

export type Updater = {
  state(): UpdateStatePayload
  /** A manual check. A no-op while a check or a download is running. */
  check(): UpdateStatePayload
  /** The chip's click: start downloading what the last check found. */
  download(): UpdateStatePayload
  /** The chip's second click: silent install, relaunch. */
  install(): void
  setAutoCheck(enabled: boolean): UpdateStatePayload
  /** Arm the launch check, if one is due. Call once, after the window exists. */
  scheduleStartupCheck(): void
  dispose(): void
}

/** Whether the daily check is due, given when the last "nothing new" was. */
export function isCheckDue(lastCheckAt: number | null, now: number): boolean {
  if (lastCheckAt === null) return true
  // A stamp from the future is a clock that moved; treat it as no stamp.
  if (lastCheckAt > now) return true
  return now - lastCheckAt >= CHECK_INTERVAL_MS
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split('\n', 1)[0] ?? ''
  return line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH - 1)}…` : line
}

export function createUpdater(options: UpdaterOptions): Updater {
  const { autoUpdater, mode, store, log } = options
  const now = options.now ?? Date.now
  const startupDelayMs = options.startupDelayMs ?? STARTUP_CHECK_DELAY_MS

  let stage: UpdateStage = 'idle'
  let version: string | null = null
  let percent: number | null = null
  let error: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const state = (): UpdateStatePayload => {
    const settings = store.read()
    return {
      stage,
      enabled: mode.enabled,
      autoCheck: settings.autoCheck,
      current: options.currentVersion,
      version,
      percent,
      error,
      lastCheckAt: settings.lastCheckAt
    }
  }

  const emit = (): UpdateStatePayload => {
    const payload = state()
    if (!disposed) options.onState(payload)
    return payload
  }

  const move = (
    next: UpdateStage,
    patch: Partial<{ version: string | null; percent: number | null; error: string | null }> = {}
  ): void => {
    stage = next
    if (patch.version !== undefined) version = patch.version
    if (patch.percent !== undefined) percent = patch.percent
    if (patch.error !== undefined) error = patch.error
    emit()
  }

  const fail = (cause: unknown): void => {
    const message = describe(cause)
    log.error(`updater: ${stage} failed: ${message}`)
    // The version survives a failed download so the chip can offer a retry; a
    // failed check never had one.
    move('error', { version: stage === 'checking' ? null : version, percent: null, error: message })
  }

  // Nothing happens without a click, and a downloaded update that was never
  // installed goes in on quit — the user already said yes to it.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('update-available', (info) => {
    log.info(`updater: ${info.version} available`)
    move('available', { version: info.version, percent: null, error: null })
  })

  autoUpdater.on('update-not-available', () => {
    log.info('updater: up to date')
    store.write({ ...store.read(), lastCheckAt: now() })
    move('up-to-date', { version: null, percent: null, error: null })
  })

  autoUpdater.on('download-progress', (progress) => {
    if (stage !== 'downloading') return
    const next = Math.max(0, Math.min(100, Math.round(progress.percent)))
    // Whole percents only: the chip shows an integer, and a message per chunk
    // would be the per-event stream CLAUDE.md §4 forbids.
    if (next === percent) return
    percent = next
    emit()
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`updater: ${info.version} downloaded`)
    move('downloaded', { version: info.version, percent: null, error: null })
  })

  autoUpdater.on('error', (cause) => {
    fail(cause)
  })

  const check = (): UpdateStatePayload => {
    if (!mode.enabled) {
      log.info(`updater: check skipped (${mode.reason})`)
      return state()
    }
    if (stage === 'checking' || stage === 'downloading') return state()

    move('checking', { percent: null, error: null })
    void autoUpdater.checkForUpdates().then(
      (result) => {
        // `null` is electron-updater saying it is not active at all. It has
        // already said why in the log; do not sit in `checking` forever.
        if (result === null && stage === 'checking') move('idle')
      },
      (cause: unknown) => {
        // Already reported through the `error` event in every version we have
        // seen; this is the belt to that brace.
        if (stage === 'checking') fail(cause)
      }
    )
    return state()
  }

  const download = (): UpdateStatePayload => {
    if (!mode.enabled) return state()
    // From `available`, or from a download that failed — the check's result is
    // still in the updater, so a retry needs no second check.
    if (!(stage === 'available' || (stage === 'error' && version !== null))) return state()

    move('downloading', { percent: 0, error: null })
    void autoUpdater.downloadUpdate().catch((cause: unknown) => {
      if (stage === 'downloading') fail(cause)
    })
    return state()
  }

  const install = (): void => {
    if (stage !== 'downloaded') {
      log.warn(`updater: install asked in stage ${stage}`)
      return
    }
    log.info(`updater: installing ${version ?? '?'}`)
    // Silent, and run the app again when it is done. If the relaunch does not
    // happen the install still did — the next manual launch is the new build.
    autoUpdater.quitAndInstall(true, true)
  }

  const setAutoCheck = (enabled: boolean): UpdateStatePayload => {
    store.write({ ...store.read(), autoCheck: enabled })
    return emit()
  }

  const scheduleStartupCheck = (): void => {
    if (!mode.enabled) return
    const settings = store.read()
    if (!settings.autoCheck) return
    if (!isCheckDue(settings.lastCheckAt, now())) {
      log.info('updater: launch check not due')
      return
    }
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      check()
    }, startupDelayMs)
    // Never keep the process alive for it.
    ;(timer as { unref?: () => void }).unref?.()
  }

  return {
    state,
    check,
    download,
    install,
    setAutoCheck,
    scheduleStartupCheck,
    dispose: () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }
}
