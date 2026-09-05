import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const FIXTURE_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'diagnostics.html')).href

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('diagnostics')

/** The frames narrower than the 1000px banner, and the ones wider. */
const NARROW = ['iPhone 15 Pro', 'Pixel 8', 'iPad mini']
const WIDE = ['MacBook 1280', 'Desktop 1440']

/**
 * Whether the banner is outlined in the view whose *layout viewport* is
 * `width`, read from the page's own computed style: the highlight is a
 * stylesheet main inserted.
 *
 * `documentElement.clientWidth`, not `window.innerWidth`: under mobile
 * emulation a page wider than the viewport is shrunk to fit — as a phone
 * does — and `innerWidth` then reports the content width (1012px here), while
 * the layout viewport stays the device's own.
 */
function outlined(app: ElectronApplication, url: string, width: number): Promise<boolean | null> {
  return app.evaluate(
    async ({ webContents }, arg: { url: string; width: number }) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed() || wc.getURL() !== arg.url) continue
        const facts = (await wc.executeJavaScript(
          `({ width: document.documentElement.clientWidth, outline: getComputedStyle(document.getElementById('wide')).outlineStyle })`
        )) as { width: number; outline: string }
        if (facts.width === arg.width) return facts.outline === 'solid'
      }
      return null
    },
    { url, width }
  )
}

test('errors and overflow show up as chips on the frames they belong to', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: FIXTURE_URL }
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    // Two errors on every device: a console.error and an uncaught throw.
    await expect(page.locator('[data-errors="2"]')).toHaveCount(5)
    const iphone = page.locator(`section[aria-label="${NARROW[0]}"]`)
    await expect(iphone.getByRole('button', { name: /2 errors/ })).toBeVisible()

    // Overflow on the three frames narrower than the banner, and on no other.
    await expect(page.locator('[data-overflow]')).toHaveCount(3)
    for (const name of NARROW) {
      await expect(page.locator(`section[aria-label="${name}"] [data-overflow]`)).toHaveCount(1)
    }
    for (const name of WIDE) {
      await expect(page.locator(`section[aria-label="${name}"] [data-overflow]`)).toHaveCount(0)
    }
    // 1000px plus the body padding, in a 393px viewport — a rounding pixel
    // either way is Chromium's, not the scan's.
    await expect(iphone.locator('[data-overflow]')).toHaveAttribute('data-overflow', /^6[12]\d$/)

    // The chip names the offender…
    await iphone.locator('[data-overflow]').click()
    const popover = page.locator('[data-testid="overflow-popover"]')
    await expect(popover).toBeVisible()
    await expect(popover.locator('[data-overflow-item="0"]')).toContainText('div#wide.banner.promo')
    await expect(popover.locator('[data-overflow-item="0"]')).toContainText('1000px')

    // …and outlines it in that page, and only that page, on request.
    expect(await outlined(app, FIXTURE_URL, 393)).toBe(false)
    await popover.getByRole('button', { name: 'Highlight all' }).click()
    await expect.poll(() => outlined(app, FIXTURE_URL, 393)).toBe(true)
    expect(await outlined(app, FIXTURE_URL, 412)).toBe(false)

    // Closing the popover takes the outline away.
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect.poll(() => outlined(app, FIXTURE_URL, 393)).toBe(false)

    // A reload starts the count over — and the page errs again.
    await page.locator('button[aria-label="Reload"]').click()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await expect(page.locator('[data-errors="2"]')).toHaveCount(5)
    await expect(page.locator('[data-errors="4"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
