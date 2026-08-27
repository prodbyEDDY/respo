import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probes, PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** A url that is certain to fail, without needing the network. */
const MISSING_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'no-such-page.html')).href

/**
 * The same fixture under a second url. A query string is enough: `getURL()`
 * keeps it, so the two loads are told apart without a second file — and the
 * suite stays offline.
 */
const SECOND_URL = `${PROBE_URL}?navigated=1`

/**
 * The address bar drives every viewport at once.
 *
 * This is the one path that crosses every layer built in W1: React input ->
 * `nav:navigate` -> `ViewManager.navigateAll` -> five `WebContentsView`s, with
 * the device emulation still in place on the other side.
 */
test('typing a url in the address bar loads it in every device view', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const window = await app.firstWindow()

    // Boot: every device view is on the start url before anything is typed.
    await expect
      .poll(async () => (await probes(app, PROBE_URL)).length, {
        timeout: 45_000,
        message: 'device views never loaded the start url'
      })
      .toBe(5)

    const address = window.getByLabel('Address')
    await expect(address).toHaveValue(PROBE_URL)

    await address.click()
    // Focus selects the whole url, so typing replaces it — the assertion below
    // would fail if that behaviour regressed.
    await address.fill(SECOND_URL)
    await address.press('Enter')

    await expect
      .poll(async () => (await probes(app, SECOND_URL)).length, {
        timeout: 45_000,
        message: 'device views never followed the address bar'
      })
      .toBe(5)

    // Emulation survives the navigation: the iPhone view is still an iPhone.
    const reported = await probes(app, SECOND_URL)
    expect(reported.filter((p) => p.innerWidth === 393 && /iPhone/.test(p.ua))).toHaveLength(1)

    // And the bar itself now shows where the views actually are.
    await expect(address).toHaveValue(SECOND_URL)

    // The batched `load-state` event made the whole round trip: main watched
    // five `webContents`, coalesced their events, and the renderer applied them.
    await expect(window.locator('[data-load-state="ready"]')).toHaveCount(5)
  } finally {
    await app.close()
  }
})

/** The other half of the load-state pipeline: a page that cannot be loaded. */
test('a failed load surfaces as an error card on every device', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('[data-load-state="ready"]')).toHaveCount(5)

    const address = window.getByLabel('Address')
    await address.click()
    await address.fill(MISSING_URL)
    await address.press('Enter')

    await expect(window.locator('[data-load-state="failed"]')).toHaveCount(5)
    // Main hides a failed view so this card — drawn under a surface that would
    // otherwise composite over it — is actually on screen.
    await expect(window.getByText("Couldn't load").first()).toBeVisible()
    await expect(window.getByRole('button', { name: 'Retry' }).first()).toBeVisible()
  } finally {
    await app.close()
  }
})
