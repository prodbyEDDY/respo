import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'

/**
 * Launched by *directory*, unlike the other specs: Electron then reads the
 * project's `package.json` and `app.getVersion()` answers `0.1.0`. Launched by
 * the entry file it answers Electron's own version, and a 44.0.0 app has no
 * update to 0.1.1 ("downgrade is disallowed").
 */
const ROOT = resolve(__dirname, '..')

/**
 * The whole update path, for real: `electron-updater` against a `generic`
 * feed on loopback, serving a `latest.yml` and a three-megabyte "installer".
 *
 * Everything below the chip is the real thing — the check, the version
 * compare, the download with its progress events, the sha512 check, the
 * pending-file cache. The one call that is stubbed is the very last one,
 * `quitAndInstall`, because running a file of random bytes as an installer is
 * not a test of anything. A real install is verified by hand with a real
 * build (W6 log, Task A4).
 */
const NEXT_VERSION = '0.1.1'
const INSTALLER_NAME = `Respo-Setup-${NEXT_VERSION}.exe`
const INSTALLER_BYTES = 3 * 1024 * 1024
/** Sent in slices, so the download is long enough to show a percentage. */
const CHUNK = 256 * 1024
const CHUNK_DELAY_MS = 30

/** Where electron-updater keeps a pending installer for the test feed (`updater.ts`). */
const CACHE_DIR = join(process.env['LOCALAPPDATA'] ?? '', 'respo-updater-test')

const profile = ownProfile('updater')

type Feed = { server: Server; url: string; requests: string[] }

function startFeed(): Promise<Feed> {
  const installer = randomBytes(INSTALLER_BYTES)
  const sha512 = createHash('sha512').update(installer).digest('base64')
  const latest = [
    `version: ${NEXT_VERSION}`,
    'files:',
    `  - url: ${INSTALLER_NAME}`,
    `    sha512: ${sha512}`,
    `    size: ${INSTALLER_BYTES}`,
    `path: ${INSTALLER_NAME}`,
    `sha512: ${sha512}`,
    `releaseDate: '2026-09-05T00:00:00.000Z'`,
    ''
  ].join('\n')

  const requests: string[] = []
  const server = createServer((req, res) => {
    // electron-updater appends `?noCache=<id>` to the manifest request.
    const path = (req.url ?? '').split('?', 1)[0] ?? ''
    requests.push(`${req.method} ${path}`)
    if (path === '/latest.yml') {
      res.writeHead(200, { 'content-type': 'text/yaml', 'content-length': latest.length })
      res.end(latest)
      return
    }
    if (path === `/${INSTALLER_NAME}`) {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': INSTALLER_BYTES
      })
      let offset = 0
      const next = (): void => {
        if (offset >= INSTALLER_BYTES) {
          res.end()
          return
        }
        res.write(installer.subarray(offset, offset + CHUNK))
        offset += CHUNK
        setTimeout(next, CHUNK_DELAY_MS)
      }
      next()
      return
    }
    // The blockmap for a differential download, and anything else: not here.
    res.writeHead(404)
    res.end()
  })

  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      done({ server, url: `http://127.0.0.1:${port}/`, requests })
    })
  })
}

function launch(feedUrl: string): Promise<ElectronApplication> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    RESPO_START_URL: PROBE_URL,
    RESPO_UPDATE_URL: feedUrl
  }
  // The off switch wins over the feed (`resolveUpdaterMode`); a CI job that
  // sets it must not switch this spec's feed off with it.
  delete env['RESPO_NO_UPDATER']
  return electron.launch({ args: [ROOT, `--user-data-dir=${profile}`], env })
}

let feed: Feed

// NSIS is the Windows updater; the cache folder below is Windows' too.
test.skip(process.platform !== 'win32', 'the NSIS update path is Windows-only')

test.beforeAll(async () => {
  rmSync(CACHE_DIR, { recursive: true, force: true })
  feed = await startFeed()
})

test.afterAll(async () => {
  await new Promise<void>((done) => feed.server.close(() => done()))
  rmSync(CACHE_DIR, { recursive: true, force: true })
})

test('the launch check finds a release, and the chip downloads and installs it', async () => {
  const app = await launch(feed.url)
  try {
    const window = await app.firstWindow()
    await window.waitForFunction(() => 'respo' in window)

    // Nothing in the toolbar until the check has landed — and the check runs
    // on its own, ten seconds after launch, without anyone clicking anything.
    const chip = window.locator('[data-slot="update-chip"]')
    await expect(chip).toHaveCount(0)
    await expect(chip).toHaveAttribute('data-stage', 'available', { timeout: 30_000 })
    await expect(chip).toHaveText(`Update to ${NEXT_VERSION}`)
    expect(feed.requests).toEqual(['GET /latest.yml'])

    // A check is not a download.
    await expect(chip).toHaveAttribute('data-stage', 'available')
    expect(feed.requests.some((r) => r.includes(INSTALLER_NAME))).toBe(false)

    // Click one: download, with progress in the same chip.
    await chip.click()
    await expect(chip).toHaveAttribute('data-stage', 'downloading')
    await expect(chip).toHaveText(/Updating… \d+%/)
    await expect(chip).toBeDisabled()

    await expect(chip).toHaveAttribute('data-stage', 'downloaded', { timeout: 30_000 })
    await expect(chip).toHaveText('Restart to update')
    await expect(chip).toBeEnabled()
    expect(feed.requests).toContain(`GET /${INSTALLER_NAME}`)

    // The state main holds is the same story, and it names the version.
    const status = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      return respo.invoke('updates:get')
    })
    expect(status).toMatchObject({
      stage: 'downloaded',
      version: NEXT_VERSION,
      enabled: true,
      percent: null,
      error: null
    })
    // Finding an update does not stamp the daily check: the next launch asks
    // again and the chip comes straight back.
    expect(status.lastCheckAt).toBeNull()

    // About says the same, from the menu.
    await window.getByLabel('More options').click()
    await window.getByRole('menuitem', { name: 'About Respo' }).click()
    const about = window.locator('[data-slot="about-dialog"]')
    await expect(about.locator('[data-slot="about-version"]')).toHaveText('Version 0.1.0')
    await expect(about.locator('[data-slot="update-summary"]')).toHaveText(
      `Respo ${NEXT_VERSION} is ready to install.`
    )
    await expect(about.getByRole('button', { name: 'Restart to update' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(about).toHaveCount(0)

    // Click two: quit and install. The installer is random bytes, so the OS
    // call is replaced — on the singleton main itself drives — and the test
    // asserts it was reached with "silent, then relaunch".
    await app.evaluate(({ app: electronApp }) => {
      // No `require` in Playwright's evaluate scope; build one at the app path,
      // which is the project root here — the same `node_modules` main loaded.
      const { createRequire } = process.getBuiltinModule('node:module') as {
        createRequire: (from: string) => (id: string) => unknown
      }
      const load = createRequire(`${electronApp.getAppPath()}/`)
      const { autoUpdater } = load('electron-updater') as {
        autoUpdater: { quitAndInstall: (silent?: boolean, run?: boolean) => void }
      }
      const calls: unknown[] = []
      ;(globalThis as { __respoInstall?: unknown[] }).__respoInstall = calls
      autoUpdater.quitAndInstall = (silent, run) => {
        calls.push([silent, run])
      }
    })
    await chip.click()
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { __respoInstall?: unknown[] }).__respoInstall ?? [])
      )
      .toEqual([[true, true]])
  } finally {
    await app.close()
  }
})

type RespoBridge = {
  invoke(channel: 'updates:get'): Promise<{
    stage: string
    version: string | null
    enabled: boolean
    percent: number | null
    error: string | null
    lastCheckAt: number | null
  }>
}
