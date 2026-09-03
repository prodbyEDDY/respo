import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/**
 * A profile per test, not per file: both restart the app, and the first one
 * deliberately leaves a remembered decision behind that the second must not
 * inherit (see `ownProfile`).
 */
const userDataDir = ownProfile('permissions')
const ipcDataDir = ownProfile('permissions-ipc')

/**
 * A page with an *origin*, which is the whole reason this spec runs a server.
 *
 * The other suites use `file:` fixtures, and a local file has no origin at all
 * — Chromium reports the string `"null"` for it. A permission is remembered per
 * origin, so a `file:` page is exactly the case where Respo refuses without
 * asking. Loopback is also a secure context as far as Chromium is concerned,
 * which is what lets `navigator.geolocation` reach the permission handler at all.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>permissions</title><h1>site</h1>`

async function startServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(PAGE)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

/**
 * Ask every device view for the user's location, from inside the pages.
 *
 * Device pages live in `WebContentsView`s, which Playwright has no handle for
 * — main does. Five views asking at once is the case worth driving: the answer
 * has to be one prompt, not five.
 */
async function askEveryViewForLocation(app: ElectronApplication, pageUrl: string): Promise<number> {
  return app.evaluate(({ webContents }, url: string) => {
    const views = webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL() === url)
    for (const wc of views) {
      void wc
        .executeJavaScript(
          'navigator.geolocation.getCurrentPosition(() => undefined, () => undefined); 1'
        )
        .catch(() => undefined)
    }
    return views.length
  }, pageUrl)
}

test('one question for five viewports, and the answer is remembered', async () => {
  const { server, url } = await startServer()
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: url }
  })

  try {
    const window = await app.firstWindow()

    await expect
      .poll(async () => askEveryViewForLocation(app, url), {
        timeout: 45_000,
        message: 'device views never loaded the start url'
      })
      .toBe(5)

    // One bubble, anchored to the shield, naming the site and what it wants.
    const prompt = window.locator('[data-slot="permission-prompt"]')
    await expect(prompt).toBeVisible({ timeout: 20_000 })
    await expect(prompt).toContainText('127.0.0.1')
    await expect(prompt).toContainText('know your location')

    await window.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(prompt).toBeHidden()

    // The panel is the way back to what was just allowed.
    await window.getByLabel('Site permissions for this page').click()
    const panel = window.locator('[data-slot="permission-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-permission="geolocation"]')).toHaveAttribute(
      'data-decision',
      'allow'
    )
    // Fullscreen starts allowed; everything else starts at ask.
    await expect(panel.locator('[data-permission="fullscreen"]')).toHaveAttribute(
      'data-decision',
      'allow'
    )
    await expect(panel.locator('[data-permission="camera"]')).toHaveAttribute(
      'data-decision',
      'ask'
    )

    // A click cycles Allow -> Block, and the change is worth a reload.
    await panel.locator('[data-permission="geolocation"]').click()
    await expect(panel.locator('[data-permission="geolocation"]')).toHaveAttribute(
      'data-decision',
      'block'
    )
    await expect(panel).toContainText('Reload to apply')

    // And a blocked capability is refused without asking again.
    await window.keyboard.press('Escape')
    await askEveryViewForLocation(app, url)
    await expect(window.locator('[data-slot="permission-prompt"]')).toBeHidden()
  } finally {
    await app.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

test('the permission channels refuse what they have no row for', async () => {
  const { server, url } = await startServer()
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${ipcDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: url }
  })

  try {
    const window = await app.firstWindow()

    const rejected = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      const results: string[] = []
      const cases: [string, string][] = [
        ['display-capture', 'allow'],
        ['camera', 'maybe'],
        ['toString', 'allow']
      ]
      for (const [type, decision] of cases) {
        try {
          await respo.invoke('permissions:set', type, decision)
          results.push('accepted')
        } catch (error) {
          results.push(String(error))
        }
      }
      return results
    })
    for (const result of rejected) expect(result).toMatch(/invalid ipc payload/i)

    // An answer to a question nobody asked is ignored, not an error: a prompt
    // settled a frame before the click is a race, not an attack.
    const stale = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      await respo.invoke('permissions:respond', 'perm-999', true)
      return 'ok'
    })
    expect(stale).toBe('ok')
  } finally {
    await app.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

/** The slice of `window.respo` this spec drives, evaluated inside the page. */
type RespoBridge = {
  invoke(channel: 'permissions:set', type: string, decision: string): Promise<unknown>
  invoke(channel: 'permissions:respond', id: string, allow: boolean): Promise<void>
}
