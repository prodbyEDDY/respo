import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Spec §8, measured: ten devices, continuous mirrored scrolling, diagnostics
 * counting console traffic on every one of them — the main event loop's p99
 * delay must stay under one frame.
 *
 * This is the perf gate of the suite: it proves a budget, not a behaviour, and
 * its numbers go into the wave report. It costs about a minute; skip it for a
 * quick local run with `RESPO_PERF=0`.
 *
 * The measurement itself is main's own dev perf monitor (`src/main/perf.ts`,
 * `monitorEventLoopDelay`), which prints a `[perf]` line per five-second
 * window to stdout whenever the app runs unpackaged — which is what
 * `_electron.launch` does. The spec only drives the load and reads the lines;
 * no IPC channel exists for the sake of the test.
 */
test.skip(process.env['RESPO_PERF'] === '0', 'skipped: RESPO_PERF=0')
test.setTimeout(240_000)

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')
const PERF_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'perf.html')).href

/** Spec §8: ten viewports. Five of the default suite and five more. */
const SUITE = [
  'iphone-15-pro',
  'pixel-8',
  'ipad-mini',
  'macbook-1280',
  'desktop-1440',
  'iphone-se',
  'iphone-16-pro-max',
  'pixel-8-pro',
  'iphone-14',
  'iphone-x'
]
const LEAD = SUITE[0] as string

/** The budget, and how long to lean on it: four full reporting windows. */
const BUDGET_MS = 16
const STRESS_MS = 20_000
/** One wheel tick every 50 ms: faster than a hand, slower than a frame. */
const WHEEL_EVERY_MS = 50

type RespoInvoke = {
  (channel: 'store:save', patch: unknown): Promise<void>
  (channel: 'sync:set-lead', deviceId: string | null): Promise<void>
  (channel: 'diagnostics:get'): Promise<{ deviceId: string; errors: number }[]>
}

function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...(process.env as Record<string, string>), RESPO_START_URL: PERF_URL }
  })
}

/** The device views showing `url`, by `webContents` id, ascending. */
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

/** The loop p99 of one `[perf]` line, in ms. */
function loopP99(line: string): number | null {
  const match = /\[perf\] loop p50=[\d.]+ms p99=([\d.]+)ms/.exec(line)
  return match === null ? null : Number(match[1])
}

test('main event loop p99 stays under 16 ms with 10 devices, mirrored scroll and diagnostics on', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'respo-perf-'))

  // Seed the ten-device suite the way the UI would, and let the close flush it.
  const seed = await launch(profile)
  try {
    const page = await seed.firstWindow()
    await page.waitForFunction(() => 'respo' in window)
    await page.evaluate(async (deviceIds: string[]) => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('store:save', {
        suites: [{ id: 'default', name: 'Default', deviceIds }]
      })
    }, SUITE)
  } finally {
    await seed.close()
  }

  const app = await launch(profile)
  const lines: { at: number; line: string }[] = []
  const onData = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.includes('[perf]')) lines.push({ at: Date.now(), line })
    }
  }
  app.process().stdout?.on('data', onData)

  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => 'respo' in window)

    let ids: number[] = []
    await expect
      .poll(
        async () => {
          ids = await viewIds(app, PERF_URL)
          return ids.length
        },
        { timeout: 60_000, message: 'the seeded suite never loaded the fixture' }
      )
      .toBe(SUITE.length)
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(SUITE.length, {
      timeout: 60_000
    })

    // Diagnostics is on: the fixture's console.error traffic is being counted.
    await expect
      .poll(async () => {
        return page.evaluate(async (deviceId: string) => {
          const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
          const all = await respo.invoke('diagnostics:get')
          return all.find((d) => d.deviceId === deviceId)?.errors ?? 0
        }, LEAD)
      })
      .toBeGreaterThan(0)

    // The lead is whatever the pointer last touched; say so explicitly.
    await page.evaluate(async (deviceId: string) => {
      const respo = (window as unknown as { respo: { invoke: RespoInvoke } }).respo
      await respo.invoke('sync:set-lead', deviceId)
    }, LEAD)

    // Lean on it: a wheel tick into the lead every 50 ms, down then up, for
    // STRESS_MS. Driven from inside main so the cadence does not depend on the
    // test's own round trips. Every tick is mirrored to the nine followers.
    const stressStart = Date.now()
    await app.evaluate(
      async ({ webContents }, arg: { id: number; everyMs: number; forMs: number }) => {
        const wc = webContents.fromId(arg.id)
        if (wc === undefined || wc === null) throw new Error(`no webContents ${arg.id}`)
        const ticks = Math.floor(arg.forMs / arg.everyMs)
        // Forty ticks down, forty up — a runway of ~5000 px, 400 px a tick.
        for (let i = 0; i < ticks; i++) {
          const deltaY = Math.floor(i / 40) % 2 === 0 ? 400 : -400
          await new Promise((r) => setTimeout(r, arg.everyMs))
          void wc.debugger
            .sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: 20,
              y: 20,
              deltaX: 0,
              deltaY
            })
            .catch(() => undefined)
        }
      },
      { id: ids[0] as number, everyMs: WHEEL_EVERY_MS, forMs: STRESS_MS }
    )

    // The mirror really ran: everyone moved together.
    const ratios = await scrollRatios(app, PERF_URL)
    expect(ratios).toHaveLength(SUITE.length)
    const leadRatio = ratios[0] as number
    for (const ratio of ratios) expect(Math.abs(ratio - leadRatio)).toBeLessThan(0.05)

    // One more window, so the last five seconds of stress are reported too.
    await new Promise((r) => setTimeout(r, 5_500))

    const during = lines.filter((l) => l.at >= stressStart)
    const p99s = during.map((l) => loopP99(l.line)).filter((v): v is number => v !== null)
    console.log(`\n[perf-budget] ${SUITE.length} devices, stress ${STRESS_MS / 1000}s`)
    for (const l of lines) console.log(`  ${l.at >= stressStart ? 'stress ' : 'warmup '}${l.line}`)
    console.log(
      `[perf-budget] windows under stress: ${p99s.length}, loop p99 max=${Math.max(...p99s)}ms, budget ${BUDGET_MS}ms\n`
    )

    expect(p99s.length).toBeGreaterThanOrEqual(Math.floor(STRESS_MS / 5_000) - 1)
    for (const p99 of p99s) expect(p99).toBeLessThan(BUDGET_MS)
  } finally {
    app.process().stdout?.off('data', onData)
    await app.close()
  }
})
