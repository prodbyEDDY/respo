import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const FIXTURE = readFileSync(resolve(__dirname, 'fixtures', 'emulation.html'), 'utf8')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('emulation-pack')

/** What `e2e/fixtures/emulation.html` publishes through `document.title`. */
type EnvProbe = {
  dark: boolean
  reducedMotion: boolean
  forcedColors: boolean
  print: boolean
  language: string
  locale: string
  timeZone: string
  online: boolean
  innerWidth: number
}

/**
 * A server for the fixture, because two of the claims cannot be made against
 * a `file:` page: the `Accept-Language` header only exists on a request, and
 * Chromium's offline emulation lives in the network service, which a local
 * file never touches. It records the language header of every request.
 */
function startServer(): Promise<{ server: Server; url: string; languages: string[] }> {
  const languages: string[] = []
  const server = createServer((request, response) => {
    // Only the page itself. Respo fetches `/favicon.ico` through the session
    // (`main/favicons.ts`), outside any device view and outside the override —
    // it is not a request the page made.
    if (request.url !== '/') {
      response.writeHead(404)
      response.end()
      return
    }
    languages.push(String(request.headers['accept-language'] ?? ''))
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(FIXTURE)
  })
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      done({ server, url: `http://127.0.0.1:${address.port}/`, languages })
    })
  })
}

/** The probe every device view is reporting, read from main (see `probe.ts`). */
async function envProbes(app: ElectronApplication, url: string): Promise<EnvProbe[]> {
  const titles = await app.evaluate(({ webContents }, probeUrl: string) => {
    return webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL() === probeUrl)
      .map((wc) => wc.getTitle())
  }, url)
  return titles.flatMap((title) => {
    try {
      return [JSON.parse(title) as EnvProbe]
    } catch {
      return []
    }
  })
}

/** Wait until every one of the five views agrees with `check`. */
async function expectEveryView(
  app: ElectronApplication,
  url: string,
  check: (probe: EnvProbe) => boolean,
  message: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const probes = await envProbes(app, url)
        return probes.length === 5 && probes.every(check)
      },
      { timeout: 30_000, message }
    )
    .toBe(true)
}

/**
 * Reload every device and wait until the server has seen all five requests
 * and every frame has settled. Waiting on the request count is what makes
 * this deterministic: the probes keep their old title until the new document
 * runs, so "the values are right" alone could be answered by the old page.
 */
async function reloadAll(
  page: Page,
  languages: string[],
  settled: 'ready' | 'failed'
): Promise<void> {
  const before = languages.length
  await page.keyboard.press('Escape')
  await page.locator('button[aria-label="Reload"]').click()
  if (settled === 'ready')
    await expect.poll(() => languages.length).toBeGreaterThanOrEqual(before + 5)
  await expect(page.locator(`[data-load-state="${settled}"]`)).toHaveCount(5)
}

function launch(url: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: url }
  })
}

const EMULATE_BUTTON = 'button[aria-label="Emulate media, vision, network and location"]'

async function openEmulate(page: Page): Promise<void> {
  const popover = page.locator('[data-testid="emulate-popover"]')
  if ((await popover.count()) === 0) await page.locator(EMULATE_BUTTON).click()
  await expect(popover).toBeVisible()
}

/** Pick one option of a Radix select by its trigger's label. */
async function pick(page: Page, trigger: string, option: string | RegExp): Promise<void> {
  // Right after the views reload, the popover can lose focus to a view and
  // close itself between the open and the click — a race a person would
  // answer by clicking again. So does this.
  await expect(async () => {
    await openEmulate(page)
    await page.locator(`button[aria-label="${trigger}"]`).click({ timeout: 3000 })
    await page.getByRole('option', { name: option }).click({ timeout: 3000 })
  }).toPass({ timeout: 30_000 })
}

test('the emulation pack reaches every page, survives navigation, and restarts with the app', async () => {
  const { server, url, languages } = await startServer()
  const app = await launch(url)

  try {
    const page = await app.firstWindow()
    await expectEveryView(app, url, (p) => p.innerWidth > 0, 'views never reported a probe')
    // The host's own reduced-motion setting: the reset check below must not
    // assume a machine that has it off (CI runners have it on).
    const baseline = (await envProbes(app, url))[0]
    await expect(page.locator(EMULATE_BUTTON)).toHaveAttribute('data-emulating', 'off')
    languages.length = 0

    // Colour scheme, both ways — the host's own preference is unknown here.
    await openEmulate(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    await expectEveryView(app, url, (p) => !p.dark, 'light never reached the pages')
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expectEveryView(app, url, (p) => p.dark, 'dark never reached the pages')
    await expect(page.locator(EMULATE_BUTTON)).toHaveAttribute('data-emulating', 'on')

    // A media feature and a media type.
    await page.getByRole('checkbox', { name: 'Reduced motion' }).click()
    await expectEveryView(
      app,
      url,
      (p) => p.reducedMotion,
      'reduced motion never reached the pages'
    )
    await page.getByRole('radio', { name: 'Print' }).click()
    await expectEveryView(app, url, (p) => p.print, 'print never reached the pages')
    await page.getByRole('radio', { name: 'Auto' }).click()
    await expectEveryView(app, url, (p) => !p.print, 'screen never came back')

    // Locale: `navigator.language` and `Intl` both follow it.
    await pick(page, 'Locale', /German/)
    await expectEveryView(
      app,
      url,
      (p) => p.language === 'de-DE' && p.locale.startsWith('de'),
      'de-DE never reached the pages'
    )

    // Time zone.
    await pick(page, 'Time zone', 'Asia/Tokyo')
    await expectEveryView(
      app,
      url,
      (p) => p.timeZone === 'Asia/Tokyo',
      'Tokyo never reached the pages'
    )

    // Survives navigation: the overrides live in the CDP session, not the
    // document. The reload is also the request the language header rides on.
    languages.length = 0
    await reloadAll(page, languages, 'ready')
    await expectEveryView(
      app,
      url,
      (p) => p.dark && p.reducedMotion && p.language === 'de-DE' && p.timeZone === 'Asia/Tokyo',
      'the environment did not survive a reload'
    )
    expect(languages).toHaveLength(5)
    expect(languages.every((header) => header.startsWith('de-DE'))).toBe(true)

    // Offline fails the next load on every device.
    await pick(page, 'Network', 'Offline')
    await expectEveryView(app, url, (p) => !p.online, 'navigator.onLine never went false')
    await reloadAll(page, languages, 'failed')

    // Reset all: back online, everything off, badge off.
    await openEmulate(page)
    await page.getByRole('button', { name: 'Reset all' }).click()
    await expect(page.locator(EMULATE_BUTTON)).toHaveAttribute('data-emulating', 'off')
    await reloadAll(page, languages, 'ready')
    await expectEveryView(
      app,
      url,
      (p) =>
        p.online &&
        p.reducedMotion === baseline.reducedMotion &&
        p.language !== 'de-DE' &&
        p.timeZone !== 'Asia/Tokyo',
      'reset did not restore the real environment'
    )

    // Leave something on for the restart below.
    await openEmulate(page)
    await page.getByRole('radio', { name: 'Dark' }).click()
    await pick(page, 'Locale', /French/)
    await expectEveryView(
      app,
      url,
      (p) => p.dark && p.language === 'fr-FR',
      'the restart setup never landed'
    )
  } finally {
    // Closing the window is what flushes the debounced write.
    await app.close()
  }

  // Restored before the first navigation: the very first document is already
  // dark and French, with no flash of the real environment.
  languages.length = 0
  const second = await launch(url)
  try {
    const page = await second.firstWindow()
    await expect(page.locator(EMULATE_BUTTON)).toHaveAttribute('data-emulating', 'on')
    await expectEveryView(
      second,
      url,
      (p) => p.dark && p.language === 'fr-FR',
      'the environment did not survive a restart'
    )
    expect(languages).toHaveLength(5)
    expect(languages.every((header) => header.startsWith('fr-FR'))).toBe(true)
  } finally {
    await second.close()
    server.close()
  }
})
