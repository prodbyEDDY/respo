import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { probes, PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('layouts')

/** The five default devices each get one view. */
const DEVICE_COUNT = 5

/** The first device of the default suite, and the one this spec expands. */
const FIRST_DEVICE = { name: 'iPhone 15 Pro', width: 393 }

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: PROBE_URL }
  })
}

/**
 * How many device views main is actually showing.
 *
 * Read from the views hierarchy rather than from a screenshot: a
 * `WebContentsView` is a separate surface the compositor puts on top, so
 * `page.screenshot` never contains one (CLAUDE.md). Main can see them all, and
 * `getVisible()` is the culling decision itself.
 */
function visibleViews(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }, probeUrl: string) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return 0

    type MaybeWebContentsView = { webContents?: { isDestroyed(): boolean; getURL(): string } }
    const isDeviceView = (view: unknown): boolean => {
      const wc = (view as MaybeWebContentsView).webContents
      return wc !== undefined && !wc.isDestroyed() && wc.getURL() === probeUrl
    }

    const root = window.contentView
    const layer = root.children.find((child) => child.children.some(isDeviceView))
    const holder = layer ?? root
    return holder.children.filter(isDeviceView).filter((view) => view.getVisible()).length
  }, PROBE_URL)
}

/** Pick one layout out of the overflow menu, the way a user does. */
async function chooseLayout(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  label: string
): Promise<void> {
  const item = page.getByRole('menuitemradio', { name: label })
  // The trigger toggles, so the open is retried as a unit: a click that lands
  // before the window is interactive would leave this waiting on a menu that
  // was never opened.
  await expect(async () => {
    await page.getByLabel('More options').click()
    await expect(item).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })

  await item.click()
  await expect(item).toBeHidden()
}

/**
 * Every arrangement puts the same devices on the canvas, and only one of them
 * takes any of them off it.
 *
 * The three grid modes differ in *where* the frames are, which is a CSS
 * question — what matters end to end is that switching between them never
 * loses a view, never leaves one hidden, and never touches the emulation. The
 * fourth mode is the one with teeth: it renders a single frame, and every other
 * view has to be suspended by main's own culling rather than left painting over
 * the canvas.
 */
test('every layout keeps the same views, and individual mode suspends the rest', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(DEVICE_COUNT)

    const canvas = page.getByTestId('canvas')
    // Flexible rows out of the box: the arrangement Respo has always opened on.
    await expect(canvas).toHaveAttribute('data-layout', 'flex')

    // Two frames sit side by side in a row that wraps.
    const first = page.locator('section[aria-label="iPhone 15 Pro"]')
    const second = page.locator('section[aria-label="Pixel 8"]')
    const rowY = await first.boundingBox()
    expect((await second.boundingBox())?.y).toBe(rowY?.y)

    await chooseLayout(page, 'Column')
    await expect(canvas).toHaveAttribute('data-layout', 'column')
    // One device per row: the second frame is now below the first, not beside.
    expect((await second.boundingBox())?.y).toBeGreaterThan(rowY?.y ?? 0)
    await expect.poll(() => visibleViews(app)).toBeGreaterThan(0)

    // Masonry needs room to have columns at all: the default suite ends on a
    // 1440px monitor, and nothing fits beside that in a 1400px window.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(2400, 1000)
    })
    await chooseLayout(page, 'Masonry')
    await expect(canvas).toHaveAttribute('data-layout', 'masonry')

    // Packed into columns: the frames sit at more than one left edge, and
    // nothing spills sideways out of the canvas.
    await expect
      .poll(async () => {
        const boxes = await page.locator('section[aria-label] > div[data-device-id]').all()
        const lefts = await Promise.all(boxes.map(async (box) => (await box.boundingBox())?.x))
        return new Set(lefts).size
      })
      .toBeGreaterThan(1)
    const overflow = await canvas.evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    // Whatever the arrangement, the emulated viewports are the devices' own.
    const grid = await probes(app, PROBE_URL)
    expect(grid).toHaveLength(DEVICE_COUNT)
    expect(grid.map((probe) => probe.innerWidth)).toContain(FIRST_DEVICE.width)

    // ---- individual --------------------------------------------------------
    await first.getByLabel('Show only this device').click()
    await expect(canvas).toHaveAttribute('data-layout', 'individual')

    // One frame in the DOM, and one tab per device to get back to the others.
    await expect(page.locator('section[aria-label]')).toHaveCount(1)
    await expect(page.getByRole('tab')).toHaveCount(DEVICE_COUNT)
    await expect(page.getByRole('tab', { name: /iPhone 15 Pro/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    // The other four are offscreen by definition, so main suspends them —
    // a view left visible would paint over the expanded one.
    await expect
      .poll(() => visibleViews(app), {
        timeout: 20_000,
        message: 'main never suspended the views individual mode took off the canvas'
      })
      .toBe(1)

    // The zoom invariant, which is the whole reason this mode is worth a test:
    // fitting a device to the canvas is a *display* scale, and the page it is
    // showing still lays out at the device's own width.
    const expanded = await probes(app, PROBE_URL)
    expect(expanded).toHaveLength(DEVICE_COUNT)
    expect(expanded.map((probe) => probe.innerWidth)).toContain(FIRST_DEVICE.width)

    // A tab switches which device has the canvas, and still only one shows.
    await page.getByRole('tab', { name: /Pixel 8/ }).click()
    await expect(page.locator('section[aria-label="Pixel 8"]')).toBeVisible()
    await expect.poll(() => visibleViews(app)).toBe(1)

    // ---- and back ----------------------------------------------------------
    await page.keyboard.press('Escape')
    // Back to the arrangement it was expanded from, not to the default.
    await expect(canvas).toHaveAttribute('data-layout', 'masonry')
    await expect(page.locator('section[aria-label]')).toHaveCount(DEVICE_COUNT)
    await expect.poll(() => visibleViews(app)).toBeGreaterThan(1)
  } finally {
    await app.close()
  }
})

/** The arrangement is a preference, and preferences outlive the window. */
test('the chosen layout survives a restart', async () => {
  const first = await launch()
  try {
    const page = await first.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(DEVICE_COUNT)
    await chooseLayout(page, 'Column')
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-layout', 'column')
  } finally {
    // Closing the window is what flushes the debounced write.
    await first.close()
  }

  const second = await launch()
  try {
    const page = await second.firstWindow()
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-layout', 'column')
    // And the canvas came back whole: a restored layout must not cost a view.
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(DEVICE_COUNT)
  } finally {
    await second.close()
  }
})
