import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/**
 * Three stacked blocks with ids, and a title carrying the emulated width — so
 * one view can be told from another, and one element from another.
 */
const FIXTURE = pathToFileURL(resolve(__dirname, 'fixtures', 'inspect.html')).href

/** The device the click goes into. Not the first view: the mode is global. */
const TARGET_WIDTH = 768

/** Page CSS pixels inside `#beta`, which spans y 200..300. */
const CLICK = { x: 25, y: 250 }

const userDataDir = mkdtempSync(join(tmpdir(), 'respo-e2e-inspect-'))

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

/** The emulated width a device view reports, from the fixture's title. */
function widthOf(title: string): number | null {
  try {
    return (JSON.parse(title) as { innerWidth?: number }).innerWidth ?? null
  } catch {
    return null
  }
}

/**
 * Dispatch a click into one device view over CDP.
 *
 * Playwright has no page handle for a `WebContentsView`, and a real mouse would
 * have to know where the canvas put the frame. The click goes in the way the
 * sync engine's mirrored ones do — through the same debugger session the
 * element picker is armed on, which is the point: this is a click the picker
 * has to intercept.
 */
function clickIn(app: ElectronApplication, url: string, width: number): Promise<string> {
  return app.evaluate(
    async ({ webContents }, arg: { url: string; width: number; x: number; y: number }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        if (c.isDestroyed() || c.getURL() !== arg.url) return false
        try {
          return (JSON.parse(c.getTitle()) as { innerWidth?: number }).innerWidth === arg.width
        } catch {
          return false
        }
      })
      if (wc === undefined) return 'no such view'

      const at = { x: arg.x, y: arg.y, button: 'left' as const, buttons: 1, clickCount: 1 }
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        ...at,
        type: 'mouseMoved',
        button: 'none',
        buttons: 0
      })
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { ...at, type: 'mousePressed' })
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        ...at,
        type: 'mouseReleased',
        buttons: 0
      })
      return `clicked view ${wc.id}`
    },
    { url, width, ...CLICK }
  )
}

/** Which device view has a DevTools frontend, and what that frontend selected. */
function inspected(
  app: ElectronApplication,
  url: string
): Promise<{ width: number | null; selection: string }> {
  return app
    .evaluate(async ({ webContents }, pageUrl: string) => {
      const wc = webContents
        .getAllWebContents()
        .find(
          (c) =>
            !c.isDestroyed() &&
            c.getURL() === pageUrl &&
            c.devToolsWebContents !== null &&
            c.devToolsWebContents !== undefined
        )
      const front = wc?.devToolsWebContents
      if (wc === undefined || front === null || front === undefined) {
        return { title: '', selection: 'no frontend' }
      }

      // The Elements tree lives in shadow roots, so the read has to walk them.
      // Reading is all this does — nothing about the frontend is modified, and
      // this lives in the test rather than in the app for exactly that reason.
      const selection = (await front
        .executeJavaScript(
          `(() => {
          const hits = []
          const walk = (root, depth) => {
            if (depth > 12) return
            for (const el of root.querySelectorAll('*')) {
              if (el.classList.contains('selected') && el.tagName === 'LI') {
                hits.push(el.textContent)
              }
              if (el.shadowRoot) walk(el.shadowRoot, depth + 1)
            }
          }
          walk(document, 0)
          return hits.join(' ')
        })()`
        )
        .catch(() => 'unreadable')) as string

      return { title: wc.getTitle(), selection }
    }, url)
    .then((answer) => ({ width: widthOf(answer.title), selection: answer.selection }))
}

/**
 * The claim Task 2 makes: one toggle arms every device, and a click in any of
 * them opens *that* device's DevTools on the element that was clicked.
 *
 * None of this is visible to `page.screenshot` — the pages and the DevTools
 * frontend are all `WebContentsView`s — so every assertion is made in main.
 */
test('inspect mode opens the clicked device DevTools on the element that was clicked', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: FIXTURE }
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    const toggle = page.locator('button[data-inspecting]')
    await expect(toggle).toHaveAttribute('data-inspecting', 'off')
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-inspecting', 'on')

    // The picker is armed asynchronously, one CDP call per view.
    await expect
      .poll(async () => clickIn(app, FIXTURE, TARGET_WIDTH), {
        message: 'the target device view never appeared',
        timeout: 15_000,
        intervals: [500, 1_000, 1_000, 2_000]
      })
      .not.toBe('no such view')

    // A pick ends the mode — main says so without being asked.
    await expect(toggle).toHaveAttribute('data-inspecting', 'off', { timeout: 15_000 })

    // ...and it is the clicked device that got the DevTools, on the element
    // under the click rather than on whatever the frontend opens with.
    await expect
      .poll(async () => (await inspected(app, FIXTURE)).width, {
        message: 'no device view ended up with a DevTools frontend',
        timeout: 20_000
      })
      .toBe(TARGET_WIDTH)

    await expect
      .poll(async () => (await inspected(app, FIXTURE)).selection, {
        message: 'the DevTools that opened is not looking at the element that was clicked',
        timeout: 20_000
      })
      .toContain('beta')
  } finally {
    await app.close()
  }
})
