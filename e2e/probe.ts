import type { ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** What `e2e/fixtures/probe.html` publishes through `document.title`. */
export type Probe = {
  innerWidth: number
  innerHeight: number
  dpr: number
  ua: string
  maxTouchPoints: number
  /** `navigator.userAgentData`, or `null` when the page has none. */
  uaData: {
    brands: string[]
    mobile: boolean
    platform: string
    platformVersion: string
    model: string
    architecture: string
  } | null
}

export const PROBE_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'probe.html')).href

/**
 * Ask main for the probe every device view is reporting.
 *
 * Device pages live in `WebContentsView`s, which are not windows — Playwright
 * has no page handle for them. Main does: it can read every `webContents`, and
 * only the device views ever load the fixture.
 */
export async function probes(app: ElectronApplication, url: string): Promise<Probe[]> {
  const titles = await app.evaluate(({ webContents }, probeUrl: string) => {
    return webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL() === probeUrl)
      .map((wc) => wc.getTitle())
  }, url)

  return titles.flatMap((title) => {
    try {
      return [JSON.parse(title) as Probe]
    } catch {
      // Still on the placeholder title: the fixture has not run yet.
      return []
    }
  })
}
