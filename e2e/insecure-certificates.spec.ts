import { openSettings } from './settings'
import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { ownProfile } from './profile'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** This spec restarts the app to check the switch survived (see `ownProfile`). */
const userDataDir = ownProfile('insecure-certificates')

const LAUNCH = {
  args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
  env: { ...(process.env as Record<string, string>), RESPO_START_URL: PROBE_URL }
}

/**
 * The certificate switch, end to end — as far as it can honestly be taken.
 *
 * What is *not* here: a real invalid certificate. Serving one would mean
 * generating a key pair and a self-signed certificate inside the suite, which
 * is a lot of machinery to exercise a two-line handler whose whole logic is a
 * single `&&`. That logic — the half that says "device views only, never
 * Respo's own window" — is a pure function with its own unit test
 * (`shouldTrustCertificate`). What this covers is the part unit tests cannot:
 * the switch is reachable, it says what it does, and it survives a restart,
 * because a security setting that silently forgets itself is worse than one
 * that does not exist.
 */
test('the certificate switch is off, warns when on, and is remembered', async () => {
  const app = await electron.launch(LAUNCH)

  try {
    const window = await app.firstWindow()

    await openSettings(window, 'Developer tools')

    const setting = window.locator('[data-slot="insecure-certificates"]')
    await expect(setting).toBeVisible({ timeout: 10_000 })
    // Off out of the box. A browser that accepts a broken certificate by
    // default is a browser that lies about what it is showing you.
    await expect(setting).toHaveAttribute('data-enabled', 'false')
    await expect(setting).toContainText('Respo’s own window is never affected')

    await window.getByLabel('Allow invalid certificates').click()
    await expect(setting).toHaveAttribute('data-enabled', 'true')
    // Turning it on is not a quiet event.
    await expect(setting).toContainText('not private')
  } finally {
    await app.close()
  }

  // The document is written behind a debounce and flushed on close; a fresh
  // launch has to read the same answer back.
  const restarted = await electron.launch(LAUNCH)
  try {
    const window = await restarted.firstWindow()
    await openSettings(window, 'Developer tools')

    await expect(window.locator('[data-slot="insecure-certificates"]')).toHaveAttribute(
      'data-enabled',
      'true',
      { timeout: 10_000 }
    )
  } finally {
    await restarted.close()
  }
})
