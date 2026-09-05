import { settingsAction } from './settings'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'

/**
 * The two channels this spec drives directly, as the page sees them.
 *
 * Both are the ones the UI itself uses: seeding a suite is a `store:save`, and
 * electing a lead is the `sync:set-lead` a hover ends in.
 */
type RespoInvoke = {
  (channel: 'store:save', patch: unknown): Promise<void>
  (channel: 'sync:set-lead', deviceId: string | null): Promise<void>
}

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

const SCROLL_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'scroll.html')).href
const CLICK_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'click.html')).href

/** The five default devices each get one view. */
const DEVICE_COUNT = 5

/** The first device of the default suite — the one every view list starts with. */
const FIRST_DEVICE_ID = 'iphone-15-pro'

/**
 * A profile of this spec's own (see `ownProfile`).
 *
 * Mirroring is *persisted state*: the master switch and the per-device mutes
 * are restored into `SyncEngine` before the first view exists (`main/index.ts`),
 * and a session that left mirroring off makes every assertion here fail with
 * the followers standing still. This is the whole reason the two tests below
 * were flaky.
 */
const userDataDir = ownProfile('sync')

function launch(startUrl: string = SCROLL_URL): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: startUrl
    }
  })
}

/**
 * Make `deviceId` the lead, and do not come back until main agrees.
 *
 * The lead is a *live election*, not a constant: main seeds it with the first
 * view that registered, and from then on it is whatever the pointer last
 * touched — a frame's `mouseenter` elects it, and the canvas losing the pointer
 * clears it altogether (`Canvas.tsx`). A test that dispatches into one view
 * while assuming that seed still stands is assuming something nothing in the
 * test owns.
 *
 * So the election is made explicitly, through the same channel and the same
 * validation the hover ends in, and *awaited*: `sync:set-lead` is an
 * `ipcMain.handle`, so the resolved promise means `SyncEngine.setLead` has
 * already run. No sleep, and nothing left to race.
 */
async function electLead(page: Page, deviceId: string): Promise<void> {
  await page.waitForFunction(() => 'respo' in window)
  await page.evaluate(async (id: string) => {
    const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
    await respo.invoke('sync:set-lead', id)
  }, deviceId)
}

/**
 * The device views showing `url`, by `webContents` id, ascending.
 *
 * Ids are handed out in creation order, so the first is also the first device
 * the engine registered — the one leading until the UI elects another.
 */
function viewIds(app: ElectronApplication, url: string): Promise<number[]> {
  return app.evaluate(({ webContents }, target: string) => {
    return webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL() === target)
      .map((wc) => wc.id)
      .sort((a, b) => a - b)
  }, url)
}

/** How far down its own document each view is, as a fraction of its runway. */
function scrollRatios(app: ElectronApplication, url: string): Promise<number[]> {
  return app.evaluate(({ webContents }, target: string) => {
    const expression =
      '(()=>{const e=document.scrollingElement||document.documentElement;' +
      'const m=Math.max(1,e.scrollHeight-e.clientHeight);return e.scrollTop/m})()'
    return Promise.all(
      webContents
        .getAllWebContents()
        .filter((wc) => !wc.isDestroyed() && wc.getURL() === target)
        .sort((a, b) => a.id - b.id)
        .map((wc) => wc.executeJavaScript(expression) as Promise<number>)
    )
  }, url)
}

function urls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) => {
    return webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed())
      .map((wc) => wc.getURL())
  })
}

/**
 * Send input to one view the way a user would: through its own CDP session, so
 * the page sees a *trusted* event. That is the whole chain under test — the
 * device preload only reports what the user actually did.
 */
function dispatch(app: ElectronApplication, wcId: number, params: object): Promise<void> {
  return app.evaluate(
    async ({ webContents }, arg: { id: number; params: object }) => {
      const wc = webContents.fromId(arg.id)
      if (wc === undefined || wc === null) throw new Error(`no webContents ${arg.id}`)
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', arg.params)
    },
    { id: wcId, params }
  )
}

/** What each view's page says about the last click it received. */
type ClickReport = {
  x: number
  y: number
  width: number
  height: number
  trusted: boolean
} | null

function clicks(app: ElectronApplication, url: string): Promise<ClickReport[]> {
  return app.evaluate(({ webContents }, target: string) => {
    return Promise.all(
      webContents
        .getAllWebContents()
        .filter((wc) => !wc.isDestroyed() && wc.getURL() === target)
        .sort((a, b) => a.id - b.id)
        .map((wc) => wc.executeJavaScript('window.__respoClick') as Promise<ClickReport>)
    )
  }, url)
}

/** The zoom factor main has applied to each device view, in view order. */
function zoomFactors(app: ElectronApplication, url: string): Promise<number[]> {
  return app.evaluate(({ webContents }, target: string) => {
    return webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL() === target)
      .sort((a, b) => a.id - b.id)
      .map((wc) => wc.getZoomFactor())
  }, url)
}

async function waitForViews(app: ElectronApplication, url: string): Promise<number[]> {
  let ids: number[] = []
  await expect
    .poll(
      async () => {
        ids = await viewIds(app, url)
        return ids.length
      },
      { timeout: 45_000, message: 'device views never loaded the fixture' }
    )
    .toBe(DEVICE_COUNT)
  return ids
}

test('scrolling the lead scrolls every follower to the same point in the document', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    const ids = await waitForViews(app, SCROLL_URL)
    const lead = ids[0] as number
    // Ids are handed out in creation order, so `ids[0]` is the first device of
    // the default suite. Say so out loud rather than inheriting the seed.
    await electLead(page, FIRST_DEVICE_ID)

    // The device preload is input capture, not a bridge: a page must not be
    // able to see it or anything it uses (spec §7a).
    const exposed = await app.evaluate(({ webContents }, target: string) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === target)
      if (wc === undefined) throw new Error('no device view')
      return wc.executeJavaScript(
        '({respo:typeof window.respo,ipc:typeof window.ipcRenderer,' +
          'require:typeof window.require,process:typeof window.process,' +
          'module:typeof window.module,electron:typeof window.electron})'
      ) as Promise<Record<string, string>>
    }, SCROLL_URL)
    expect(exposed).toEqual({
      respo: 'undefined',
      ipc: 'undefined',
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      electron: 'undefined'
    })

    // A wheel on the lead only. Everything else has to arrive by mirroring.
    await dispatch(app, lead, {
      type: 'mouseWheel',
      x: 20,
      y: 20,
      deltaX: 0,
      deltaY: 1500
    })

    let ratios: number[] = []
    await expect
      .poll(
        async () => {
          ratios = await scrollRatios(app, SCROLL_URL)
          const leadRatio = ratios[0] ?? 0
          if (leadRatio <= 0) return false
          // Every follower within one percent of the lead's position.
          return ratios.every((r) => Math.abs(r - leadRatio) < 0.01)
        },
        { timeout: 20_000, message: `followers never converged (ratios: ${ratios.join(', ')})` }
      )
      .toBe(true)

    // Not a trivial pass: the lead really did move, and so did everyone else.
    expect(ratios).toHaveLength(DEVICE_COUNT)
    expect(ratios[0]).toBeGreaterThan(0.01)
    for (const ratio of ratios) expect(ratio).toBeGreaterThan(0.01)

    // And it tracks a second gesture rather than latching on the first.
    const first = ratios[0] as number
    await dispatch(app, lead, { type: 'mouseWheel', x: 20, y: 20, deltaX: 0, deltaY: 1500 })
    await expect
      .poll(async () => {
        ratios = await scrollRatios(app, SCROLL_URL)
        const leadRatio = ratios[0] ?? 0
        return leadRatio > first && ratios.every((r) => Math.abs(r - leadRatio) < 0.01)
      })
      .toBe(true)
  } finally {
    await app.close()
  }
})

/**
 * The mirror has to survive canvas zoom.
 *
 * A zoomed canvas is two transforms stacked: the frame in the DOM is drawn at
 * `device × zoom`, and main hands the logical viewport back to the page with
 * `setZoomFactor(zoom)` so the media queries still see the device. The engine
 * turns a normalized coordinate into the follower's *device* pixels — and
 * `Input.dispatchMouseEvent` does not read device pixels: Chromium multiplies
 * the coordinate it is handed by the widget's zoom, so at 50% the click landed
 * at half the fraction it was made at until the engine divided it back out.
 *
 * The lead's own page is the ruler: it reports where the dispatched click
 * actually landed as a fraction of its viewport, and every follower has to
 * agree with it. That keeps the test honest about the mirror regardless of how
 * the coordinate that started it was interpreted on the way in.
 *
 * The suite is seeded rather than the default five, and it deliberately ends on
 * a desktop device: a desktop viewport used to be scaled by the canvas zoom (a
 * 1440px monitor laid out at 2880px at 50%), and the emulation now divides that
 * back out. A mirrored click is where the two conventions meet — the engine's
 * coordinates are the device's own pixels, and the page they land in has to be
 * the device's own size — so if the fix and the mirror ever disagree, they
 * disagree here.
 */
test('a mirrored click lands in the same place at 50% canvas zoom', async () => {
  const suite = ['iphone-15-pro', 'pixel-8', 'ipad-mini', 'desktop-1440']

  // A profile of its own even within this spec: the zoom this test leaves
  // behind is remembered per origin by the session, and the other two tests
  // here open the same fixtures at 100%.
  const zoomProfile = mkdtempSync(join(tmpdir(), 'respo-sync-zoom-'))
  const seed = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${zoomProfile}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: CLICK_URL }
  })
  try {
    const page = await seed.firstWindow()
    await page.waitForFunction(() => 'respo' in window)
    await page.evaluate(async (deviceIds: string[]) => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('store:save', {
        suites: [{ id: 'default', name: 'Default', deviceIds }]
      })
    }, suite)
  } finally {
    // Closing the window is what flushes the debounced write.
    await seed.close()
  }

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${zoomProfile}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: CLICK_URL }
  })
  try {
    const page = await app.firstWindow()
    let ids: number[] = []
    await expect
      .poll(
        async () => {
          ids = await viewIds(app, CLICK_URL)
          return ids.length
        },
        { timeout: 45_000, message: 'the seeded suite never loaded the fixture' }
      )
      .toBe(suite.length)
    const lead = ids[0] as number

    // 1 → 0.9 → 0.75 → 0.67 → 0.5, down the ladder the menu steps through.
    for (let i = 0; i < 4; i += 1) {
      await settingsAction(page, 'Canvas', 'Zoom out')
    }

    // The zoom is only really applied once main has told every view about it.
    await expect
      .poll(async () => (await zoomFactors(app, CLICK_URL)).map((z) => Math.round(z * 100)), {
        timeout: 20_000,
        message: 'main never applied the canvas zoom to the views'
      })
      .toEqual(suite.map(() => 50))

    // Clicking through the menu moved the pointer across the canvas, and
    // pointing at a device is what elects it. Put the lead back on the first
    // view — the one the click below is dispatched into.
    const leadFrame = page.locator('section[aria-label="iPhone 15 Pro"]')
    // The top-left corner is the frame's caption: the only part of it the
    // renderer still owns, since the page itself is a native view over the top.
    await leadFrame.hover({ position: { x: 4, y: 4 } })
    await expect(leadFrame).toHaveAttribute('data-lead', 'true')
    // The ring is the *renderer* agreeing; the election itself is coalesced onto
    // an animation frame before it travels. Say the same thing again down the
    // same channel and wait for main to answer, rather than sleeping for as
    // long as a frame is expected to take.
    await electLead(page, FIRST_DEVICE_ID)

    // Off-centre on purpose: a click mirrored at the wrong scale lands at a
    // visibly different fraction (or off the page entirely), and the middle of
    // the viewport is the one point where every scale agrees.
    const at = { x: 80, y: 140, button: 'left', clickCount: 1 }
    await dispatch(app, lead, { ...at, type: 'mouseMoved', button: 'none', clickCount: 0 })
    await dispatch(app, lead, { ...at, type: 'mousePressed', buttons: 1 })
    await dispatch(app, lead, { ...at, type: 'mouseReleased', buttons: 0 })

    let reports: ClickReport[] = []
    await expect
      .poll(
        async () => {
          reports = await clicks(app, CLICK_URL)
          return reports.filter((report) => report !== null).length
        },
        { timeout: 20_000, message: 'the click never reached every view' }
      )
      .toBe(suite.length)

    const leadClick = reports[0]
    if (leadClick === null || leadClick === undefined) throw new Error('the lead recorded no click')

    // Trusted: it arrived through CDP as real input, not from a script.
    expect(leadClick.trusted).toBe(true)
    // The emulated viewport is the device's own, whatever the canvas is doing.
    expect(leadClick.width).toBe(393)
    // And the click really is off-centre, so agreeing about it means something.
    expect(leadClick.x).toBeGreaterThan(0.05)
    expect(leadClick.x).toBeLessThan(0.45)

    for (const report of reports) {
      if (report === null) throw new Error('a view recorded no click')
      expect(report.trusted).toBe(true)
      // One percent of a viewport: rounding to whole device pixels is the only
      // difference a correct mirror can produce.
      expect(Math.abs(report.x - leadClick.x)).toBeLessThan(0.01)
      expect(Math.abs(report.y - leadClick.y)).toBeLessThan(0.01)
    }
  } finally {
    await app.close()
    rmSync(zoomProfile, { recursive: true, force: true })
  }
})

test('clicking a link on the lead navigates every follower', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    const ids = await waitForViews(app, SCROLL_URL)
    const lead = ids[0] as number
    await electLead(page, FIRST_DEVICE_ID)

    // (50, 50) is inside the fixture's link in every device viewport: it is
    // full width and 20vh tall, and the smallest device here is 852px high.
    const at = { x: 50, y: 50, button: 'left', clickCount: 1 }
    await dispatch(app, lead, { ...at, type: 'mouseMoved', button: 'none', clickCount: 0 })
    await dispatch(app, lead, { ...at, type: 'mousePressed', buttons: 1 })
    await dispatch(app, lead, { ...at, type: 'mouseReleased', buttons: 0 })

    await expect
      .poll(async () => (await urls(app)).filter((url) => url === PROBE_URL).length, {
        timeout: 20_000,
        message: 'the click did not reach the followers'
      })
      .toBe(DEVICE_COUNT)
  } finally {
    await app.close()
  }
})
