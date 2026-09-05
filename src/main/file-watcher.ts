/**
 * Live reload for local pages (spec §5.8).
 *
 * When the canvas is on a `file://` page, the file and its neighbours are
 * watched and every device follows an edit: a stylesheet change is swapped
 * in place — the `<link>` that loaded it gets a cache-busting query, which
 * is a one-off `Runtime.evaluate` and not a script left in the page
 * (CLAUDE.md §3) — and anything else reloads every view. Nothing is watched
 * for an `http(s)` page: that is the developer's own dev server's job, and
 * a watcher on a folder Respo happened to open a file from would be a
 * surprise.
 *
 * chokidar (MIT) does the watching; this module decides what to watch and
 * what an event means. Both are pure enough to unit-test against a fake
 * watcher: the rules — which files count, how a burst is coalesced, when
 * the watcher stops — are the part that has to be right.
 */

import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { WatcherState } from '@shared/ipc'
import type { CdpTarget } from './cdp-controller'

/** The subset of a chokidar watcher this module drives. */
export interface Watcher {
  on(event: 'all', listener: (event: string, path: string) => void): unknown
  close(): Promise<void>
}

export type WatchOptions = {
  /** How deep below the page's folder to look. */
  depth: number
  /** Folders and files to leave alone, as chokidar's `ignored` function. */
  ignored: (path: string) => boolean
}

/** How a watcher is made. `chokidar.watch`, or a fake in tests. */
export type WatchFactory = (root: string, options: WatchOptions) => Watcher

/** The slice of `CDPController` the stylesheet swap uses. */
export interface WatcherCdp {
  evaluate<T>(target: CdpTarget, expression: string): Promise<T | null>
}

export type WatcherDeviceRegistration = { deviceId: string; target: CdpTarget }

/** Same registry shape as the other per-view managers. */
export interface WatcherRegistry {
  registerDevice(registration: WatcherDeviceRegistration): void
  unregisterDevice(deviceId: string): void
}

export type FileWatcherOptions = {
  watch: WatchFactory
  cdp: WatcherCdp
  /** Reload every device — what a change that is not a stylesheet means. */
  reloadAll: () => void
  /** Told whenever the state changes. Coalesced: one call per change, never per file event. */
  onState?: (state: WatcherState) => void
  /** Debounce behind a burst of file events. Injectable for tests. */
  setTimer?: (task: () => void, ms: number) => () => void
  now?: () => number
}

/** How long after the last file event the change is acted on: an editor's save is several. */
export const CHANGE_DEBOUNCE_MS = 100
/** How far below the page's folder neighbours are watched. */
export const WATCH_DEPTH = 3

/** What counts as a neighbour worth reacting to. */
const WATCHED_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs'])
const IGNORED_DIRS = /[\\/](node_modules|\.git)([\\/]|$)/

/** Whether a page url is a local file this module would watch. */
export function watchableFile(url: string | null): string | null {
  if (url === null) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:') return null
  let path: string
  try {
    path = fileURLToPath(parsed)
  } catch {
    return null
  }
  const ext = extname(path).toLowerCase()
  return ext === '.html' || ext === '.htm' ? path : null
}

/** Chokidar's `ignored` for a page's folder. Exported for its unit test. */
export function isIgnored(path: string): boolean {
  return IGNORED_DIRS.test(path)
}

/** Whether one changed path is one the page might depend on. */
export function isWatchedFile(path: string): boolean {
  return WATCHED_EXTENSIONS.has(extname(path).toLowerCase()) && !isIgnored(path)
}

/**
 * The stylesheet swap, as one self-contained expression: every `<link
 * rel="stylesheet">` whose file is among `pathnames` gets a fresh query
 * string, which makes the browser fetch it again without a navigation.
 * Answers with how many it swapped, so a zero can fall back to a reload —
 * a stylesheet reached through `@import` has no link to swap.
 *
 * `pathnames` are the watcher's own paths, embedded as JSON: nothing
 * page-controlled becomes part of the expression.
 */
export function swapExpression(pathnames: readonly string[], stamp: number): string {
  return `(() => {
  const wanted = new Set(${JSON.stringify(pathnames)});
  let swapped = 0;
  for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
    let url;
    try { url = new URL(link.href, document.baseURI); } catch { continue; }
    if (url.protocol !== 'file:' || !wanted.has(decodeURIComponent(url.pathname))) continue;
    url.searchParams.set('respo-reload', '${stamp}');
    link.href = url.href;
    swapped += 1;
  }
  return swapped;
})()`
}

/** A file path as `file:` url pathname — what a page's `link.href` resolves to. */
function pathnameOf(path: string): string {
  return decodeURIComponent(pathToFileURL(path).pathname)
}

const defaultTimer = (task: () => void, ms: number): (() => void) => {
  const handle = setTimeout(task, ms)
  handle.unref?.()
  return () => clearTimeout(handle)
}

export class FileWatcher implements WatcherRegistry {
  private readonly watch: WatchFactory
  private readonly cdp: WatcherCdp
  private readonly reloadAll: () => void
  private readonly onState: ((state: WatcherState) => void) | null
  private readonly setTimer: (task: () => void, ms: number) => () => void
  private readonly now: () => number
  private readonly devices = new Map<string, CdpTarget>()

  private watcher: Watcher | null = null
  private file: string | null = null
  private paused = false
  private lastReloadAt: number | null = null
  private readonly changed = new Set<string>()
  private cancelFlush: (() => void) | null = null
  private disposed = false

  constructor(options: FileWatcherOptions) {
    this.watch = options.watch
    this.cdp = options.cdp
    this.reloadAll = options.reloadAll
    this.onState = options.onState ?? null
    this.setTimer = options.setTimer ?? defaultTimer
    this.now = options.now ?? Date.now
  }

  state(): WatcherState {
    return {
      state: this.file === null ? 'off' : this.paused ? 'paused' : 'watching',
      file: this.file,
      lastReloadAt: this.lastReloadAt
    }
  }

  registerDevice(registration: WatcherDeviceRegistration): void {
    this.devices.set(registration.deviceId, registration.target)
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId)
  }

  /**
   * Follow the canvas: watch the page when it is a local file, stop when it
   * is not. Called with the lead's url on every load batch; a url that has
   * not changed costs a string comparison.
   */
  follow(url: string | null): void {
    if (this.disposed) return
    const file = watchableFile(url)
    if (file === this.file) return
    this.stop()
    if (file === null) {
      this.publish()
      return
    }
    this.paused = false
    this.changed.clear()
    const root = dirname(file)
    let watcher: Watcher
    try {
      watcher = this.watch(root, { depth: WATCH_DEPTH, ignored: isIgnored })
    } catch (error) {
      // Not watchable right now (the module is still loading, or the folder
      // refuses). Stay `off` rather than claim a watch that does not exist —
      // the next load batch calls `follow` again with the same url.
      console.error('watcher: cannot watch', root, error)
      this.file = null
      this.publish()
      return
    }
    this.file = file
    watcher.on('all', (event, path) => this.onEvent(event, path))
    this.watcher = watcher
    this.publish()
  }

  /** Pause or resume. Paused keeps the watcher and ignores what it says. */
  toggle(): WatcherState {
    if (this.file !== null) {
      this.paused = !this.paused
      if (this.paused) this.dropPending()
      this.publish()
    }
    return this.state()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.devices.clear()
  }

  private stop(): void {
    this.dropPending()
    const watcher = this.watcher
    this.watcher = null
    this.file = null
    this.paused = false
    if (watcher !== null) void watcher.close().catch(() => undefined)
  }

  private dropPending(): void {
    this.changed.clear()
    this.cancelFlush?.()
    this.cancelFlush = null
  }

  private onEvent(event: string, path: string): void {
    if (this.disposed || this.paused || this.file === null) return
    if (event !== 'change' && event !== 'add' && event !== 'unlink') return
    const absolute = resolve(path)
    if (!isWatchedFile(absolute)) return
    // The page's own folder is the root, so a path is inside it by
    // construction; the depth is chokidar's to enforce.
    this.changed.add(absolute)
    this.cancelFlush ??= this.setTimer(() => this.flush(), CHANGE_DEBOUNCE_MS)
  }

  private flush(): void {
    this.cancelFlush = null
    if (this.disposed || this.paused || this.file === null) return
    const paths = [...this.changed]
    this.changed.clear()
    if (paths.length === 0) return

    const stylesheetsOnly = paths.every((path) => extname(path).toLowerCase() === '.css')
    this.lastReloadAt = this.now()
    if (!stylesheetsOnly) {
      this.reloadAll()
      this.publish()
      return
    }
    void this.swapStylesheets(paths).then(() => this.publish())
  }

  /**
   * Swap the changed stylesheets in every view, or reload the ones that had
   * no link to swap. Per view, so a page that `@import`s on one device and
   * links on another is still right on both.
   */
  private async swapStylesheets(paths: string[]): Promise<void> {
    const expression = swapExpression(paths.map(pathnameOf), this.lastReloadAt ?? this.now())
    const answers = await Promise.all(
      [...this.devices.values()].map((target) => this.cdp.evaluate<number>(target, expression))
    )
    if (this.disposed) return
    // Any view that could not swap gets the full reload — and the reload is
    // for everyone, because "some devices show the new CSS and some the old"
    // is worse than a flash on all of them.
    if (answers.some((count) => typeof count !== 'number' || count === 0)) this.reloadAll()
  }

  private publish(): void {
    this.onState?.(this.state())
  }
}

/** The production factory: chokidar on the page's folder. */
export async function chokidarFactory(): Promise<WatchFactory> {
  const { watch } = await import('chokidar')
  return (root, options) =>
    watch(root, {
      depth: options.depth,
      ignored: (path) => options.ignored(path),
      ignoreInitial: true,
      // Windows hands out paths with the root's own separators; keep them
      // absolute so the extension and ignore checks see the whole path.
      cwd: undefined
    }) as unknown as Watcher
}

/** The separator, re-exported for tests that build platform paths. */
export const PATH_SEP = sep
