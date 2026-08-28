import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

const SCROLL_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'scroll.html')).href

/** The five default devices each get one view. */
const DEVICE_COUNT = 5

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: SCROLL_URL
    }
  })
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
    await app.firstWindow()
    const ids = await waitForViews(app, SCROLL_URL)
    const lead = ids[0] as number

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

test('clicking a link on the lead navigates every follower', async () => {
  const app = await launch()
  try {
    await app.firstWindow()
    const ids = await waitForViews(app, SCROLL_URL)
    const lead = ids[0] as number

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
