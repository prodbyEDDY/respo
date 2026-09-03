import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { probes, PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/**
 * The same fixture under a second url. A query string is enough to tell two
 * visits apart without a second file — and it keeps the suite offline.
 */
const SECOND_URL = `${PROBE_URL}?navigated=1`

/**
 * One profile per test rather than one per file: three of these restart the app
 * to assert what survived, and a bookmark left behind by an earlier test would
 * make the next one pass for the wrong reason (see `ownProfile`).
 */
const bookmarkProfile = ownProfile('bookmarks')
const suggestProfile = ownProfile('suggestions')
const homeProfile = ownProfile('home')
const historyProfile = ownProfile('history')

function launch(
  userDataDir: string,
  startUrl: string | null = PROBE_URL
): Promise<ElectronApplication> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  // The launch argument wins over the home page, so the home-page test has to
  // be able to take it away.
  if (startUrl === null) delete env['RESPO_START_URL']
  else env['RESPO_START_URL'] = startUrl

  return electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env })
}

/** Wait until every device view has the page. */
async function loaded(app: ElectronApplication, url: string): Promise<void> {
  await expect
    .poll(async () => (await probes(app, url)).length, {
      timeout: 45_000,
      message: `device views never loaded ${url}`
    })
    .toBe(5)
}

test('the star saves a page, and the bookmark outlives the session', async () => {
  const first = await launch(bookmarkProfile)
  try {
    const window = await first.firstWindow()
    await loaded(first, PROBE_URL)

    // Saving *is* opening: one click keeps the page and puts the editor on it.
    await window.getByLabel('Bookmark this page (Ctrl+D)').click()
    await window.getByLabel('Name').fill('The probe')
    await window.getByRole('button', { name: 'Done' }).click()

    // The star is filled in now, and says what a second click would do.
    await expect(window.getByLabel('Edit this bookmark')).toHaveAttribute('data-bookmarked', 'true')

    await window.getByLabel('More options').click()
    await expect(window.getByRole('menuitem', { name: 'The probe' })).toBeVisible()
    await window.keyboard.press('Escape')
  } finally {
    // Closing the window is what flushes the debounced write.
    await first.close()
  }

  const second = await launch(bookmarkProfile)
  try {
    const window = await second.firstWindow()
    await loaded(second, PROBE_URL)

    // The document came back, and with it the star's state.
    await expect(window.getByLabel('Edit this bookmark')).toBeVisible()
    await window.getByLabel('More options').click()
    await expect(window.getByRole('menuitem', { name: 'The probe' })).toBeVisible()
  } finally {
    await second.close()
  }
})

test('the address bar offers where it has been, and goes back there', async () => {
  const app = await launch(suggestProfile)
  try {
    const window = await app.firstWindow()
    await loaded(app, PROBE_URL)

    const address = window.getByLabel('Address')
    await address.click()
    await address.fill(SECOND_URL)
    await address.press('Enter')
    await loaded(app, SECOND_URL)

    // Focusing offers the recent pages — main answered a `history:query` with
    // the two visits it recorded off the leading view's load events.
    await address.click()
    const options = window.getByRole('option')
    await expect.poll(async () => options.count(), { timeout: 10_000 }).toBeGreaterThan(1)

    // Arrow keys walk the list without taking focus out of the field.
    await address.press('ArrowDown')
    await expect(options.first()).toHaveAttribute('data-active', 'true')

    // Back to the first visit: the row that is the probe without the query.
    await options.filter({ hasNotText: 'navigated=1' }).first().click()
    await loaded(app, PROBE_URL)
    await expect(address).toHaveValue(PROBE_URL)
  } finally {
    await app.close()
  }
})

test('a home page decides where the next session opens', async () => {
  const first = await launch(homeProfile)
  try {
    const window = await first.firstWindow()
    await loaded(first, PROBE_URL)

    const address = window.getByLabel('Address')
    await address.click()
    await address.fill(SECOND_URL)
    await address.press('Enter')
    await loaded(first, SECOND_URL)

    await window.getByLabel('More options').click()
    await window.getByRole('menuitem', { name: 'Set this page as home' }).click()
    // A home page shows up as a way back to it, beside the star.
    await expect(window.getByLabel('Go to your home page')).toBeVisible()
  } finally {
    await first.close()
  }

  // No launch url this time: main falls through to the home page.
  const second = await launch(homeProfile, null)
  try {
    await loaded(second, SECOND_URL)
  } finally {
    await second.close()
  }
})

test('clearing history stops it being offered', async () => {
  const app = await launch(historyProfile)
  try {
    const window = await app.firstWindow()
    await loaded(app, PROBE_URL)

    const address = window.getByLabel('Address')
    await address.click()
    await expect.poll(async () => window.getByRole('option').count(), { timeout: 10_000 }).toBe(1)
    await address.press('Escape')
    await address.blur()

    await window.getByLabel('More options').click()
    await window.getByRole('menuitem', { name: 'Clear history' }).click()

    await address.click()
    // Nothing to suggest, so there is no list at all.
    await expect.poll(async () => window.getByRole('option').count(), { timeout: 10_000 }).toBe(0)
  } finally {
    await app.close()
  }
})
