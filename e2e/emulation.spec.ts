import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { probes, PROBE_URL, type Probe } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec's own state, not the machine's (see `ownProfile`). */
const userDataDir = ownProfile('emulation')

/**
 * One launch, one set of assertions: a failed test restarts the Playwright
 * worker, and a second Electron instance would fight the first over the app's
 * user-data directory.
 */
test('CDP emulation reaches the page in every device view', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
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

    // Client Hints follow the user agent, not the host machine (spec §5.2):
    // the Pixel says Android and mobile through `navigator.userAgentData`,
    // the Windows desktop says Windows, and the iPhone and iPad — Safaris —
    // have none. Three Chromium devices in the default suite, so three.
    await expect
      .poll(
        async () => {
          reported = await probes(app, PROBE_URL)
          return reported.filter((p) => p.uaData !== null).length
        },
        { timeout: 20_000, message: 'client hints never reached the Chromium views' }
      )
      .toBe(3)
    const pixel = reported.find((p) => p.innerWidth === 412) as Probe
    expect(pixel.uaData).toMatchObject({
      platform: 'Android',
      platformVersion: '15.0.0',
      model: 'Pixel 8',
      mobile: true
    })
    expect(pixel.uaData?.brands).toContain('Chromium')
    const windows = reported.find((p) => p.innerWidth === 1440) as Probe
    expect(windows.uaData).toMatchObject({ platform: 'Windows', mobile: false, model: '' })
    const mac = reported.find((p) => p.innerWidth === 1280) as Probe
    expect(mac.uaData).toMatchObject({ platform: 'macOS', mobile: false })
    expect((reported.find((p) => /iPhone/.test(p.ua)) as Probe).uaData).toBeNull()
    expect((reported.find((p) => p.innerWidth === 768) as Probe).uaData).toBeNull()
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
