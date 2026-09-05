import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/**
 * A throwaway profile: this spec rotates every device and zooms the canvas, and
 * both of those are now part of the saved document. On the shared profile it
 * would hand the next spec a canvas of landscape frames.
 */
const userDataDir = mkdtempSync(join(tmpdir(), 'respo-zoom-'))

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

type ViewState = {
  /** `webContents.setZoomFactor`, i.e. what the canvas zoom asked for. */
  zoomFactor: number
  /** What the *page* believes, live — not the title snapshot. */
  innerWidth: number
  innerHeight: number
  /** A media query only a narrow viewport matches. */
  mobile: boolean
  ua: string
}

const MEASURE = `JSON.stringify({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  mobile: window.matchMedia('(max-width: 600px)').matches,
  ua: navigator.userAgent
})`

/**
 * Read every device view's zoom factor next to what its page reports.
 *
 * Deliberately live (`executeJavaScript`) rather than the fixture's title: the
 * question is what the page believes *right now*, after zoom or rotation
 * changed underneath it.
 */
async function viewStates(app: ElectronApplication, url: string): Promise<ViewState[]> {
  return app.evaluate(
    async ({ webContents }, args: { probeUrl: string; measure: string }) => {
      const views = webContents
        .getAllWebContents()
        .filter((wc) => !wc.isDestroyed() && wc.getURL() === args.probeUrl)

      const states: ViewState[] = []
      for (const wc of views) {
        const raw = (await wc.executeJavaScript(args.measure)) as string
        states.push({
          zoomFactor: wc.getZoomFactor(),
          ...(JSON.parse(raw) as Omit<ViewState, 'zoomFactor'>)
        })
      }
      return states
    },
    { probeUrl: url, measure: MEASURE }
  )
}

function iphone(states: ViewState[]): ViewState {
  const found = states.find((state) => /iPhone/.test(state.ua))
  expect(found, 'the iPhone view was not reporting').toBeDefined()
  return found as ViewState
}

/** `Desktop 1440` — the one view on the default canvas with a Windows agent. */
function desktop(states: ViewState[]): ViewState {
  const found = states.find((state) => /Windows NT/.test(state.ua))
  expect(found, 'the desktop view was not reporting').toBeDefined()
  return found as ViewState
}

/** Step the canvas down the zoom ladder `times` rungs, from the overflow menu. */
async function zoomOut(
  window: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  times: number
): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await window.getByRole('button', { name: 'More options' }).click()
    await window.getByRole('menuitem', { name: 'Zoom out' }).click()
  }
}

/**
 * The load-bearing claim behind canvas zoom: `setZoomFactor` scales what is
 * *painted*, and leaves the emulated viewport alone.
 *
 * If that were false the whole feature would be a lie — zooming out to fit more
 * frames on screen would silently widen every page and swap the layout the user
 * came to look at. This test states the evidence instead of assuming it.
 */
test('canvas zoom scales the frame without touching the emulated viewport', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('[data-load-state="ready"]')).toHaveCount(5)

    const before = iphone(await viewStates(app, PROBE_URL))
    expect(before.zoomFactor).toBeCloseTo(1, 2)
    expect(before.innerWidth).toBe(393)
    expect(before.innerHeight).toBe(852)
    expect(before.mobile).toBe(true)

    // Two rungs down the ladder: 1 -> 0.9 -> 0.75.
    for (let i = 0; i < 2; i += 1) {
      await window.getByRole('button', { name: 'More options' }).click()
      await window.getByRole('menuitem', { name: 'Zoom out' }).click()
    }

    await expect
      .poll(async () => iphone(await viewStates(app, PROBE_URL)).zoomFactor, {
        message: 'the canvas zoom never reached the device view'
      })
      .toBeCloseTo(0.75, 2)

    const zoomed = iphone(await viewStates(app, PROBE_URL))
    // The evidence: the page is painted at 75% and still lays out as a 393px
    // iPhone, so every media query it has resolves exactly as before.
    expect(zoomed.innerWidth).toBe(393)
    expect(zoomed.innerHeight).toBe(852)
    expect(zoomed.mobile).toBe(true)

    // Back to 1:1 before rotating, so the two features are tested apart.
    await window.getByRole('button', { name: 'More options' }).click()
    await window.getByRole('menuitem', { name: 'Reset zoom' }).click()
    await expect
      .poll(async () => iphone(await viewStates(app, PROBE_URL)).zoomFactor)
      .toBeCloseTo(1, 2)

    // Rotation is the opposite case: it *does* re-run the CDP metrics override,
    // so the page's own idea of its viewport is what changes.
    await window.getByRole('button', { name: 'Rotate all devices' }).click()

    await expect
      .poll(async () => iphone(await viewStates(app, PROBE_URL)).innerWidth, {
        message: 'the rotated device never re-emulated'
      })
      .toBe(852)

    const rotated = iphone(await viewStates(app, PROBE_URL))
    expect(rotated.innerHeight).toBe(393)
    // 852px wide is no longer a phone viewport, and the page can tell.
    expect(rotated.mobile).toBe(false)
    // Rotation is not a device swap: it is still the same iPhone.
    expect(rotated.ua).toMatch(/iPhone/)
  } finally {
    await app.close()
  }
})

/**
 * The same claim for a desktop device, which is the case that does not come
 * for free.
 *
 * Chromium's mobile emulation swallows the embedder's zoom level — a page under
 * `mobile: true` lays out at the emulated width whatever `setZoomFactor` says.
 * Desktop emulation does not: page zoom stays in force, and the emulated
 * viewport is divided by it, so a 1440px monitor at 50% canvas zoom would
 * report a 2880px viewport and resolve every media query as a screen nobody
 * has. The emulation compensates for the zoom instead; this is the evidence.
 */
test('a desktop device keeps its own viewport at 50% canvas zoom', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('[data-load-state="ready"]')).toHaveCount(5)

    const before = desktop(await viewStates(app, PROBE_URL))
    expect(before.innerWidth).toBe(1440)
    expect(before.innerHeight).toBe(900)

    // 1 -> 0.9 -> 0.75 -> 0.67 -> 0.5.
    await zoomOut(window, 4)
    await expect
      .poll(async () => desktop(await viewStates(app, PROBE_URL)).zoomFactor, {
        message: 'the canvas zoom never reached the desktop view'
      })
      .toBeCloseTo(0.5, 2)

    await expect
      .poll(async () => desktop(await viewStates(app, PROBE_URL)).innerWidth, {
        message: 'the desktop viewport followed the canvas zoom'
      })
      .toBe(1440)

    const zoomed = desktop(await viewStates(app, PROBE_URL))
    expect(zoomed.innerHeight).toBe(900)
    // 1440px is not a phone at any zoom, and the page can tell.
    expect(zoomed.mobile).toBe(false)

    // Back up the ladder: the compensation has to unwind exactly, not drift.
    //
    // Polled, like the way down: `setZoomFactor` is synchronous and the metrics
    // override that answers it is a protocol round trip, so the page is briefly
    // — for about a frame — laid out at the zoom it is leaving.
    await window.getByRole('button', { name: 'More options' }).click()
    await window.getByRole('menuitem', { name: 'Reset zoom' }).click()
    await expect
      .poll(async () => desktop(await viewStates(app, PROBE_URL)).zoomFactor)
      .toBeCloseTo(1, 2)
    await expect
      .poll(async () => desktop(await viewStates(app, PROBE_URL)).innerWidth, {
        message: 'the desktop viewport did not come back with the zoom'
      })
      .toBe(1440)
  } finally {
    await app.close()
  }
})

const FRAME_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'frame.html')).href

/**
 * What a zoomed-out canvas *paints* for a mobile-emulated view.
 *
 * `setZoomFactor` is swallowed by mobile emulation, so for a long time a 393px
 * phone on a canvas at 75% was painted 1:1 into a 295px frame and clipped on
 * the right and bottom — the media queries were right and the picture was
 * wrong. The override's `scale` is what paints it small; this is the evidence,
 * read straight off the view's surface: the fixture draws a thick dark border
 * hugging its viewport, and the border is at the surface's edges only if the
 * whole viewport fits inside the widget.
 */
test('a mobile device is painted at the canvas zoom, not clipped by it', async () => {
  // A profile of its own: the first test leaves every device rotated, and a
  // landscape iPhone is 639px wide before any zoom.
  const paintProfile = mkdtempSync(join(tmpdir(), 'respo-zoom-paint-'))
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${paintProfile}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: FRAME_URL
    }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('[data-load-state="ready"]')).toHaveCount(5)
    await window.getByRole('button', { name: 'More options' }).click()
    await window.getByRole('menuitem', { name: 'Reset zoom' }).click()
    await zoomOut(window, 2)

    // The iPhone's surface: its size, and the darkness of the pixels just
    // inside its far edges. Read after the zoom has landed in the view.
    const edges = async (): Promise<{ width: number; right: number; bottom: number } | null> =>
      app.evaluate(async ({ webContents }, url: string) => {
        // The CDP user-agent override is invisible to `getUserAgent()`; ask
        // each page which one it is.
        let wc: Electron.WebContents | undefined
        for (const c of webContents.getAllWebContents()) {
          if (c.isDestroyed() || c.getURL() !== url) continue
          const ua = (await c.executeJavaScript('navigator.userAgent')) as string
          if (/iPhone/.test(ua)) wc = c
        }
        if (wc === undefined) return null
        const image = await wc.capturePage()
        const { width, height } = image.getSize()
        if (width === 0 || height === 0) return null
        const bitmap = image.toBitmap()
        const at = (x: number, y: number): number => {
          const i = (y * width + x) * 4
          return ((bitmap[i] ?? 255) + (bitmap[i + 1] ?? 255) + (bitmap[i + 2] ?? 255)) / 3
        }
        return {
          width,
          right: at(width - 3, Math.round(height / 2)),
          bottom: at(Math.round(width / 2), height - 3)
        }
      }, FRAME_URL)

    await expect
      .poll(async () => (await edges())?.width ?? 0, { message: 'the iPhone surface never shrank' })
      .toBeLessThan(393)

    const zoomed = await edges()
    expect(zoomed).not.toBeNull()
    // 393 × 0.75, give or take the rounding of a frame.
    expect(zoomed?.width).toBeGreaterThan(280)
    expect(zoomed?.width).toBeLessThan(310)
    // Dark: the border made it to the far edges, so the whole viewport did.
    expect(zoomed?.right).toBeLessThan(96)
    expect(zoomed?.bottom).toBeLessThan(96)
  } finally {
    await app.close()
    rmSync(paintProfile, { recursive: true, force: true })
  }
})
