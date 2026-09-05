import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('clipping')

type Box = { x: number; y: number; width: number; height: number }

type Geometry = {
  /** The canvas layer's bounds in window coordinates, or `null` if there is none. */
  layer: Box | null
  /** Every device view's bounds, as set — relative to the layer. */
  views: (Box & { visible: boolean })[]
}

/**
 * Where the native surfaces actually are, read from main.
 *
 * A screenshot cannot answer this: `page.screenshot` captures the window's own
 * `webContents`, and a `WebContentsView` is a separate surface the compositor
 * puts on top — it is never in the picture. Main can see the real geometry, and
 * `View.children` is how the layer and its device views are reached without a
 * test-only IPC channel.
 *
 * Device views are found by the url they are all sitting on, so this reads the
 * same in both parenting modes: under the canvas layer, and (the regression)
 * hanging straight off the window.
 */
function geometry(app: ElectronApplication, url: string): Promise<Geometry> {
  return app.evaluate(({ BrowserWindow }, probeUrl: string) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return { layer: null, views: [] }

    type MaybeWebContentsView = { webContents?: { isDestroyed(): boolean; getURL(): string } }
    const isDeviceView = (view: unknown): boolean => {
      const wc = (view as MaybeWebContentsView).webContents
      return wc !== undefined && !wc.isDestroyed() && wc.getURL() === probeUrl
    }

    const root = window.contentView.children[0] ?? window.contentView
    // The canvas layer is whichever child holds the device views. Without one
    // they are children of the window itself, which is the failure this guards.
    const layer = root.children.find((child) => child.children.some(isDeviceView))
    const holder = layer ?? root

    return {
      layer: layer === undefined ? null : layer.getBounds(),
      views: holder.children
        .filter(isDeviceView)
        .map((view) => ({ ...view.getBounds(), visible: view.getVisible() }))
    }
  }, url)
}

/**
 * A device view scrolled under the toolbar must not paint over it.
 *
 * This is the guard on the one piece of undocumented Chromium behaviour Respo
 * depends on (CLAUDE.md): device pages are native views composited above
 * everything the renderer draws, so no CSS can mask them — the only thing that
 * keeps a scrolled frame off the toolbar is that the views are children of a
 * canvas layer, and the views hierarchy clips a child to its parent.
 *
 * The regression this catches is parenting the views to the window again
 * (`RESPO_CANVAS_LAYER=0`, or the option being dropped): the frames would then
 * be positioned in window coordinates and a negative y would draw straight over
 * the address bar.
 */
test('a device view scrolled under the toolbar is clipped by the canvas layer', async () => {
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

    // The bottom of the toolbar, in the same CSS pixels view bounds are in.
    const toolbarBottom = await page
      .locator('header')
      .first()
      .evaluate((node) => node.getBoundingClientRect().bottom)
    expect(toolbarBottom).toBeGreaterThan(0)

    // Scroll the canvas far enough that the first row of frames is under it.
    await page.locator('[data-testid="canvas"]').evaluate((node) => {
      node.scrollTop = 400
    })

    // The layout is reported once per animation frame, so the native views
    // follow a frame or two later. The scenario only means something once a
    // frame's own box really does reach above the toolbar — whether that box is
    // relative to the layer or (the regression) to the window.
    await expect
      .poll(
        async () => {
          const { layer, views } = await geometry(app, PROBE_URL)
          const originY = layer?.y ?? 0
          return views.some((view) => view.visible && originY + view.y < toolbarBottom)
        },
        { message: 'no device view ended up scrolled under the toolbar' }
      )
      .toBe(true)

    const { layer, views } = await geometry(app, PROBE_URL)
    expect(layer, 'the device views are not parented to a canvas layer').not.toBeNull()
    if (layer === null) return

    // The layer starts below the toolbar, and Chromium clips its children to
    // it: that pair is what makes the frames above unable to reach the bar.
    expect(layer.y).toBeGreaterThanOrEqual(Math.floor(toolbarBottom))

    for (const view of views) {
      if (!view.visible) continue
      // What is actually painted is the view's box intersected with the layer.
      const paintedTop = layer.y + Math.max(view.y, 0)
      const paintedBottom = layer.y + Math.min(view.y + view.height, layer.height)
      if (paintedBottom <= paintedTop) continue
      expect(paintedTop).toBeGreaterThanOrEqual(Math.floor(toolbarBottom))
    }
  } finally {
    await app.close()
  }
})

/** The other half of the follow-up: Inter is the font the UI actually gets. */
test('the interface is set in Inter, loaded from the app itself', async () => {
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

    const family = await page
      .locator('header')
      .first()
      .evaluate((node) => getComputedStyle(node).fontFamily)
    expect(family).toMatch(/(^|\s|")Inter("|,|$)/)

    // Loaded, not merely asked for: a missing @font-face would leave the stack
    // silently falling through to the system sans.
    const loaded = await page.evaluate(() => document.fonts.check('500 15px Inter'))
    expect(loaded).toBe(true)
  } finally {
    await app.close()
  }
})
