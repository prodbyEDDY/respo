import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('live-reload')

type RespoInvoke = {
  (channel: 'nav:navigate', url: string): Promise<void>
  (channel: 'watcher:get'): Promise<{ state: string; file: string | null }>
}

/**
 * A page and its stylesheet, in a folder of their own: the watcher follows
 * the page's folder, and a temp folder is one nothing else writes to.
 */
function makeSite(): { dir: string; page: string; css: string } {
  const dir = mkdtempSync(join(tmpdir(), 'respo-live-'))
  const css = join(dir, 'style.css')
  const page = join(dir, 'index.html')
  writeFileSync(css, 'body { background: rgb(255, 255, 255); }\n')
  writeFileSync(
    page,
    [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<link rel="stylesheet" href="style.css"><title>live v1</title></head>',
      '<body><p>live reload fixture</p></body></html>'
    ].join('')
  )
  return { dir, page, css }
}

/** What every device view showing `url` believes: its background and whether it reloaded. */
function facts(
  app: ElectronApplication,
  url: string
): Promise<{ background: string; title: string; marker: boolean }[]> {
  return app.evaluate(async ({ webContents }, pageUrl: string) => {
    const out: { background: string; title: string; marker: boolean }[] = []
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || !wc.getURL().startsWith(pageUrl)) continue
      try {
        out.push(
          (await wc.executeJavaScript(
            `({ background: getComputedStyle(document.body).backgroundColor, title: document.title, marker: window.__respoMarker === true })`
          )) as { background: string; title: string; marker: boolean }
        )
      } catch {
        // Mid-reload; the poll comes back.
      }
    }
    return out
  }, url)
}

/** Plant a flag in every view's document: a reload is what makes it disappear. */
function markAll(app: ElectronApplication, url: string): Promise<void> {
  return app.evaluate(async ({ webContents }, pageUrl: string) => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || !wc.getURL().startsWith(pageUrl)) continue
      await wc.executeJavaScript('window.__respoMarker = true')
    }
  }, url)
}

function startServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>remote</title><p>remote</p>')
  })
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      done({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

async function watcherState(page: Page): Promise<{ state: string; file: string | null }> {
  await page.waitForFunction(() => 'respo' in window)
  return page.evaluate(async () => {
    const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
    return respo.invoke('watcher:get')
  })
}

test('a local page follows its files: css is swapped in place, html reloads, and http stops the watch', async () => {
  const site = makeSite()
  const pageUrl = pathToFileURL(site.page).href
  const { server, url: remoteUrl } = await startServer()
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: pageUrl }
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    // Watching, and the address bar says so.
    await expect(page.locator('[data-watcher="watching"]')).toBeVisible()
    expect((await watcherState(page)).file).toBe(site.page)
    await expect
      .poll(async () => (await facts(app, pageUrl)).map((f) => f.background))
      .toEqual(Array(5).fill('rgb(255, 255, 255)'))

    // A stylesheet edit lands without a reload: the flag planted in each
    // document is still there, and the colour changed on every device.
    await markAll(app, pageUrl)
    writeFileSync(site.css, 'body { background: rgb(0, 128, 255); }\n')
    await expect
      .poll(async () => (await facts(app, pageUrl)).map((f) => [f.background, f.marker]), {
        timeout: 10_000
      })
      .toEqual(Array(5).fill(['rgb(0, 128, 255)', true]))

    // An html edit reloads every device: new title, flag gone.
    writeFileSync(
      site.page,
      [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<link rel="stylesheet" href="style.css"><title>live v2</title></head>',
        '<body><p>live reload fixture, edited</p></body></html>'
      ].join('')
    )
    await expect
      .poll(async () => (await facts(app, pageUrl)).map((f) => [f.title, f.marker]), {
        timeout: 10_000
      })
      .toEqual(Array(5).fill(['live v2', false]))

    // Paused: an edit changes nothing until resumed.
    await page.locator('[data-watcher="watching"]').click()
    await expect(page.locator('[data-watcher="paused"]')).toBeVisible()
    await markAll(app, pageUrl)
    writeFileSync(site.css, 'body { background: rgb(255, 0, 0); }\n')
    await page.waitForTimeout(1200)
    expect((await facts(app, pageUrl)).map((f) => f.background)).toEqual(
      Array(5).fill('rgb(0, 128, 255)')
    )
    await page.locator('[data-watcher="paused"]').click()
    await expect(page.locator('[data-watcher="watching"]')).toBeVisible()
    writeFileSync(site.css, 'body { background: rgb(255, 0, 0); }\n')
    await expect
      .poll(async () => (await facts(app, pageUrl)).map((f) => f.background), { timeout: 10_000 })
      .toEqual(Array(5).fill('rgb(255, 0, 0)'))

    // Leaving for an http page stops the watch, and the dot goes away.
    await page.evaluate(async (url: string) => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('nav:navigate', url)
    }, remoteUrl)
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await expect(page.locator('[data-watcher]')).toHaveCount(0)
    await expect
      .poll(() => watcherState(page))
      .toEqual({ state: 'off', file: null, lastReloadAt: expect.any(Number) })
  } finally {
    await app.close()
    server.close()
  }
})
