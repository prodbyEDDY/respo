import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { ownProfile } from './profile'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** A profile per test: both restart the app (see `ownProfile`). */
const userDataDir = ownProfile('auth')
const cancelDataDir = ownProfile('auth-cancel')

/** What the protected page says once the right credentials arrive. */
const SECRET = 'the protected page'

/**
 * A server that asks for a password, exactly the way a staging box does.
 *
 * `file:` fixtures cannot express this at all — there is no 401 without a
 * server — so this spec brings its own. It records every `Authorization`
 * header it sees, which is how "one dialog answered five viewports" is checked
 * from the outside.
 */
function startProtectedServer(): Promise<{
  server: Server
  url: string
  authorizations: string[]
}> {
  const authorizations: string[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const header = request.headers.authorization
    if (header === undefined) {
      response.writeHead(401, {
        'www-authenticate': 'Basic realm="Staging"',
        'content-type': 'text/html; charset=utf-8'
      })
      response.end('<!doctype html><title>401</title><h1>unauthorized</h1>')
      return
    }
    authorizations.push(header)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>ok</title><h1>${SECRET}</h1>`)
  })

  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      done({ server, url: `http://127.0.0.1:${address.port}/`, authorizations })
    })
  })
}

/** How many device views are showing the protected page. Main can see them. */
async function viewsShowing(app: ElectronApplication, needle: string): Promise<number> {
  const titles = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((wc) => (wc.isDestroyed() ? '' : wc.getTitle()))
  )
  return titles.filter((title) => title === needle).length
}

test('one password dialog answers every viewport', async () => {
  const { server, url, authorizations } = await startProtectedServer()
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: url }
  })

  try {
    const window = await app.firstWindow()

    // One dialog, however many viewports hit the same host — the coalescing
    // lives in main (`auth.ts`).
    const dialog = window.locator('[data-slot="auth-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 45_000 })
    await expect(dialog).toContainText('127.0.0.1')
    await expect(dialog).toContainText('Staging')
    expect(await window.locator('[data-slot="auth-dialog"]').count()).toBe(1)

    await window.getByLabel('Username').fill('ada')
    await window.getByLabel('Password').fill('hunter2')
    await window.getByRole('button', { name: 'Sign in' }).click()

    await expect(dialog).toBeHidden()

    // Every view got through on the one answer.
    await expect.poll(() => viewsShowing(app, 'ok'), { timeout: 30_000 }).toBeGreaterThanOrEqual(5)
    expect(authorizations.length).toBeGreaterThanOrEqual(5)
    for (const header of authorizations) {
      expect(header).toBe(`Basic ${Buffer.from('ada:hunter2').toString('base64')}`)
    }
  } finally {
    await app.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

test('cancelling leaves the 401 on screen rather than hanging the request', async () => {
  const { server, url } = await startProtectedServer()
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${cancelDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: url }
  })

  try {
    const window = await app.firstWindow()
    const dialog = window.locator('[data-slot="auth-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 45_000 })

    /*
      Cancel every challenge that appears, not just the first one.

      A cancel is deliberately *not* remembered: it means "not now", not
      "never", so a view whose request reaches the server after the dialog was
      dismissed raises a new challenge rather than being refused on the strength
      of someone else's answer. Five viewports do not start their requests in
      the same millisecond, so the stragglers can ask again — which is the
      behaviour, and this loop is what asserts it terminates.
    */
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!(await dialog.isVisible())) break
      await window.getByRole('button', { name: 'Cancel' }).click()
      // A moment for the next straggler, if there is one, to arrive.
      await window.waitForTimeout(500)
    }
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    // The requests went on without credentials and the server said 401, which
    // is a page — not a spinner that never resolves.
    await expect.poll(() => viewsShowing(app, '401'), { timeout: 30_000 }).toBeGreaterThan(0)

    // And an answer to a challenge nobody is waiting for is dropped, not thrown.
    const stale = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      await respo.invoke('auth:respond', 'auth-999', { username: 'x', password: 'y' })
      return 'ok'
    })
    expect(stale).toBe('ok')

    // Junk credentials are refused at the boundary.
    const rejected = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      try {
        await respo.invoke('auth:respond', 'auth-1', 'ada:hunter2' as never)
        return 'accepted'
      } catch (error) {
        return String(error)
      }
    })
    expect(rejected).toMatch(/invalid ipc payload/i)
  } finally {
    await app.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

/** The slice of `window.respo` this spec drives, evaluated inside the page. */
type RespoBridge = {
  invoke(
    channel: 'auth:respond',
    id: string,
    credentials: { username: string; password: string } | null
  ): Promise<void>
}
