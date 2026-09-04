import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { probes, PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const OPENER = readFileSync(resolve(__dirname, 'fixtures', 'popup.html'), 'utf8')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('reliability')

/** The frame whose renderer this spec kills. */
const VICTIM = { name: 'iPhone 15 Pro', width: 393 }

type RespoInvoke = {
  (channel: 'nav:navigate', url: string): Promise<void>
  (channel: 'sync:set-lead', deviceId: string | null): Promise<void>
}

/** The opener page and the popup it opens, both on one origin. */
function startServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (request.url === '/child') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>child</title><h1>the popup</h1>')
      return
    }
    if (request.url !== '/') {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(OPENER)
  })
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      done({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

/** Kill the renderer behind the view whose probe reports `width`. */
function crashView(app: ElectronApplication, url: string, width: number): Promise<boolean> {
  return app.evaluate(
    ({ webContents }, arg: { url: string; width: number }) => {
      const victim = webContents.getAllWebContents().find((wc) => {
        if (wc.isDestroyed() || wc.getURL() !== arg.url) return false
        try {
          return (JSON.parse(wc.getTitle()) as { innerWidth: number }).innerWidth === arg.width
        } catch {
          return false
        }
      })
      if (victim === undefined) return false
      victim.forcefullyCrashRenderer()
      return true
    },
    { url, width }
  )
}

/** Press and release the mouse inside the view showing `url` with `title`. */
function clickInView(app: ElectronApplication, url: string, deviceWidth: number): Promise<boolean> {
  return app.evaluate(
    async ({ webContents }, arg: { url: string; deviceWidth: number }) => {
      // Every view shows the same opener, so the one to click is told apart by
      // the emulated width its CDP session was given — read back through the
      // page itself.
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed() || wc.getURL() !== arg.url) continue
        const width = (await wc.executeJavaScript('window.innerWidth')) as number
        if (width !== arg.deviceWidth) continue
        for (const type of ['mousePressed', 'mouseReleased']) {
          await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
            type,
            x: 10,
            y: 10,
            button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1
          })
        }
        return true
      }
      return false
    },
    { url, deviceWidth }
  )
}

type WindowFacts = {
  count: number
  popups: { url: string; noNode: boolean; devicePartition: boolean }[]
}

/** Every top-level window main has, and what the popups among them are. */
function windowFacts(app: ElectronApplication): Promise<WindowFacts> {
  return app.evaluate(async ({ BrowserWindow, session }) => {
    const devices = session.fromPartition('persist:respo')
    const windows = BrowserWindow.getAllWindows()
    const popups = windows.filter(
      (window) => !window.isDestroyed() && window.webContents.getURL().includes('/child')
    )
    return {
      count: windows.length,
      popups: await Promise.all(
        popups.map(async (window) => ({
          url: window.webContents.getURL(),
          // What a page in a hardened window can see of Node: nothing.
          noNode: (await window.webContents.executeJavaScript(
            "typeof require === 'undefined' && typeof process === 'undefined'"
          )) as boolean,
          devicePartition: window.webContents.session === devices
        }))
      )
    }
  })
}

/**
 * Which of the views showing `url` have no live renderer, by the width their
 * probe last reported. `isCrashed()` is read rather than the page asked:
 * `executeJavaScript` against a frame whose process just died can wait
 * forever for an answer that is never coming.
 */
function crashedWidths(app: ElectronApplication, url: string): Promise<number[]> {
  return app.evaluate(({ webContents }, probeUrl: string) => {
    const out: number[] = []
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.getURL() !== probeUrl || !wc.isCrashed()) continue
      try {
        out.push((JSON.parse(wc.getTitle()) as { innerWidth: number }).innerWidth)
      } catch {
        out.push(-1)
      }
    }
    return out
  }, url)
}

/** What the page in the view showing `url` at `width` believes, from a live renderer. */
function askView(
  app: ElectronApplication,
  url: string,
  width: number
): Promise<{ innerWidth: number; ua: string } | null> {
  return app.evaluate(
    async ({ webContents }, arg: { url: string; width: number }) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed() || wc.getURL() !== arg.url) continue
        try {
          const facts = (await wc.executeJavaScript(
            '({ innerWidth: window.innerWidth, ua: navigator.userAgent })'
          )) as { innerWidth: number; ua: string }
          if (facts.innerWidth === arg.width) return facts
        } catch {
          // A dead renderer answers nothing; that is the point of asking.
        }
      }
      return null
    },
    { url, width }
  )
}

test('a crashed renderer gets its own card and a restart, and popups open for the lead only', async () => {
  // Two navigations of five views, a process restart and two deliberate waits.
  test.setTimeout(120_000)
  const { server, url: openerUrl } = await startServer()
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: PROBE_URL }
  })

  try {
    const page = await app.firstWindow()
    await expect
      .poll(async () => (await probes(app, PROBE_URL)).length, { timeout: 45_000 })
      .toBe(5)

    // Kill one renderer. Its frame — and only its frame — says so.
    expect(await crashView(app, PROBE_URL, VICTIM.width)).toBe(true)
    const victim = page.locator(`section[aria-label="${VICTIM.name}"]`)
    await expect(victim.locator('[data-load-state="crashed"]')).toHaveCount(1)
    await expect(page.locator('[data-load-state="crashed"]')).toHaveCount(1)
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(4)
    await expect(victim.getByText('This page crashed')).toBeVisible()
    // Exactly one process died, and it is the one behind that frame.
    expect(await crashedWidths(app, PROBE_URL)).toEqual([VICTIM.width])
    expect(await askView(app, PROBE_URL, 412)).toMatchObject({ innerWidth: 412 })

    // Restart brings the page back — with its emulation, in a new process.
    await victim.getByRole('button', { name: 'Restart' }).click()
    await expect(victim.locator('[data-load-state="ready"]')).toHaveCount(1)
    expect(await crashedWidths(app, PROBE_URL)).toEqual([])
    await expect
      .poll(() => askView(app, PROBE_URL, VICTIM.width))
      .toMatchObject({
        innerWidth: VICTIM.width,
        ua: expect.stringContaining('iPhone')
      })

    // Popups. Every view loads the opener; the lead's click opens one window,
    // and the followers' mirrored clicks open none.
    await page.waitForFunction(() => 'respo' in window)
    await page.evaluate(async (target: string) => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('nav:navigate', target)
    }, openerUrl)
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await page.evaluate(async () => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('sync:set-lead', 'pixel-8')
    })

    expect(await clickInView(app, openerUrl, 412)).toBe(true)
    await expect.poll(() => windowFacts(app).then((facts) => facts.count)).toBe(2)
    // Give the four mirrored clicks every chance to open theirs.
    await page.waitForTimeout(1500)
    const facts = await windowFacts(app)
    expect(facts.count).toBe(2)
    expect(facts.popups).toHaveLength(1)
    expect(facts.popups[0]).toMatchObject({ noNode: true, devicePartition: true })
    expect(facts.popups[0]?.url).toBe(`${openerUrl}child`)

    // A click dispatched straight into a follower opens nothing.
    expect(await clickInView(app, openerUrl, 1440)).toBe(true)
    await page.waitForTimeout(1000)
    expect((await windowFacts(app)).count).toBe(2)
  } finally {
    await app.close()
    server.close()
  }
})
