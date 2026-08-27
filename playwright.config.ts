import { defineConfig } from '@playwright/test'

/**
 * Electron e2e. There is no browser project and no web server: every spec
 * launches the built app through `_electron.launch`.
 *
 * `globalSetup` runs `electron-vite build` first, so `npm run e2e` always tests
 * the current sources rather than whatever happens to sit in `out/`.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  // One Electron app at a time: the views share the `persist:respo` partition.
  workers: 1,
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']]
})
