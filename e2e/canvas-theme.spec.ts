import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'
import { openSettings } from './settings'

const profile = ownProfile('canvas-theme')
const url = pathToFileURL(resolve(__dirname, 'fixtures/emulation.html')).href

test('website color scheme stays consistent when views leave and reenter the canvas', async () => {
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: url }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    const colors = (): Promise<unknown> =>
      app.evaluate(
        async ({ webContents }, probeUrl) =>
          Promise.all(
            webContents
              .getAllWebContents()
              .filter((wc) => wc.getURL() === probeUrl)
              .map((wc) =>
                wc.executeJavaScript(
                  `({dark: matchMedia('(prefers-color-scheme: dark)').matches, background: getComputedStyle(document.body).backgroundColor})`
                )
              )
          ),
        url
      )
    for (const scheme of ['Dark', 'Light', 'System']) {
      await openSettings(page, 'Emulation')
      await page
        .getByRole('radiogroup', { name: 'Color scheme', exact: true })
        .getByRole('radio', { name: scheme, exact: true })
        .click()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const dark =
        scheme === 'System'
          ? await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
          : scheme === 'Dark'
      const expected = Array(5).fill({
        dark,
        background: dark ? 'rgb(17, 17, 17)' : 'rgb(255, 255, 255)'
      })
      for (const fraction of [0, 1, 0.5, 0]) {
        await page.getByTestId('canvas').evaluate((el, fraction) => {
          el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction
        }, fraction)
        await expect.poll(colors).toEqual(expected)
      }
    }
    await openSettings(page, 'Canvas')
    await page.getByRole('radio', { name: /Horizontal row/ }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const canvas = page.getByTestId('canvas')
    await expect(canvas).toHaveAttribute('data-layout', 'horizontal')
    const boxes = await page.locator('section[aria-label] > div[data-device-id]').all()
    const positions = await Promise.all(boxes.map((box) => box.boundingBox()))
    expect(new Set(positions.map((box) => box?.y)).size).toBe(1)
    const canvasBox = await canvas.boundingBox()
    await page.mouse.move(canvasBox!.x + 4, canvasBox!.y + 10)
    await page.mouse.wheel(0, 600)
    await expect.poll(() => canvas.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300)
    const baseline = await colors()
    await page.mouse.wheel(0, -600)
    await expect.poll(() => canvas.evaluate((el) => el.scrollLeft)).toBe(0)
    await expect.poll(colors).toEqual(baseline)
  } finally {
    await app.close()
  }
})
