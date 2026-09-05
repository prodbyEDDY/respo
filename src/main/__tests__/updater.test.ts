import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatePayload } from '@shared/ipc'
import type { UpdateSettings } from '@shared/persistence-types'
import {
  CHECK_INTERVAL_MS,
  createUpdater,
  isCheckDue,
  loopbackFeedUrl,
  resolveUpdaterMode,
  writeFeedConfig,
  type AutoUpdaterLike,
  type Updater,
  type UpdaterMode
} from '../updater'

type Listener = (arg: unknown) => void

/** `electron-updater`'s surface, with the five events under the test's control. */
class FakeAutoUpdater implements AutoUpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowPrerelease = true
  checks = 0
  downloads = 0
  installs: [boolean | undefined, boolean | undefined][] = []
  checkResult: () => Promise<unknown> = () => Promise.resolve({})
  downloadResult: () => Promise<unknown> = () => Promise.resolve([])
  private listeners = new Map<string, Listener[]>()

  on(event: string, listener: (arg: never) => void): unknown {
    const list = this.listeners.get(event) ?? []
    list.push(listener as unknown as Listener)
    this.listeners.set(event, list)
    return this
  }

  emit(event: string, arg?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(arg)
  }

  checkForUpdates(): Promise<unknown> {
    this.checks += 1
    return this.checkResult()
  }

  downloadUpdate(): Promise<unknown> {
    this.downloads += 1
    return this.downloadResult()
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter])
  }
}

type Harness = {
  updater: Updater
  auto: FakeAutoUpdater
  states: UpdateStatePayload[]
  settings: () => UpdateSettings
  writes: number
  log: { info: string[]; warn: string[]; error: string[] }
}

const NOW = 1_700_000_000_000

function harness(
  overrides: { mode?: UpdaterMode; settings?: UpdateSettings; now?: () => number } = {}
): Harness {
  const auto = new FakeAutoUpdater()
  const states: UpdateStatePayload[] = []
  let settings: UpdateSettings = overrides.settings ?? { lastCheckAt: null, autoCheck: true }
  const log = { info: [] as string[], warn: [] as string[], error: [] as string[] }
  const out: Harness = {
    auto,
    states,
    settings: () => settings,
    writes: 0,
    log,
    updater: createUpdater({
      autoUpdater: auto,
      currentVersion: '0.1.0',
      mode: overrides.mode ?? { enabled: true, feedUrl: null },
      store: {
        read: () => settings,
        write: (next) => {
          out.writes += 1
          settings = next
        }
      },
      onState: (state) => states.push(state),
      log: {
        info: (...args) => log.info.push(args.join(' ')),
        warn: (...args) => log.warn.push(args.join(' ')),
        error: (...args) => log.error.push(args.join(' '))
      },
      now: overrides.now ?? (() => NOW),
      startupDelayMs: 100
    })
  }
  return out
}

/** Let the `checkForUpdates` / `downloadUpdate` promise settle. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function last(h: Harness): UpdateStatePayload {
  const state = h.states[h.states.length - 1]
  if (state === undefined) throw new Error('nothing was pushed')
  return state
}

describe('createUpdater', () => {
  it('turns off the automatic parts of electron-updater', () => {
    const h = harness()
    expect(h.auto.autoDownload).toBe(false)
    expect(h.auto.autoInstallOnAppQuit).toBe(true)
    expect(h.auto.allowPrerelease).toBe(false)
  })

  it('starts idle with the current version and the stored preference', () => {
    const h = harness({ settings: { lastCheckAt: 123, autoCheck: false } })
    expect(h.updater.state()).toEqual({
      stage: 'idle',
      enabled: true,
      autoCheck: false,
      current: '0.1.0',
      version: null,
      percent: null,
      error: null,
      lastCheckAt: 123
    })
  })

  it('walks available -> downloading -> downloaded -> install on two clicks', async () => {
    const h = harness()

    expect(h.updater.check().stage).toBe('checking')
    expect(h.auto.checks).toBe(1)
    h.auto.emit('update-available', { version: '0.1.1' })
    expect(last(h)).toMatchObject({ stage: 'available', version: '0.1.1', percent: null })
    // Nothing downloads on its own.
    expect(h.auto.downloads).toBe(0)

    expect(h.updater.download()).toMatchObject({ stage: 'downloading', percent: 0 })
    expect(h.auto.downloads).toBe(1)

    h.auto.emit('download-progress', { percent: 10.4 })
    expect(last(h)).toMatchObject({ stage: 'downloading', percent: 10 })
    const pushed = h.states.length
    h.auto.emit('download-progress', { percent: 10.6 })
    expect(last(h).percent).toBe(11)
    h.auto.emit('download-progress', { percent: 10.7 })
    // Same whole percent: not pushed again.
    expect(h.states.length).toBe(pushed + 1)

    h.auto.emit('update-downloaded', { version: '0.1.1' })
    expect(last(h)).toMatchObject({ stage: 'downloaded', version: '0.1.1', percent: null })

    h.updater.install()
    expect(h.auto.installs).toEqual([[true, true]])
    await settle()
  })

  it('stamps lastCheckAt only when nothing is available', () => {
    const h = harness()
    h.updater.check()
    h.auto.emit('update-available', { version: '0.1.1' })
    expect(h.settings().lastCheckAt).toBeNull()
    expect(h.writes).toBe(0)

    const again = harness()
    again.updater.check()
    again.auto.emit('update-not-available', { version: '0.1.0' })
    expect(last(again)).toMatchObject({ stage: 'up-to-date', lastCheckAt: NOW, version: null })
    expect(again.settings()).toEqual({ lastCheckAt: NOW, autoCheck: true })
  })

  it('reports a failed check without a version, and a failed download with one', () => {
    const h = harness()
    h.updater.check()
    h.auto.emit('error', new Error('ENOTFOUND github.com\n  at stack'))
    expect(last(h)).toMatchObject({
      stage: 'error',
      version: null,
      error: 'ENOTFOUND github.com'
    })
    expect(h.log.error).toHaveLength(1)

    // A download that fails keeps the version, so the chip can offer a retry.
    h.updater.check()
    h.auto.emit('update-available', { version: '0.1.1' })
    h.updater.download()
    h.auto.emit('error', new Error('sha512 mismatch'))
    expect(last(h)).toMatchObject({ stage: 'error', version: '0.1.1', error: 'sha512 mismatch' })

    // ...and the retry downloads again without a second check.
    expect(h.updater.download().stage).toBe('downloading')
    expect(h.auto.downloads).toBe(2)
    expect(h.auto.checks).toBe(2)
  })

  it('refuses to download or install out of order', () => {
    const h = harness()
    expect(h.updater.download().stage).toBe('idle')
    expect(h.auto.downloads).toBe(0)
    h.updater.install()
    expect(h.auto.installs).toEqual([])
    expect(h.log.warn).toHaveLength(1)
  })

  it('ignores a second check while one is running', () => {
    const h = harness()
    h.updater.check()
    h.updater.check()
    expect(h.auto.checks).toBe(1)
    h.auto.emit('update-available', { version: '0.1.1' })
    h.updater.download()
    expect(h.updater.check().stage).toBe('downloading')
    expect(h.auto.checks).toBe(1)
  })

  it('goes back to idle when electron-updater answers null (not active)', async () => {
    const h = harness()
    h.auto.checkResult = () => Promise.resolve(null)
    h.updater.check()
    await settle()
    expect(last(h).stage).toBe('idle')
  })

  it('reports a rejection that arrived without an error event', async () => {
    const h = harness()
    h.auto.checkResult = () => Promise.reject(new Error('boom'))
    h.updater.check()
    await settle()
    expect(last(h)).toMatchObject({ stage: 'error', error: 'boom' })

    const d = harness()
    d.updater.check()
    d.auto.emit('update-available', { version: '0.1.1' })
    d.auto.downloadResult = () => Promise.reject(new Error('disk full'))
    d.updater.download()
    await settle()
    expect(last(d)).toMatchObject({ stage: 'error', version: '0.1.1', error: 'disk full' })
  })

  it('does nothing when disabled, and says so', () => {
    const h = harness({ mode: { enabled: false, reason: 'dev' } })
    expect(h.updater.check()).toMatchObject({ stage: 'idle', enabled: false })
    expect(h.updater.download().stage).toBe('idle')
    expect(h.auto.checks).toBe(0)
    expect(h.log.info[0]).toContain('dev')
  })

  it('persists the auto-check preference and pushes the new state', () => {
    const h = harness()
    expect(h.updater.setAutoCheck(false).autoCheck).toBe(false)
    expect(h.settings()).toEqual({ lastCheckAt: null, autoCheck: false })
    expect(last(h).autoCheck).toBe(false)
  })

  describe('launch check', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('runs after the delay when never checked', () => {
      const h = harness()
      h.updater.scheduleStartupCheck()
      expect(h.auto.checks).toBe(0)
      vi.advanceTimersByTime(99)
      expect(h.auto.checks).toBe(0)
      vi.advanceTimersByTime(1)
      expect(h.auto.checks).toBe(1)
      expect(last(h).stage).toBe('checking')
    })

    it('is skipped while the last answer is fresh, and runs once it is a day old', () => {
      const fresh = harness({
        settings: { lastCheckAt: NOW - CHECK_INTERVAL_MS + 1, autoCheck: true }
      })
      fresh.updater.scheduleStartupCheck()
      vi.advanceTimersByTime(1000)
      expect(fresh.auto.checks).toBe(0)
      expect(fresh.log.info[0]).toContain('not due')

      const stale = harness({ settings: { lastCheckAt: NOW - CHECK_INTERVAL_MS, autoCheck: true } })
      stale.updater.scheduleStartupCheck()
      vi.advanceTimersByTime(1000)
      expect(stale.auto.checks).toBe(1)
    })

    it('respects the preference and the mode', () => {
      const off = harness({ settings: { lastCheckAt: null, autoCheck: false } })
      off.updater.scheduleStartupCheck()
      vi.advanceTimersByTime(1000)
      expect(off.auto.checks).toBe(0)

      const dev = harness({ mode: { enabled: false, reason: 'env' } })
      dev.updater.scheduleStartupCheck()
      vi.advanceTimersByTime(1000)
      expect(dev.auto.checks).toBe(0)
    })

    it('arms once, and dispose disarms it', () => {
      const h = harness()
      h.updater.scheduleStartupCheck()
      h.updater.scheduleStartupCheck()
      h.updater.dispose()
      vi.advanceTimersByTime(1000)
      expect(h.auto.checks).toBe(0)

      const twice = harness()
      twice.updater.scheduleStartupCheck()
      twice.updater.scheduleStartupCheck()
      vi.advanceTimersByTime(1000)
      expect(twice.auto.checks).toBe(1)
    })
  })

  it('stops pushing after dispose', () => {
    const h = harness()
    h.updater.check()
    const pushed = h.states.length
    h.updater.dispose()
    h.auto.emit('update-available', { version: '0.1.1' })
    expect(h.states.length).toBe(pushed)
    // The machine still moved — a late event is not lost, just not announced.
    expect(h.updater.state().stage).toBe('available')
  })
})

describe('isCheckDue', () => {
  it('is due when never checked, a day later, or when the stamp is from the future', () => {
    expect(isCheckDue(null, NOW)).toBe(true)
    expect(isCheckDue(NOW - CHECK_INTERVAL_MS, NOW)).toBe(true)
    expect(isCheckDue(NOW - CHECK_INTERVAL_MS + 1, NOW)).toBe(false)
    expect(isCheckDue(NOW, NOW)).toBe(false)
    expect(isCheckDue(NOW + 1, NOW)).toBe(true)
  })
})

describe('loopbackFeedUrl', () => {
  it('accepts http(s) on loopback hosts only', () => {
    expect(loopbackFeedUrl('http://127.0.0.1:8123/')).toBe('http://127.0.0.1:8123/')
    expect(loopbackFeedUrl('http://localhost:8123/feed')).toBe('http://localhost:8123/feed')
    expect(loopbackFeedUrl('https://[::1]:8443/')).toBe('https://[::1]:8443/')
    expect(loopbackFeedUrl('http://127.0.0.1:8123')).toBe('http://127.0.0.1:8123/')
  })

  it('refuses everything else', () => {
    expect(loopbackFeedUrl(undefined)).toBeNull()
    expect(loopbackFeedUrl('')).toBeNull()
    expect(loopbackFeedUrl('   ')).toBeNull()
    expect(loopbackFeedUrl('http://example.com/')).toBeNull()
    expect(loopbackFeedUrl('http://127.0.0.1.evil.example/')).toBeNull()
    expect(loopbackFeedUrl('file:///C:/feed/')).toBeNull()
    expect(loopbackFeedUrl('ftp://127.0.0.1/')).toBeNull()
    expect(loopbackFeedUrl('not a url')).toBeNull()
  })
})

describe('resolveUpdaterMode', () => {
  it('is on when packaged and off in development', () => {
    expect(resolveUpdaterMode({}, true)).toEqual({ enabled: true, feedUrl: null })
    expect(resolveUpdaterMode({}, false)).toEqual({ enabled: false, reason: 'dev' })
  })

  it('is off under RESPO_NO_UPDATER=1, packaged or not', () => {
    expect(resolveUpdaterMode({ RESPO_NO_UPDATER: '1' }, true)).toEqual({
      enabled: false,
      reason: 'env'
    })
    expect(
      resolveUpdaterMode({ RESPO_NO_UPDATER: '1', RESPO_UPDATE_URL: 'http://127.0.0.1:1/' }, false)
    ).toEqual({ enabled: false, reason: 'env' })
    expect(resolveUpdaterMode({ RESPO_NO_UPDATER: '0' }, true)).toEqual({
      enabled: true,
      feedUrl: null
    })
  })

  it('takes a loopback feed anywhere and ignores any other', () => {
    expect(resolveUpdaterMode({ RESPO_UPDATE_URL: 'http://127.0.0.1:8123/' }, false)).toEqual({
      enabled: true,
      feedUrl: 'http://127.0.0.1:8123/'
    })
    const warns: string[] = []
    const log = {
      info: () => undefined,
      warn: (...args: unknown[]) => warns.push(args.join(' ')),
      error: () => undefined
    }
    expect(resolveUpdaterMode({ RESPO_UPDATE_URL: 'https://evil.example/' }, true, log)).toEqual({
      enabled: true,
      feedUrl: null
    })
    expect(resolveUpdaterMode({ RESPO_UPDATE_URL: 'https://evil.example/' }, false, log)).toEqual({
      enabled: false,
      reason: 'dev'
    })
    expect(warns).toHaveLength(2)
  })
})

describe('writeFeedConfig', () => {
  it('writes the generic-provider config a packaged build would carry', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'respo-feed-'))
    try {
      const path = writeFeedConfig(dir, 'http://127.0.0.1:8123/')
      expect(path).toBe(join(dir, 'respo-update-feed.yml'))
      expect(readFileSync(path, 'utf8')).toBe(
        'provider: generic\nurl: "http://127.0.0.1:8123/"\nupdaterCacheDirName: respo-updater-test\n'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
