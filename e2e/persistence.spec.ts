import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/**
 * A throwaway profile per run: the assertion is about what survives a restart,
 * so the suite must not inherit — or leave behind — a real user's document.
 */
const userDataDir = mkdtempSync(join(tmpdir(), 'respo-e2e-'))

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })
}

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

test('theme and suite selection survive a restart', async () => {
  const first = await launch()
  try {
    const page = await first.firstWindow()
    // Wait for the renderer bridge, then post the two changes through the same
    // typed channel the UI uses.
    await page.waitForFunction(() => 'respo' in window)

    const before = await page.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      const loaded = await respo.invoke('store:load')
      return loaded
    })
    expect(before.ui.theme).toBe('system')
    expect(before.suites).toHaveLength(1)

    await page.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      await respo.invoke('store:save', {
        ui: { theme: 'dark' },
        suites: [
          { id: 'default', name: 'Default', deviceIds: ['iphone-15-pro'] },
          { id: 'wide', name: 'Wide', deviceIds: ['desktop-1920'] }
        ]
      })
      await respo.invoke('store:save', { activeSuiteId: 'wide' })
    })
  } finally {
    // Closing the window is what flushes the debounced write.
    await first.close()
  }

  const second = await launch()
  try {
    const page = await second.firstWindow()
    await page.waitForFunction(() => 'respo' in window)

    const restored = await page.evaluate(async () => {
      const respo = (window as unknown as { respo: RespoBridge }).respo
      return respo.invoke('store:load')
    })

    expect(restored.ui.theme).toBe('dark')
    expect(restored.activeSuiteId).toBe('wide')
    expect(restored.suites.map((s) => s.id)).toEqual(['default', 'wide'])
    expect(restored.schemaVersion).toBe(1)
  } finally {
    await second.close()
  }
})

/** The slice of `window.respo` this spec drives, evaluated inside the page. */
type RespoBridge = {
  invoke(channel: 'store:load'): Promise<{
    schemaVersion: number
    activeSuiteId: string
    suites: { id: string; name: string; deviceIds: string[] }[]
    ui: { theme: string }
  }>
  invoke(channel: 'store:save', patch: unknown): Promise<void>
}
