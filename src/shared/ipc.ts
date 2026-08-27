/**
 * The single source of truth for every IPC channel in Respo.
 *
 * Rules (CLAUDE.md §6): no channel exists outside this module, main validates
 * everything it receives, and there is no per-event traffic — main -> renderer
 * updates travel batched over the one `MAIN_EVENT_CHANNEL`.
 */

/** Placement of one device view on the canvas, in renderer CSS pixels. */
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
  'views:set-layout': { args: [ViewRect[]]; result: void }
  'nav:navigate': { args: [string]; result: void }
  'theme:set-source': { args: [ThemeSource]; result: void }
}

export type IpcChannel = keyof IpcInvokeMap

/**
 * Runtime mirror of `IpcInvokeMap`. Typed as a total `Record`, so adding a
 * channel to the map without listing it here is a compile error.
 */
const CHANNEL_REGISTRY: Record<IpcChannel, true> = {
  'app:get-version': true,
  'views:set-layout': true,
  'nav:navigate': true,
  'theme:set-source': true
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
