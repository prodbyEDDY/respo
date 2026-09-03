import { test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A user-data directory this spec file owns, cleaned up when it is done.
 *
 * Launching `_electron.launch` without `--user-data-dir` does not mean "no
 * state": it means Electron's *default* profile, which on a dev machine is
 * shared by every spec that omits the flag **and** by `npm run dev` — the
 * unpackaged binary resolves the same directory for both.
 *
 * That directory is where Respo keeps `respo-state.json`, and the document in
 * it is not decoration. Main restores the mirroring switches into `SyncEngine`
 * before the first view exists, restores the active suite (which decides how
 * many views there are at all), the rotations, the DevTools dock and the
 * screenshot settings. A developer who switched mirroring off in `npm run dev`,
 * or narrowed the suite to two devices, leaves those decisions behind — and a
 * spec that inherits them fails on an untouched tree, for a reason that is
 * invisible in git and different on every machine.
 *
 * So a spec that asserts anything about that state owns the state: a fresh
 * temporary profile per file, which starts from `defaultPersistedState()`.
 */
export function ownProfile(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `respo-e2e-${name}-`))
  test.afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}
