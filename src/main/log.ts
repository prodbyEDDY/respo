/**
 * The one log Respo writes (`userData/logs/main.log`).
 *
 * `electron-log` with its file transport only: no renderer bridge, no preload
 * injection, no IPC of its own. What the renderer prints at `console.error`
 * reaches this file through `webContents`'s `console-message` event, which is a
 * main-process event and not a channel (`watchRendererErrors`) — so there is
 * nothing new for `@shared/ipc` to declare and nothing a page could talk to.
 *
 * Nothing here ever puts a dialog in front of the user (spec §5.9: no popups):
 * an uncaught error is a line in this file and, in development, on stdout.
 */

import { app, type WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'

/** One file, rotated once: `main.log` and, after `MAX_LOG_BYTES`, `main.old.log`. */
export const LOG_FILE = 'main.log'
export const MAX_LOG_BYTES = 1_048_576

/** Where the log lives. Under the profile, so `--user-data-dir` moves it too. */
export function logsDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

/**
 * The narrow shape the updater and anything else takes: `electron-updater`
 * accepts exactly this, and a test can hand in three arrays.
 */
export type Logger = {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

let installed = false

/**
 * Point the file transport at the profile and start catching what nobody else
 * does. Idempotent; the second call is a no-op.
 */
export function installLogging(options: { dev: boolean }): Logger {
  if (!installed) {
    installed = true
    log.transports.file.resolvePathFn = () => join(logsDirectory(), LOG_FILE)
    log.transports.file.maxSize = MAX_LOG_BYTES
    log.transports.file.level = 'info'
    // Development keeps stdout, where the perf monitor already prints; a
    // packaged app has no console worth writing to.
    log.transports.console.level = options.dev ? 'debug' : false
    // `showDialog: false` is the whole point of the options object: the default
    // puts a native error box in front of the user.
    log.errorHandler.startCatching({ showDialog: false })
    // Not `log.initialize()`: that installs a renderer bridge Respo does not
    // want, and the file transport needs none of it.
  }
  return log
}

/**
 * Make sure the folder exists before something opens it.
 *
 * `electron-log` creates it on the first write, but "Open logs folder" on a
 * session that has logged nothing yet would otherwise open nothing.
 */
export function ensureLogsDirectory(): string {
  const dir = logsDirectory()
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * The messages Respo's own window prints at `error` level, into the log.
 *
 * Errors only: `console.log` in the renderer is developer chatter and the
 * layout telemetry, neither of which belongs in a file that ships in a bug
 * report. And only Respo's window — device pages are other people's code and
 * their console is their DevTools'.
 */
export function watchRendererErrors(contents: WebContents, logger: Logger): void {
  contents.on('console-message', (event) => {
    if (event.level !== 'error') return
    logger.error(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  contents.on('render-process-gone', (_event, details) => {
    logger.error(`[renderer] process gone: ${details.reason} (exit code ${details.exitCode})`)
  })
  contents.on('unresponsive', () => {
    logger.warn('[renderer] unresponsive')
  })
}
