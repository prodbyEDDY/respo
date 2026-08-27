import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

/**
 * `_electron.launch` runs `out/main/index.js`, so the e2e suite is only ever as
 * fresh as the last build. Build here instead of asking the caller to remember;
 * `npm run e2e` stays a single command.
 */
export default function globalSetup(): void {
  execFileSync('npx', ['electron-vite', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
}
