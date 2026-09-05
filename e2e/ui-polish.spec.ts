import { openSettings } from './settings'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'
import type { RespoApi } from '../src/shared/ipc'

const profile = ownProfile('ui-polish')
const nativeVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getVisible() ?? false
  )

test('floating UI covers native pages, nested menus and a dock; closing restores live views', async () => {
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL,
      RESPO_NO_UPDATER: '1'
    }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    // Exercise the real CDP fallback used when Windows cannot supply a native
    // compositor frame (for example, a service / remote desktop session).
    await app.evaluate(({ webContents, nativeImage }, url) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.getURL() === url) wc.capturePage = async () => nativeImage.createEmpty()
      }
    }, PROBE_URL)
    // did-finish-load precedes the first native compositor frame on a cold
    // Windows runner. Exercise menus only after a visible preview can be captured.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const bridge = (window as unknown as { respo: RespoApi }).respo
          return (await bridge.invoke('ui:surface-snapshots')).length
        })
      )
      .toBeGreaterThan(0)
    await openSettings(page, 'Emulation')
    await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    expect(await page.locator('[data-native-snapshots] img').count()).toBeGreaterThan(0)
    const beforeRefresh = await page
      .locator('[data-native-snapshots] img')
      .first()
      .getAttribute('src')
    await app.evaluate(async ({ webContents }, url) => {
      await Promise.all(
        webContents
          .getAllWebContents()
          .filter((wc) => wc.getURL() === url)
          .map((wc) => wc.insertCSS('body { background: rgb(220, 240, 245) !important; }'))
      )
    }, PROBE_URL)
    await page
      .getByRole('radiogroup', { name: 'Color scheme', exact: true })
      .getByRole('radio', { name: 'System', exact: true })
      .click()
    await expect
      .poll(async () => page.locator('[data-native-snapshots] img').first().getAttribute('src'))
      .not.toBe(beforeRefresh)
    await expect.poll(() => nativeVisible(app)).toBe(false)
    const colors = page.getByRole('radiogroup', { name: 'Color scheme', exact: true })
    await expect(colors.getByRole('radio', { name: 'System', exact: true })).toHaveCSS(
      'font-size',
      '12px'
    )
    await colors.getByRole('radio', { name: 'System', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(colors.getByRole('radio', { name: 'Light', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await page.keyboard.press('ArrowLeft')
    await page.getByRole('combobox', { name: 'Location', exact: true }).click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0)
    await page.mouse.move(2, 46)
    await expect.poll(() => nativeVisible(app)).toBe(true)

    await page.getByRole('button', { name: 'More for this device', exact: true }).first().click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 46)
    await expect.poll(() => nativeVisible(app)).toBe(true)

    await page
      .getByRole('button', { name: 'Open DevTools for this device', exact: true })
      .first()
      .click()
    await openSettings(page, 'Screenshots')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    // The whole native layer, including the dock, yields to the dialog.
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 46)
    await expect.poll(() => nativeVisible(app)).toBe(true)

    await openSettings(page, 'General')
    await page.getByRole('textbox', { name: 'Search settings' }).fill('horizontal')
    const navigation = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(navigation.getByRole('button')).toHaveCount(1)
    await navigation.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Horizontal row/ })).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByLabel('Add or edit devices').click()
    const phones = page.getByRole('button', { name: /^Phones/ })
    await expect(phones).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByLabel('Add iPhone SE to the suite')).toBeHidden()
    await phones.click()
    await expect(page.getByLabel('Add iPhone SE to the suite')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Show all .* phones/ })).toBeVisible()
    await page.getByLabel('Search devices').fill('Pixel 8')
    await expect(
      page.locator('[data-testid="device-manager"] li[data-device-id]:visible')
    ).toHaveCount(3)
    await expect(page.getByRole('button', { name: /^Tablets/ })).toHaveCount(0)
    await page.getByLabel('Search devices').fill('no-device-matches-this')
    await expect(page.getByText(/Nothing matches/)).toBeVisible()
    await page.getByLabel('Close devices').click()

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(720, 480))
    await openSettings(page, 'General')
    await page
      .getByRole('radiogroup', { name: 'App appearance' })
      .getByRole('radio', { name: 'Dark', exact: true })
      .click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await openSettings(page, 'Emulation')
    const box = await page.locator('[data-slot="dialog-content"]').boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 46)
    await expect.poll(() => nativeVisible(app)).toBe(true)
  } finally {
    await app.close()
  }
})
