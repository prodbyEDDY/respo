import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { probes, PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('clear-data')

/**
 * The toolbar's one-line notice.
 *
 * Not `getByRole('status')`: every loading device frame carries a spinner with
 * the same role, so once a clear reloads the views — which is the whole point
 * of a clear — that role matches six elements and the query is ambiguous.
 * `data-tone` is the notice's own marker.
 */
const NOTICE = '[role="status"][data-tone]'

/**
 * The clears, end to end — over a `file:` page, which is the honest offline
 * fixture and also the interesting case.
 *
 * A local file has no origin: Chromium reports the string `"null"` for it, and
 * "clear this site" for a page that is not a site has to refuse rather than
 * quietly emptying the whole partition. The cache is the one target that never
 * needed an origin, so it works from here — which is exactly the split the
 * feature is built around.
 */
test('clearing says whose data it can and cannot take', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const window = await app.firstWindow()
    await expect
      .poll(async () => (await probes(app, PROBE_URL)).length, {
        timeout: 45_000,
        message: 'device views never loaded the start url'
      })
      .toBe(5)

    // The menu is one control, not four destructive buttons in the toolbar.
    await window.getByLabel('Clear browsing data').click()
    for (const label of ['Storage', 'Cookies', 'Cache', 'Everything']) {
      await expect(window.getByRole('menuitem', { name: label })).toBeVisible()
    }

    await window.getByRole('menuitem', { name: 'Cookies' }).click()
    // There is no site here, so nothing was touched — and it says so.
    await expect(window.locator(NOTICE)).toContainText('no site here', { timeout: 10_000 })

    // The cache is the session's, not an origin's, so this one goes through.
    await window.keyboard.press('Control+Alt+z')
    await expect(window.locator(NOTICE)).toContainText('Cleared the cache', {
      timeout: 10_000
    })

    // And every view was reloaded on the other side of it: a page that outlives
    // its own storage is showing state that no longer exists.
    await expect
      .poll(async () => (await probes(app, PROBE_URL)).length, { timeout: 30_000 })
      .toBe(5)

    // The contract main answers with, straight off the channel.
    const refused = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      return respo.invoke('data:clear', 'storage')
    })
    expect(refused).toEqual({ ok: false, reason: 'no-origin' })

    const cleared = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      return respo.invoke('data:clear', 'cache')
    })
    expect(cleared).toEqual({ ok: true, target: 'cache', origin: null })

    // A target this build has never heard of is refused at the boundary.
    const rejected = await window.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      try {
        await respo.invoke('data:clear', 'everything-everywhere')
        return 'accepted'
      } catch (error) {
        return String(error)
      }
    })
    expect(rejected).toMatch(/invalid ipc payload/i)
  } finally {
    await app.close()
  }
})

/** The slice of `window.respo` this spec drives, evaluated inside the page. */
type RespoBridge = {
  invoke(
    channel: 'data:clear',
    target: string
  ): Promise<
    | { ok: true; target: string; origin: string | null }
    | { ok: false; reason: string; message?: string }
  >
}
