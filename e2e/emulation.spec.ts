import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const PROBE_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'probe.html')).href

/** What `e2e/fixtures/probe.html` publishes through `document.title`. */
type Probe = {
  innerWidth: number
  innerHeight: number
  dpr: number
  ua: string
  maxTouchPoints: number
}

/**
 * Ask main for the probe every device view is reporting.
 *
 * Device pages live in `WebContentsView`s, which are not windows — Playwright
 * has no page handle for them. Main does: it can read every `webContents`, and
 * only the device views ever load the fixture.
 */
async function probes(app: ElectronApplication, url: string): Promise<Probe[]> {
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

/**
 * One launch, one set of assertions: a failed test restarts the Playwright
 * worker, and a second Electron instance would fight the first over the app's
 * user-data directory.
 */
test('CDP emulation reaches the page in every device view', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...(process.env as Record<string, string>),
      // Keep the suite offline and deterministic: the views open a local
      // fixture instead of the default start url.
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    // Let the app finish booting before talking to it. Driving main from the
    // outside while it is still starting up takes the process down.
    await app.firstWindow()

    let reported: Probe[] = []

    // The five default devices each get a view; wait until they have all
    // loaded the fixture and published their probe.
    await expect
      .poll(
        async () => {
          reported = await probes(app, PROBE_URL)
          return reported.length
        },
        { timeout: 45_000, message: 'device views never reported a probe' }
      )
      .toBe(5)

    // The criterion from the brief: the iPhone 15 Pro view is an iPhone.
    const iphones = reported.filter((p) => /iPhone/.test(p.ua))
    expect(iphones).toHaveLength(1)
    const iphone = iphones[0] as Probe
    expect(iphone.innerWidth).toBe(393)
    expect(iphone.dpr).toBe(3)
    expect(iphone.ua).toMatch(/iPhone; CPU iPhone OS/)
    expect(iphone.maxTouchPoints).toBeGreaterThan(0)

    // Emulation is per view, not global: the desktop view stays a desktop.
    const desktops = reported.filter((p) => p.innerWidth === 1440)
    expect(desktops).toHaveLength(1)
    const desktop = desktops[0] as Probe
    expect(desktop.dpr).toBe(1)
    expect(desktop.ua).toContain('Windows NT')
    expect(desktop.ua).not.toContain('Mobile')
    // `navigator.maxTouchPoints` is deliberately not asserted here: CDP only
    // accepts 1..16 touch points, so switching touch emulation *off* hands the
    // page back the host machine's own hardware — 10 on a touchscreen laptop,
    // 0 on a desktop. Chrome DevTools behaves the same way.

    // Every default device gets its own viewport and pixel ratio.
    expect(reported.map((p) => p.innerWidth).sort((a, b) => a - b)).toEqual([
      393, 412, 768, 1280, 1440
    ])
    const dprByWidth = new Map(reported.map((p) => [p.innerWidth, p.dpr]))
    expect(dprByWidth.get(393)).toBe(3) // iPhone 15 Pro
    expect(dprByWidth.get(412)).toBe(2.625) // Pixel 8
    expect(dprByWidth.get(768)).toBe(2) // iPad mini
    expect(dprByWidth.get(1280)).toBe(2) // MacBook 1280
    expect(dprByWidth.get(1440)).toBe(1) // Desktop 1440
  } finally {
    await app.close()
  }
})
