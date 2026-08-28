import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** A document exactly 4000 CSS pixels tall, with its point of interest at 3600. */
const TALL_URL = pathToFileURL(resolve(__dirname, 'fixtures', 'tall.html')).href
const DOCUMENT_HEIGHT = 4000

/** The first frame on the default canvas, and the viewport it emulates. */
const PHONE = { prefix: 'iphone-15-pro-393x852-', width: 393, height: 852 }
/** The last frame on it, and the one whose viewport the canvas zoom used to move. */
const DESKTOP = { prefix: 'desktop-1440-1440x900-', width: 1440, height: 900 }

const userDataDir = mkdtempSync(join(tmpdir(), 'respo-e2e-shots-'))
const shotsDir = mkdtempSync(join(tmpdir(), 'respo-shots-'))

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(shotsDir, { recursive: true, force: true })
})

/**
 * A PNG's pixel dimensions, straight out of the IHDR chunk.
 *
 * The header is fixed-width by specification — 8 signature bytes, then a
 * 4-byte length, `IHDR`, then width and height as big-endian 32-bit integers —
 * so this needs no decoder and no dependency, which is the point: the claim
 * being tested is about the size of the image, not its contents.
 */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  const signature = bytes.subarray(0, 8).toString('hex')
  expect(signature, `${path} is not a PNG`).toBe('89504e470d0a1a0a')
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function shots(): string[] {
  return readdirSync(shotsDir).sort()
}

/** The slice of `window.respo` this spec drives, evaluated inside the page. */
type ShotEvent = {
  id: string
  batchId: string
  batchSize: number
  deviceId: string
  state: 'queued' | 'active' | 'done' | 'failed'
  path?: string
  error?: string
}

type RespoBridge = {
  invoke(channel: 'store:save', patch: unknown): Promise<void>
  invoke(channel: 'shot:get-dir'): Promise<string>
  invoke(
    channel: 'shot:all',
    request: { fullPage: boolean; format?: string; dpr?: string | number }
  ): Promise<{ batchId: string; queued: number }>
  invoke(
    channel: 'shot:device',
    deviceId: string,
    request: { fullPage: boolean; format?: string; dpr?: string | number }
  ): Promise<{ batchId: string; queued: number }>
  invoke(channel: 'shot:reveal', path: string): Promise<boolean>
  onMainEvent(callback: (event: { type: string; payload: unknown }) => void): () => void
}

declare global {
  interface Window {
    /** Every `shot-state` payload this window has been sent, in order. */
    __shotEvents?: ShotEvent[]
  }
}

/**
 * Screenshot one device's viewport and answer with the file main wrote.
 *
 * The path comes from the `shot-state` event rather than from guessing at the
 * folder: two shots of one device in the same second differ only by a collision
 * suffix, and which of those sorts last is not something a test should have an
 * opinion about.
 */
async function captureOne(page: Page, deviceId: string): Promise<string> {
  await page.evaluate(async (id: string) => {
    const respo = (window as unknown as { respo: RespoBridge }).respo
    window.__shotEvents = []
    await respo.invoke('shot:device', id, { fullPage: false })
  }, deviceId)

  let path = ''
  await expect
    .poll(
      async () => {
        const events = await page.evaluate(() => window.__shotEvents ?? [])
        const done = events.find((event) => event.state === 'done')
        path = done?.path ?? ''
        return events.find((event) => event.state === 'done' || event.state === 'failed')?.state
      },
      { message: `the ${deviceId} screenshot never finished` }
    )
    .toBe('done')

  return path
}

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: TALL_URL
    }
  })
}

test('screenshots: full page, every device, and a batch that fails as a batch', async () => {
  const app = await launch()

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await page.waitForFunction(() => 'respo' in window)

    // Collect the batched `shot-state` events the way the UI will: one
    // subscription, many payloads per message.
    await page.evaluate(() => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      window.__shotEvents = []
      respo.onMainEvent((event) => {
        if (event.type !== 'shot-state') return
        window.__shotEvents?.push(...(event.payload as ShotEvent[]))
      })
    })

    // Point the queue at a folder this spec owns, through the same persistence
    // channel the settings dialog uses.
    await page.evaluate(async (directory: string) => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      await respo.invoke('store:save', {
        screenshots: { directory, format: 'png', dpr: 1 }
      })
    }, shotsDir)
    expect(
      await page.evaluate(() =>
        (window as unknown as { respo: RespoBridge }).respo.invoke('shot:get-dir')
      )
    ).toBe(shotsDir)

    /* ── One full-page shot of every device ───────────────────────────────── */

    const batch = await page.evaluate(() =>
      (window as unknown as { respo: RespoBridge }).respo.invoke('shot:all', { fullPage: true })
    )
    expect(batch.queued).toBe(5)

    await expect.poll(() => shots().length, { message: 'five files never landed' }).toBe(5)

    const phone = shots().find((name) => name.startsWith(PHONE.prefix))
    expect(phone, `no file named ${PHONE.prefix}*`).toBeDefined()

    // The load-bearing claim: `captureBeyondViewport` renders the whole
    // document, so the image is four thousand pixels tall — the content below
    // the fold is in it, and could not be in a viewport capture.
    const full = pngSize(join(shotsDir, phone as string))
    expect(full.width).toBe(PHONE.width)
    expect(full.height).toBeGreaterThan(PHONE.height * 4)
    expect(Math.abs(full.height - DOCUMENT_HEIGHT)).toBeLessThanOrEqual(2)

    // Every device reported `done`, all under one batch id, all with the size
    // the report is out of — this is what "3 of 5 saved" is counted from.
    const done = await page.evaluate(() => window.__shotEvents ?? [])
    const terminal = done.filter((event) => event.state === 'done')
    expect(terminal).toHaveLength(5)
    expect(new Set(terminal.map((event) => event.batchId))).toEqual(new Set([batch.batchId]))
    expect(terminal.every((event) => event.batchSize === 5)).toBe(true)
    expect(terminal.every((event) => (event.path ?? '').startsWith(shotsDir))).toBe(true)

    /* ── The same device, viewport only ───────────────────────────────────── */

    const visible = pngSize(await captureOne(page, 'iphone-15-pro'))
    // The emulated viewport at 1×, and nothing below it. The collision suffix
    // is what kept it from overwriting the full-page shot of the same second —
    // there are two files for this device now, and both are whole.
    expect(visible.width).toBe(PHONE.width)
    expect(visible.height).toBe(PHONE.height)
    expect(shots().filter((name) => name.startsWith(PHONE.prefix))).toHaveLength(2)

    /* ── A desktop device, on a zoomed-out canvas ─────────────────────────── */

    // The canvas zoom is a *painting* scale, and a screenshot must not inherit
    // it: a 1440px monitor shot at 50% zoom is still a 1440px picture. This is
    // the desktop emulation fix seen from the file it produces.
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: 'More options' }).click()
      await page.getByRole('menuitem', { name: 'Zoom out' }).click()
    }

    expect(pngSize(await captureOne(page, 'desktop-1440'))).toEqual({
      width: DESKTOP.width,
      height: DESKTOP.height
    })

    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Reset zoom' }).click()

    /* ── A whole batch that cannot be written ─────────────────────────────── */

    // A file where the folder should be: every `mkdir` fails, so every job in
    // the batch fails — and the app keeps running.
    const blocked = join(shotsDir, 'blocked')
    writeFileSync(blocked, 'not a folder')
    await page.evaluate(async (directory: string) => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      window.__shotEvents = []
      await respo.invoke('store:save', { screenshots: { directory, format: 'png', dpr: 1 } })
      await respo.invoke('shot:all', { fullPage: false })
    }, blocked)

    await expect
      .poll(async () => {
        const events = await page.evaluate(() => window.__shotEvents ?? [])
        return events.filter((event) => event.state === 'failed').length
      })
      .toBe(5)

    const failures = (await page.evaluate(() => window.__shotEvents ?? [])).filter(
      (event) => event.state === 'failed'
    )
    expect(failures.every((event) => event.batchSize === 5)).toBe(true)
    expect(failures.every((event) => (event.error ?? '') !== '')).toBe(true)

    /* ── `shot:reveal` refuses a path outside the folder ──────────────────── */

    const outsider = process.platform === 'win32' ? 'C:\\Windows\\explorer.exe' : '/etc/passwd'
    expect(
      await page.evaluate(
        (path: string) =>
          (window as unknown as { respo: RespoBridge }).respo.invoke('shot:reveal', path),
        outsider
      )
    ).toBe(false)

    // And the queue still works afterwards: a failed batch is not a dead one.
    await page.evaluate(async (directory: string) => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      await respo.invoke('store:save', { screenshots: { directory, format: 'png', dpr: 1 } })
      await respo.invoke('shot:device', 'iphone-15-pro', { fullPage: false })
    }, shotsDir)
    await expect.poll(() => shots().filter((name) => name.endsWith('.png')).length).toBe(7)
  } finally {
    await app.close()
  }
})

/**
 * The same pipeline, driven the way a person drives it.
 *
 * Everything above went through the IPC channels; this goes through the
 * controls, in both themes, and then closes the app to prove the settings are
 * a document rather than a session.
 */
test('the screenshot UI works in both themes, and its settings outlive the app', async () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'respo-shots-ui-'))
  const uiProfile = mkdtempSync(join(tmpdir(), 'respo-e2e-shots-ui-'))
  const files = (extension: string): string[] =>
    readdirSync(uiDir).filter((name) => name.endsWith(extension))

  const start = (): Promise<ElectronApplication> =>
    electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${uiProfile}`],
      env: { ...(process.env as Record<string, string>), RESPO_START_URL: TALL_URL }
    })

  // Seed the folder into the document and restart, rather than posting it into
  // a running session: picking a folder is a native dialog no test can drive,
  // and the settings the renderer *hydrates with* are the ones it writes back.
  const seed = await start()
  try {
    const page = await seed.firstWindow()
    await page.waitForFunction(() => 'respo' in window)
    await page.evaluate(async (directory: string) => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      await respo.invoke('store:save', { screenshots: { directory, format: 'png', dpr: 1 } })
    }, uiDir)
  } finally {
    // Closing the window is what flushes the debounced write.
    await seed.close()
  }

  const app = await start()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)
    await page.waitForFunction(() => 'respo' in window)

    /* ── Settings, from the overflow menu ─────────────────────────────────── */

    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Settings…' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The folder shown is the one main will really write to.
    await expect(dialog.getByText(uiDir, { exact: true })).toBeVisible()

    await dialog.getByRole('radio', { name: 'JPEG' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    /* ── One device, from its own header ──────────────────────────────────── */

    await page.getByRole('button', { name: 'Screenshot this device' }).first().click()
    await expect
      .poll(() => files('.jpg').length, { message: 'the camera button saved nothing' })
      .toBe(1)
    // The format the dialog chose reached the file, so the setting is live.
    expect(files('.png')).toHaveLength(0)

    // The result is reported where the renderer owns the pixels — over the
    // canvas it would be behind a device view.
    await expect(page.getByRole('status')).toContainText('Saved')

    // The shutter is drawn outside the frame for the same reason (a native view
    // covers the inside of it). Its resting state is all a test can assert
    // without racing a 150ms flash.
    await expect(page.locator('[data-shutter]')).toHaveCount(5)

    /* ── Every device, in the dark theme ──────────────────────────────────── */

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Screenshot every device' }).click()
    await expect
      .poll(() => files('.jpg').length, { message: 'the dark theme lost the screenshots' })
      .toBe(6)
    await expect(page.getByRole('status')).toContainText('Saved 5 screenshots')
  } finally {
    await app.close()
  }

  /* ── And again, from a cold start ───────────────────────────────────────── */

  const second = await start()
  try {
    const page = await second.firstWindow()
    await page.waitForFunction(() => 'respo' in window)

    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Settings…' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('radio', { name: 'JPEG' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(dialog.getByText(uiDir, { exact: true })).toBeVisible()
  } finally {
    await second.close()
    rmSync(uiDir, { recursive: true, force: true })
    rmSync(uiProfile, { recursive: true, force: true })
  }
})
