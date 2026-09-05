import { openSettings } from './settings'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('debug')

/** The outline style of the body in every device view showing `url`. */
function outlines(app: ElectronApplication, url: string): Promise<string[]> {
  return app.evaluate(async ({ webContents }, probeUrl: string) => {
    const out: string[] = []
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.getURL() !== probeUrl) continue
      try {
        out.push(
          (await wc.executeJavaScript('getComputedStyle(document.body).outlineStyle')) as string
        )
      } catch {
        // Mid-reload; the poll comes back.
      }
    }
    return out
  }, url)
}

test('Debug ▸ Outline all elements outlines every page, survives a reload, and leaves no trace', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: PROBE_URL }
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    expect(await outlines(app, PROBE_URL)).toEqual(Array(5).fill('none'))

    const toggle = async (): Promise<void> => {
      await openSettings(page, 'Developer tools')
      await page.getByRole('checkbox', { name: 'Outline all elements' }).click()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
    }

    await toggle()
    await expect.poll(() => outlines(app, PROBE_URL)).toEqual(Array(5).fill('solid'))

    // A new document gets the layer back.
    await page.locator('button[aria-label="Reload"]').click()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await expect.poll(() => outlines(app, PROBE_URL)).toEqual(Array(5).fill('solid'))

    await toggle()
    await expect.poll(() => outlines(app, PROBE_URL)).toEqual(Array(5).fill('none'))
  } finally {
    await app.close()
  }
})
