import { settingsAction } from './settings'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const TALL_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'tall.html')).href

/** This spec's own state, not the machine's; it restarts the app (see `ownProfile`). */
const userDataDir = ownProfile('rulers')

const PHONE = { name: 'iPhone 15 Pro', width: 393, key: '393x852' }
const DESKTOP = { width: 1440, key: '1440x900' }

type Rgb = { r: number; g: number; b: number }

type RespoBridge = {
  invoke(channel: 'store:load'): Promise<{ guides: Record<string, { h: number[]; v: number[] }> }>
}

/**
 * The colour of a few page points in the view whose layout viewport is
 * `width`, from `Page.captureScreenshot` over the app's own CDP session and
 * decoded with Electron's `nativeImage`. Points are in the page's CSS pixels;
 * the image is at the device's pixel ratio, so they are scaled to it.
 */
function pixels(
  app: ElectronApplication,
  url: string,
  width: number,
  points: [number, number][]
): Promise<Rgb[] | null> {
  return app.evaluate(
    async (
      { webContents, nativeImage },
      arg: { url: string; width: number; points: [number, number][] }
    ) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed() || wc.getURL() !== arg.url) continue
        // The layout viewport for a phone; `innerWidth` for a desktop, whose
        // classic scrollbar takes 15px off `clientWidth`.
        const widths = (await wc.executeJavaScript(
          '[document.documentElement.clientWidth, window.innerWidth]'
        )) as number[]
        if (!widths.includes(arg.width)) continue
        const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          clip: { x: 0, y: 0, width: arg.width, height: 600, scale: 1 }
        })) as { data: string }
        const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
        const size = image.getSize()
        const scale = size.width / arg.width
        const bitmap = image.toBitmap()
        return arg.points.map(([x, y]) => {
          const px = Math.min(size.width - 1, Math.round(x * scale))
          const py = Math.min(size.height - 1, Math.round(y * scale))
          const i = (py * size.width + px) * 4
          // BGRA, as `toBitmap` hands it out.
          return { b: bitmap[i]!, g: bitmap[i + 1]!, r: bitmap[i + 2]! }
        })
      }
      return null
    },
    { url, width, points }
  )
}

const isGuide = (c: Rgb): boolean => c.b > 180 && c.r < 120
const isWhite = (c: Rgb): boolean => c.r > 240 && c.g > 240 && c.b > 240

async function guidesDocument(page: Page): Promise<Record<string, { h: number[]; v: number[] }>> {
  await page.waitForFunction(() => 'respo' in window)
  return page.evaluate(async () => {
    const respo = (window as unknown as { respo: RespoBridge }).respo
    return (await respo.invoke('store:load')).guides
  })
}

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: TALL_URL }
  })
}

async function showRulers(page: Page, deviceName: string): Promise<void> {
  const frame = page.locator(`section[aria-label="${deviceName}"]`)
  await frame.getByRole('button', { name: 'More for this device' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Rulers' }).click()
  await expect(frame.locator('[data-rulers="on"]')).toHaveCount(1)
}

test('guides drawn on a ruler land on the page, per viewport size, at any zoom, and survive a restart', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    await showRulers(page, PHONE.name)
    const phone = page.locator(`section[aria-label="${PHONE.name}"]`)
    const topRuler = phone.locator('canvas[data-ruler="x"]')
    await expect(topRuler).toBeVisible()

    // A click on the top ruler at 100px is a vertical guide at page x=100.
    await topRuler.click({ position: { x: 100, y: 10 } })
    await expect.poll(async () => (await guidesDocument(page))[PHONE.key]?.v).toEqual([100])

    // …and it is drawn in the page: a blue column at 100, white either side.
    await expect
      .poll(async () => {
        const colors = await pixels(app, TALL_URL, PHONE.width, [
          [100, 300],
          [60, 300],
          [140, 300]
        ])
        return colors === null
          ? null
          : colors.map((c) => (isGuide(c) ? 'guide' : isWhite(c) ? 'white' : 'other'))
      })
      .toEqual(['guide', 'white', 'white'])

    // Another size has no such guide: the desktop page stays white at 100.
    expect((await guidesDocument(page))[DESKTOP.key]).toBeUndefined()
    expect((await pixels(app, TALL_URL, DESKTOP.width, [[100, 300]]))?.map(isWhite)).toEqual([true])

    // At 50% zoom the strip is half as long, and a click at 100 screen pixels
    // is page x=200 — the ruler measures the page, not the frame.
    for (let i = 0; i < 4; i += 1) {
      await settingsAction(page, 'Canvas', 'Zoom out')
    }
    await expect(phone.locator('div[data-device-id]')).toHaveCSS(
      'width',
      `${Math.round(PHONE.width * 0.5)}px`
    )
    await topRuler.click({ position: { x: 100, y: 10 } })
    await expect.poll(async () => (await guidesDocument(page))[PHONE.key]?.v).toEqual([100, 200])
    await expect
      .poll(async () => {
        const colors = await pixels(app, TALL_URL, PHONE.width, [
          [200, 300],
          [170, 300]
        ])
        return colors === null ? null : colors.map(isGuide)
      })
      .toEqual([true, false])

    // Let the renderer's debounce write the document before the window goes.
    await page.waitForTimeout(500)
  } finally {
    await app.close()
  }

  // Restored: the guides come back with the size, and go straight onto the
  // page the moment its rulers are shown.
  const second = await launch()
  try {
    const page = await second.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    expect((await guidesDocument(page))[PHONE.key]).toEqual({ h: [], v: [100, 200] })

    await showRulers(page, PHONE.name)
    await expect
      .poll(async () => {
        const colors = await pixels(second, TALL_URL, PHONE.width, [
          [100, 300],
          [200, 300]
        ])
        return colors === null ? null : colors.map(isGuide)
      })
      .toEqual([true, true])
  } finally {
    await second.close()
  }
})
