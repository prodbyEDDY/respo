/**
 * The single source of truth for every IPC channel in Respo.
 *
 * Rules (CLAUDE.md §6): no channel exists outside this module, main validates
 * everything it receives, and there is no per-event traffic — main -> renderer
 * updates travel batched over the one `MAIN_EVENT_CHANNEL`.
 */

import type { PersistedState } from './persistence-types'
import type { DeviceSpec, Rect } from './types'

/**
 * Placement of one device view on the canvas, in renderer CSS pixels relative
 * to the window's content area (i.e. straight out of `getBoundingClientRect`).
 *
 * `width`/`height` are the *on-screen* size — the device viewport already
 * multiplied by `zoom`. Main restores the logical viewport with
 * `webContents.setZoomFactor(zoom)`.
 */
export type ViewRect = {
  deviceId: string
  x: number
  y: number
  width: number
  height: number
  zoom: number
}

/** Mirrors Electron's `nativeTheme.themeSource`. */
export type ThemeSource = 'light' | 'dark' | 'system'

export type LoadState = 'loading' | 'ready' | 'failed'

export type LoadStatePayload = {
  deviceId: string
  state: LoadState
  url: string
  title?: string
  errorCode?: number
  errorDesc?: string
}

/** Batched main -> renderer notification. One message carries many devices. */
export type MainEvent = { type: 'load-state'; payload: LoadStatePayload[] }

/** renderer -> main request/response channels. Extended by later tasks. */
export type IpcInvokeMap = {
  'app:get-version': { args: []; result: string }
  /**
   * The url the session opens on: a CLI/deep-link argument when there is one,
   * otherwise the built-in default. Already normalized by main.
   */
  'app:get-start-url': { args: []; result: string }
  /**
   * Sent at most once per animation frame. The trailing `Rect` is the canvas
   * viewport in window CSS pixels: views are positioned relative to it and
   * culled against it.
   */
  'views:set-layout': { args: [ViewRect[], Rect]; result: void }
  'views:sync-devices': { args: [DeviceSpec[]]; result: void }
  'nav:navigate': { args: [string]; result: void }
  /**
   * History and reload act on every view at once: Respo drives one page across
   * many viewports, so there is no per-device history to steer.
   */
  'nav:back': { args: []; result: void }
  'nav:forward': { args: []; result: void }
  'nav:reload': { args: []; result: void }
  'theme:set-source': { args: [ThemeSource]; result: void }
  /** Read the whole persisted document, already migrated and repaired by main. */
  'store:load': { args: []; result: PersistedState }
  /**
   * Post a partial update. Main merges it onto the document it holds and writes
   * behind a debounce — the renderer never touches disk (CLAUDE.md §7).
   */
  'store:save': { args: [Partial<PersistedState>]; result: void }
}

export type IpcChannel = keyof IpcInvokeMap

/**
 * Runtime mirror of `IpcInvokeMap`. Typed as a total `Record`, so adding a
 * channel to the map without listing it here is a compile error.
 */
const CHANNEL_REGISTRY: Record<IpcChannel, true> = {
  'app:get-version': true,
  'app:get-start-url': true,
  'views:set-layout': true,
  'views:sync-devices': true,
  'nav:navigate': true,
  'nav:back': true,
  'nav:forward': true,
  'nav:reload': true,
  'theme:set-source': true,
  'store:load': true,
  'store:save': true
}

export const IPC_CHANNELS: readonly IpcChannel[] = Object.keys(CHANNEL_REGISTRY) as IpcChannel[]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHANNEL_REGISTRY, value)
}

/** The only main -> renderer channel. Deliberately not part of the invoke map. */
export const MAIN_EVENT_CHANNEL = 'respo:main-event'

/** Shape exposed to the renderer as `window.respo`. */
export interface RespoApi {
  invoke<K extends IpcChannel>(
    channel: K,
    ...args: IpcInvokeMap[K]['args']
  ): Promise<IpcInvokeMap[K]['result']>
  onMainEvent(callback: (event: MainEvent) => void): () => void
}

/** Schemes a device view is ever allowed to load (spec §7a). */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'file:'])

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i
/** `host:1234` — a bare authority, not a scheme, despite the colon. */
const HOST_PORT_RE = /^[^\s/?#:]+:\d+(?:[/?#]|$)/

function isLoopbackHost(input: string): boolean {
  const host = input.split(/[/?#]/, 1)[0]?.split(':', 1)[0]?.toLowerCase() ?? ''
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  )
}

function parseAllowed(candidate: string): string | null {
  try {
    const url = new URL(candidate)
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
    // `file:` is legitimately host-less; anything else without a host is junk.
    if (url.protocol !== 'file:' && url.hostname === '') return null
    return url.href
  } catch {
    return null
  }
}

/**
 * Turn user input (address bar, deep link, CLI, drag & drop) into a URL safe to
 * hand to a view, or `null` when it is not loadable.
 *
 * - bare hosts get `https://`, loopback hosts get `http://`
 * - an explicit `http:`/`https:`/`file:` scheme is preserved
 * - every other scheme (`javascript:`, `data:`, `about:`, ...) is rejected
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  const scheme = SCHEME_RE.exec(trimmed)
  if (scheme !== null && !HOST_PORT_RE.test(trimmed)) {
    if (!ALLOWED_PROTOCOLS.has(`${scheme[1]?.toLowerCase()}:`)) return null
    return parseAllowed(trimmed)
  }

  const authority = trimmed.replace(/^\/+/, '')
  if (authority === '') return null
  return parseAllowed(`${isLoopbackHost(authority) ? 'http' : 'https'}://${authority}`)
}
