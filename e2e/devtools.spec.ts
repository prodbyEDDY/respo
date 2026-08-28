import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/**
 * A throwaway profile: this test ends with DevTools moved into a window of its
 * own, and that edge is persisted. Sharing a profile would mean the next run —
 * of this suite or any other — started from a dock the test does not expect.
 */
const userDataDir = mkdtempSync(join(tmpdir(), 'respo-e2e-devtools-'))

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

/** The first frame on the default canvas, and what it emulates. */
const DEVICE = { name: 'iPhone 15 Pro', width: 393 }

type Box = { x: number; y: number; width: number; height: number }

type DevtoolsGeometry = {
  /** The docked frontend's surface, or `null` when nothing is docked. */
  panel: (Box & { id: number }) | null
  /** Every device view with DevTools open: its probe title, and its frontend. */
  targets: { title: string; frontendId: number | null }[]
  /** Top-level windows. A second one is a DevTools window of its own. */
  windows: number
}

/**
 * What DevTools is actually doing, read from main.
 *
 * A screenshot cannot answer this and neither can the page: both the device
 * pages and the DevTools frontend are `WebContentsView`s, separate surfaces the
 * compositor puts on top of the window. Main can see all of them —
 * `View.children` for the docked frontend's geometry, `devToolsWebContents` for
 * which page each frontend is actually inspecting.
 */
function devtoolsGeometry(app: ElectronApplication, url: string): Promise<DevtoolsGeometry> {
  return app.evaluate(({ BrowserWindow, webContents }, probeUrl: string) => {
    type MaybeView = { webContents?: { isDestroyed(): boolean; getURL(): string; id: number } }
    const frontendOf = (view: unknown): MaybeView['webContents'] | undefined => {
      const wc = (view as MaybeView).webContents
      if (wc === undefined || wc.isDestroyed()) return undefined
      return wc.getURL().startsWith('devtools://') ? wc : undefined
    }

    const window = BrowserWindow.getAllWindows()[0]
    const docked =
      window === undefined
        ? undefined
        : window.contentView.children.find((child) => frontendOf(child) !== undefined)

    // `devToolsWebContents` rather than `isDevToolsOpened()`: the latter only
    // answers for a frontend Electron manages itself, and Respo always supplies
    // its own. This one is set once the frontend has finished loading, and
    // names the surface actually inspecting this page.
    const targets = webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL() === probeUrl)
      .map((wc) => ({ title: wc.getTitle(), frontendId: wc.devToolsWebContents?.id ?? null }))
      .filter((entry) => entry.frontendId !== null)

    return {
      panel:
        docked === undefined ? null : { ...docked.getBounds(), id: frontendOf(docked)?.id ?? -1 },
      targets,
      windows: BrowserWindow.getAllWindows().length
    }
  }, url)
}

/** The strip the renderer reserved, in the window CSS pixels bounds are in. */
async function reservedStrip(app: ElectronApplication): Promise<Box | null> {
  const page = await app.firstWindow()
  const panel = page.locator('[data-testid="devtools-panel"]')
  if ((await panel.count()) === 0) return null
  return panel.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
}

function nearly(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1
}

/**
 * The whole DevTools lifecycle, on the surfaces it actually happens on.
 *
 * This is the claim Task 1 makes: opening DevTools from a device's own header
 * puts a frontend in the strip the renderer reserved, inspecting *that* device
 * and no other; the edge switch and the pop-out move it without losing it; and
 * closing gives the canvas its space back. Every one of those is checked in
 * main, because none of it is visible to `page.screenshot`.
 */
test('DevTools docks to the device it was opened from, moves, and gives the canvas back', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    const canvas = page.locator('[data-testid="canvas"]')
    const fullHeight = await canvas.evaluate((node) => node.getBoundingClientRect().height)

    const frame = page.locator(`section[aria-label="${DEVICE.name}"]`)
    await frame.locator('button[aria-label="Open DevTools for this device"]').click()

    // The frontend is a whole `WebContents` loading `devtools://`; it lands a
    // frame or two after the click, like every other native surface here.
    await expect
      .poll(async () => (await devtoolsGeometry(app, PROBE_URL)).panel !== null, {
        message: 'no DevTools frontend was docked'
      })
      .toBe(true)

    // Glued to the reserved strip, the same way a device page is glued to its
    // frame — the renderer reports the box, main puts the surface in it.
    await expect
      .poll(
        async () => {
          const [geometry, strip] = await Promise.all([
            devtoolsGeometry(app, PROBE_URL),
            reservedStrip(app)
          ])
          if (geometry.panel === null || strip === null) return false
          return (
            nearly(geometry.panel.x, strip.x) &&
            nearly(geometry.panel.y, strip.y) &&
            nearly(geometry.panel.width, strip.width) &&
            nearly(geometry.panel.height, strip.height)
          )
        },
        { message: 'the docked frontend is not where the renderer reserved room for it' }
      )
      .toBe(true)

    // The frontend names the page it inspects only once it has finished
    // loading, which is a page load behind the surface appearing.
    await expect
      .poll(async () => (await devtoolsGeometry(app, PROBE_URL)).targets.length, {
        message: 'no device page ended up with a DevTools frontend attached'
      })
      .toBe(1)

    const docked = await devtoolsGeometry(app, PROBE_URL)
    // Exactly one device is being inspected, and it is the one whose header was
    // clicked: the probe publishes its emulated viewport as the document title.
    expect(docked.targets).toHaveLength(1)
    const target = docked.targets[0]
    expect(target?.frontendId).toBe(docked.panel?.id)
    expect(JSON.parse(target?.title ?? '{}')).toMatchObject({ innerWidth: DEVICE.width })

    // The dock is reserved out of the canvas, so the frames really do have less
    // room — this is what makes them re-measure with no code that knows why.
    const dockedHeight = await canvas.evaluate((node) => node.getBoundingClientRect().height)
    expect(dockedHeight).toBeLessThan(fullHeight)

    // Same panel, other edge.
    const dock = page.locator('[data-testid="devtools-dock"]')
    await dock.locator('button[aria-label="Dock to right"]').click()
    await expect(dock).toHaveAttribute('data-dock', 'right')

    await expect
      .poll(
        async () => {
          const [geometry, strip] = await Promise.all([
            devtoolsGeometry(app, PROBE_URL),
            reservedStrip(app)
          ])
          if (geometry.panel === null || strip === null) return false
          return nearly(geometry.panel.x, strip.x) && nearly(geometry.panel.width, strip.width)
        },
        { message: 'the frontend did not follow the dock to the right edge' }
      )
      .toBe(true)
    // The canvas is full height again, and narrower instead.
    expect(await canvas.evaluate((node) => node.getBoundingClientRect().height)).toBe(fullHeight)

    // Into a window of its own: no strip, no docked surface, still inspecting
    // the same page.
    await dock.locator('button[aria-label="Move DevTools to its own window"]').click()
    await expect
      .poll(
        async () => {
          const geometry = await devtoolsGeometry(app, PROBE_URL)
          return geometry.panel === null && geometry.windows === 2 && geometry.targets.length === 1
        },
        { message: 'undocking did not move DevTools into a window of its own' }
      )
      .toBe(true)
    expect(await canvas.evaluate((node) => node.getBoundingClientRect().height)).toBe(fullHeight)

    // And closing it from the device that owns it puts everything back.
    await frame.locator('button[aria-label="Open DevTools for this device"]').click()
    await expect
      .poll(
        async () => {
          const geometry = await devtoolsGeometry(app, PROBE_URL)
          return geometry.panel === null && geometry.windows === 1 && geometry.targets.length === 0
        },
        { message: 'closing DevTools left something behind' }
      )
      .toBe(true)
  } finally {
    await app.close()
  }
})
