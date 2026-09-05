import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'

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
    await page
      .getByRole('button', { name: 'Emulate media, vision, network and location', exact: true })
      .click()
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
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
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0)
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
    await page.getByRole('button', { name: 'More options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings…', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect.poll(() => nativeVisible(app)).toBe(false)
    // The whole native layer, including the dock, yields to the dialog.
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 46)
    await expect.poll(() => nativeVisible(app)).toBe(true)

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(720, 480))
    await page.getByRole('button', { name: 'More options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Dark theme', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page
      .getByRole('button', { name: 'Emulate media, vision, network and location', exact: true })
      .click()
    const box = await page.locator('[data-slot="popover-content"]').boundingBox()
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
