import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const TALL_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'tall.html')).href
const CSP_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'overlay-csp.html')).href
/** 393×200, solid magenta (255, 0, 255) — see the fixture's generator note. */
const IMAGE = resolve(__dirname, 'fixtures', 'overlay.png')

/** This spec's own state, not the machine's; it restarts the app (see `ownProfile`). */
const userDataDir = ownProfile('overlay')

const PHONE = { name: 'iPhone 15 Pro', width: 393, key: '393x852' }

type Rgb = { r: number; g: number; b: number }

type RespoInvoke = {
  (channel: 'nav:navigate', url: string): Promise<void>
}

/** The colour of a few page points in the phone view (see `rulers.spec.ts`). */
function pixels(
  app: ElectronApplication,
  url: string,
  points: [number, number][]
): Promise<Rgb[] | null> {
  return app.evaluate(
    async ({ webContents, nativeImage }, arg: { url: string; points: [number, number][] }) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed() || wc.getURL() !== arg.url) continue
        const width = (await wc.executeJavaScript('document.documentElement.clientWidth')) as number
        if (width !== 393) continue
        const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          clip: { x: 0, y: 0, width: 393, height: 300, scale: 1 }
        })) as { data: string }
        const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
        const size = image.getSize()
        const scale = size.width / 393
        const bitmap = image.toBitmap()
        return arg.points.map(([x, y]) => {
          const px = Math.min(size.width - 1, Math.round(x * scale))
          const py = Math.min(size.height - 1, Math.round(y * scale))
          const i = (py * size.width + px) * 4
          return { b: bitmap[i]!, g: bitmap[i + 1]!, r: bitmap[i + 2]! }
        })
      }
      return null
    },
    { url, points }
  )
}

/** Magenta at full opacity over white; at 50% it is (255, 128, 255). */
const isMagenta = (c: Rgb): boolean => c.r > 240 && c.b > 240 && c.g < 30
const isHalfMagenta = (c: Rgb): boolean => c.r > 240 && c.b > 240 && c.g > 100 && c.g < 160
const isWhite = (c: Rgb): boolean => c.r > 240 && c.g > 240 && c.b > 240

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: TALL_URL }
  })
}

async function openOverlayDialog(page: Page): Promise<void> {
  const frame = page.locator(`section[aria-label="${PHONE.name}"]`)
  await frame.getByRole('button', { name: 'More for this device' }).click()
  await page.getByRole('menuitem', { name: 'Design overlay…' }).click()
  await expect(page.locator('[data-testid="overlay-dialog"]')).toBeVisible()
}

/** Set a Radix slider by keyboard: Home, then ArrowRight `steps` times. */
async function setSlider(page: Page, label: string, value: number): Promise<void> {
  const thumb = page.getByRole('slider', { name: label })
  await thumb.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < value; i += 1) await page.keyboard.press('ArrowRight')
  await expect(thumb).toHaveAttribute('aria-valuenow', String(value))
}

test('a design image is laid over the page, dimmed and curtained, shown beside it, and survives a restart', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    // Pick the image. The page shows it at the default 50% straight away.
    await openOverlayDialog(page)
    await page.locator('[data-testid="overlay-file"]').setInputFiles(IMAGE)
    await expect(page.locator('[data-testid="overlay-image-facts"]')).toContainText('393 × 200')
    const frame = page.locator(`section[aria-label="${PHONE.name}"]`)
    await expect
      .poll(async () =>
        (
          await pixels(app, TALL_URL, [
            [196, 100],
            [196, 280]
          ])
        )?.map((c) => [isHalfMagenta(c), isWhite(c)])
      )
      .toEqual([
        [true, false],
        [false, true]
      ])

    // Opacity 100%: solid magenta. Curtain 50%: white on the left, magenta on the right.
    await setSlider(page, 'Opacity', 100)
    await expect
      .poll(async () => (await pixels(app, TALL_URL, [[196, 100]]))?.map(isMagenta))
      .toEqual([true])
    await setSlider(page, 'Curtain', 50)
    await expect
      .poll(async () =>
        (
          await pixels(app, TALL_URL, [
            [100, 100],
            [300, 100]
          ])
        )?.map((c) => [isWhite(c), isMagenta(c)])
      )
      .toEqual([
        [true, false],
        [false, true]
      ])

    // Side by side: the page is clean again, and a panel with the image sits beside the frame.
    await page.getByRole('radio', { name: 'Side by side' }).click()
    await expect(frame.locator('[data-overlay-panel]')).toBeVisible()
    await expect(frame.locator('[data-overlay-panel] img')).toBeVisible()
    await expect
      .poll(async () => (await pixels(app, TALL_URL, [[300, 100]]))?.map(isWhite))
      .toEqual([true])
    await page.getByRole('radio', { name: 'Overlay' }).click()
    await expect(frame.locator('[data-overlay-panel]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="overlay-dialog"]')).toHaveCount(0)
    await expect(frame.locator('[data-overlay-mode="overlay"]')).toBeVisible()

    // Survives a reload: the layer is put back on the new document.
    await page.locator('button[aria-label="Reload"]').click()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await expect
      .poll(async () => (await pixels(app, TALL_URL, [[300, 100]]))?.map(isMagenta))
      .toEqual([true])

    // A file past the cap is refused with a sentence, before anything is read.
    const big = join(mkdtempSync(join(tmpdir(), 'respo-overlay-')), 'huge.png')
    writeFileSync(big, Buffer.alloc(11 * 1024 * 1024))
    await openOverlayDialog(page)
    await page.locator('[data-testid="overlay-file"]').first().setInputFiles(big)
    await expect(page.getByRole('alert')).toContainText('up to 10 MB')
    await page.keyboard.press('Escape')

    // Under a page CSP that forbids data: images, the overlay does NOT show:
    // the stylesheet is injected, but the fetch of its background is the
    // page's, and the page's policy governs it. A documented limit — the
    // dialog says so and points at side by side — and this pins it down so
    // a Chromium change in either direction is noticed.
    await page.waitForFunction(() => 'respo' in window)
    await page.evaluate(async (url: string) => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('nav:navigate', url)
    }, CSP_URL)
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await page.waitForTimeout(1500)
    expect((await pixels(app, CSP_URL, [[300, 100]]))?.map(isWhite)).toEqual([true])

    await page.waitForTimeout(500)
  } finally {
    await app.close()
  }

  // Restored with the size: the overlay is on the page again after a restart.
  const second = await launch()
  try {
    const page = await second.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    const frame = page.locator(`section[aria-label="${PHONE.name}"]`)
    await expect(frame.locator('[data-overlay-mode="overlay"]')).toBeVisible()
    await expect
      .poll(async () =>
        (
          await pixels(second, TALL_URL, [
            [100, 100],
            [300, 100]
          ])
        )?.map((c) => [isWhite(c), isMagenta(c)])
      )
      .toEqual([
        [true, false],
        [false, true]
      ])
  } finally {
    await second.close()
  }
})
