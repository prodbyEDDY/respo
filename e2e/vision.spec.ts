import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const COLORS_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'colors.html')).href

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('vision')

/**
 * Two devices with the same viewport and pixel ratio, so their screenshots
 * are comparable pixel for pixel and the only difference can be the
 * simulation: iPhone 15 and iPhone 15 Pro are both 393×852 @3.
 */
const TWIN_A = { id: 'iphone-15-pro', name: 'iPhone 15 Pro' }
const TWIN_B = { id: 'iphone-15', name: 'iPhone 15' }

type RespoInvoke = {
  (channel: 'store:save', patch: unknown): Promise<void>
}

type Rgb = { r: number; g: number; b: number }

/**
 * The mean colour of each view showing the fixture, keyed by `webContents`
 * id, from `Page.captureScreenshot` over the same CDP session the app uses.
 * Decoded with Electron's own `nativeImage` — main has it, and the suite needs
 * no PNG dependency.
 */
function meanColors(app: ElectronApplication, url: string): Promise<Record<number, Rgb>> {
  return app.evaluate(async ({ webContents, nativeImage }, fixture: string) => {
    const out: Record<number, { r: number; g: number; b: number }> = {}
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.getURL() !== fixture) continue
      const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        clip: { x: 0, y: 0, width: 393, height: 852, scale: 1 }
      })) as { data: string }
      const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
      const { width, height } = image.getSize()
      const bitmap = image.toBitmap()
      let r = 0
      let g = 0
      let b = 0
      const pixels = width * height
      for (let i = 0; i < pixels; i += 1) {
        // BGRA, as `toBitmap` hands it out.
        b += bitmap[i * 4]!
        g += bitmap[i * 4 + 1]!
        r += bitmap[i * 4 + 2]!
      }
      out[wc.id] = { r: r / pixels, g: g / pixels, b: b / pixels }
    }
    return out
  }, url)
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

test('a vision simulation on one device changes that device only, and inherit puts it back', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: COLORS_URL }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => 'respo' in window)

    // A canvas of two twins. Seeded through the same channel the device
    // manager uses; the renderer picks the suite up and re-syncs the views.
    await page.evaluate(
      async (twins: { a: string; b: string }) => {
        const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
        await respo.invoke('store:save', {
          suites: [{ id: 'twins', name: 'Twins', deviceIds: [twins.a, twins.b] }],
          activeSuiteId: 'twins'
        })
      },
      { a: TWIN_A.id, b: TWIN_B.id }
    )
    await page.reload()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(2)
    await expect(page.locator(`section[aria-label="${TWIN_B.name}"]`)).toBeVisible()

    // Before: the two frames look the same.
    let colors = await meanColors(app, COLORS_URL)
    expect(Object.keys(colors)).toHaveLength(2)
    const [idA, idB] = Object.keys(colors).map(Number) as [number, number]
    const before = { a: colors[idA]!, b: colors[idB]! }
    expect(distance(before.a, before.b)).toBeLessThan(2)
    // …and they are red and green, not a blank page.
    expect(before.a.r).toBeGreaterThan(100)
    expect(before.a.g).toBeGreaterThan(60)

    // Deuteranopia on the second twin only, through its own kebab menu.
    const frameB = page.locator(`section[aria-label="${TWIN_B.name}"]`)
    await frameB.getByRole('button', { name: 'More for this device' }).click()
    await page.getByRole('menuitem', { name: 'Vision' }).hover()
    await page.getByRole('menuitemradio', { name: 'Deuteranopia' }).click()
    await expect(frameB.locator('[data-vision-override="deuteranopia"]')).toBeVisible()

    // The one with the override moved; the other did not.
    await expect
      .poll(async () => {
        colors = await meanColors(app, COLORS_URL)
        const moved = Object.values(colors).filter((c) => distance(c, before.a) > 8)
        return moved.length
      })
      .toBe(1)
    const unchanged = Object.values(colors).filter((c) => distance(c, before.a) <= 2)
    expect(unchanged).toHaveLength(1)

    // Inherit — one click on the chip — puts it back with its twin.
    await frameB.locator('[data-vision-override="deuteranopia"]').click()
    await expect(frameB.locator('[data-vision-override]')).toHaveCount(0)
    await expect
      .poll(async () => {
        colors = await meanColors(app, COLORS_URL)
        return Object.values(colors).every((c) => distance(c, before.a) <= 2)
      })
      .toBe(true)
  } finally {
    await app.close()
  }
})
