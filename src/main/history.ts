/**
 * Where Respo remembers the pages it has been.
 *
 * History lives in main and not in a store slice, for three reasons that all
 * point the same way: it is *large* (two thousand entries), it is *written
 * constantly* (every navigation of every session), and it carries icons that
 * are bytes rather than settings. Handing all of that to the renderer at boot —
 * the way the settings document is handed over — would put a megabyte through
 * the bridge to answer a question the address bar asks eight rows at a time.
 *
 * So the renderer asks (`history:query`) and main answers with the few rows
 * that match. Nothing here touches Electron: the store is behind the same
 * `PersistenceBackend` seam the settings document uses, and downloading a
 * favicon is a function passed in, so all of this is unit-testable without a
 * browser process.
 */

import type { HistorySuggestion } from '@shared/ipc'
import { MAX_TITLE_LENGTH, MAX_URL_LENGTH } from '@shared/persistence-types'
import type { PersistenceBackend } from './persistence'

/** The store key the visited pages live under, beside `state`. */
export const HISTORY_KEY = 'history'

/** How many pages are remembered. Oldest fall off the end (spec §5.3). */
export const HISTORY_CAP = 2000

/** How many rows one query may answer with. The address bar shows a few. */
export const MAX_SUGGESTIONS = 8

/**
 * How many origins keep an icon.
 *
 * Icons are cached per *origin*, not per page: one site's thousand pages share
 * one 16×16 image, and keying by page would store it a thousand times. The cap
 * is what keeps this file a settings file — sixty-four icons at the size limit
 * below is well under a megabyte, and the suggestion list only ever shows a
 * handful of sites at once.
 */
export const FAVICON_CACHE_CAP = 64

/**
 * Ceiling on one cached icon, as the length of its `data:` url.
 *
 * Deliberately tight: these travel back over IPC with every keystroke's worth
 * of suggestions, so an icon is only worth caching while it is small enough to
 * be cheaper than not having it.
 */
export const MAX_FAVICON_DATA_URL = 8 * 1024

/** Long enough to swallow a burst of navigations, short enough to survive a crash. */
export const HISTORY_DEBOUNCE_MS = 1000

/** One visited page. */
export type HistoryEntry = {
  url: string
  title: string
  /** Epoch milliseconds of the most recent visit. */
  ts: number
}

/**
 * Download a site's icon and return it as a `data:` url, or `null`.
 *
 * Injected rather than imported so this module stays free of Electron — and so
 * a test can decide what a fetch returns without a network.
 */
export type FaviconFetcher = (iconUrl: string) => Promise<string | null>

export type History = {
  /** Note a visit. Repeats of the newest page update it rather than pile up. */
  record(url: string, title: string): void
  /**
   * Note the icons a page just declared. Downloads at most one, once per
   * origin; anything already known is free.
   */
  noteFavicon(pageUrl: string, iconUrls: readonly string[]): void
  /** The most recent pages matching `query`, newest first. */
  query(query: string, limit?: number): HistorySuggestion[]
  /** Forget every page, and every icon cached alongside them. */
  clear(): void
  /** Write anything pending right now — the app is going away. */
  flush(): void
  dispose(): void
}

export type HistoryOptions = {
  now?: () => number
  fetchFavicon?: FaviconFetcher
  debounceMs?: number
  cap?: number
}

/** Schemes a visited page may have. The same three a view may load (spec §7a). */
const RECORDABLE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'file:'])
/** Schemes an icon may be downloaded over. A `data:` icon is already one. */
const ICON_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * The origin an icon is cached under, or `null` when there is none to speak of.
 *
 * `file:` pages have no origin — `new URL('file:///a').origin` is the string
 * `"null"` — and giving every local file one shared icon would be wrong, so
 * they simply never carry one.
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!ICON_PROTOCOLS.has(parsed.protocol)) return null
    return parsed.origin === 'null' ? null : parsed.origin
  } catch {
    return null
  }
}

type Document = {
  entries: HistoryEntry[]
  /** Icon `data:` urls by origin, oldest first (insertion order). */
  favicons: Record<string, string>
}

function emptyDocument(): Document {
  return { entries: [], favicons: {} }
}

/** Repair whatever is on disk. A junk entry costs its own row and nothing else. */
export function sanitizeHistory(raw: unknown, cap = HISTORY_CAP): Document {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyDocument()
  const doc = raw as Record<string, unknown>

  const entries: HistoryEntry[] = []
  const rawEntries = Array.isArray(doc['entries']) ? doc['entries'] : []
  for (const entry of rawEntries.slice(0, cap)) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const url = row['url']
    if (typeof url !== 'string' || url === '' || url.length > MAX_URL_LENGTH) continue
    if (originOf(url) === null && !url.startsWith('file:')) continue

    const title = row['title']
    const ts = row['ts']
    entries.push({
      url,
      title: typeof title === 'string' ? title.slice(0, MAX_TITLE_LENGTH) : '',
      ts: typeof ts === 'number' && Number.isFinite(ts) && ts >= 0 ? ts : 0
    })
  }

  const favicons: Record<string, string> = {}
  const rawIcons = doc['favicons']
  if (typeof rawIcons === 'object' && rawIcons !== null && !Array.isArray(rawIcons)) {
    for (const [origin, icon] of Object.entries(rawIcons).slice(0, FAVICON_CACHE_CAP)) {
      if (typeof icon !== 'string' || !icon.startsWith('data:image/')) continue
      if (icon.length > MAX_FAVICON_DATA_URL) continue
      favicons[origin] = icon
    }
  }

  return { entries, favicons }
}

/**
 * Open the history store.
 *
 * Writes are debounced the same way the settings document's are, and for the
 * same reason: a five-device navigation is one recorded page, but a session is
 * hundreds of them, and each one must not be a file write.
 */
export function createHistory(backend: PersistenceBackend, options: HistoryOptions = {}): History {
  const now = options.now ?? Date.now
  const fetchFavicon = options.fetchFavicon ?? null
  const debounceMs = options.debounceMs ?? HISTORY_DEBOUNCE_MS
  const cap = options.cap ?? HISTORY_CAP

  let doc: Document | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  let disposed = false
  /** Origins with a download in flight; a second page must not start another. */
  const fetching = new Set<string>()

  const read = (): Document => {
    if (doc !== null) return doc
    let raw: unknown
    try {
      raw = backend.get(HISTORY_KEY)
    } catch (error) {
      console.error('history: failed to read', error)
      raw = undefined
    }
    doc = sanitizeHistory(raw, cap)
    return doc
  }

  const writeNow = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!dirty) return
    dirty = false
    try {
      backend.set(HISTORY_KEY, doc ?? emptyDocument())
    } catch (error) {
      // A store we cannot write to is a degraded session, not a dead app.
      console.error('history: failed to write', error)
    }
  }

  const touch = (): void => {
    if (disposed) return
    dirty = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(writeNow, debounceMs)
    // A pending write must never keep the process alive on its own.
    timer.unref?.()
  }

  return {
    record(url, title): void {
      if (disposed) return
      if (url === '' || url.length > MAX_URL_LENGTH) return
      let protocol: string
      try {
        protocol = new URL(url).protocol
      } catch {
        return
      }
      if (!RECORDABLE_PROTOCOLS.has(protocol)) return

      const state = read()
      const clipped = title.slice(0, MAX_TITLE_LENGTH)
      const newest = state.entries[0]

      // Reloading a page, or its title arriving after its url did, is the same
      // visit — not a second one. Only a *different* newest page is a new row.
      if (newest !== undefined && newest.url === url) {
        // An empty title is "not known yet", never "the title is now blank":
        // the load event that carries the url arrives before the one that
        // carries the `<title>`, and the second must not erase the first.
        if (clipped !== '') newest.title = clipped
        newest.ts = now()
        touch()
        return
      }

      state.entries.unshift({ url, title: clipped, ts: now() })
      if (state.entries.length > cap) state.entries.length = cap
      touch()
    },

    noteFavicon(pageUrl, iconUrls): void {
      if (disposed || fetchFavicon === null) return
      const origin = originOf(pageUrl)
      if (origin === null) return

      const state = read()
      if (state.favicons[origin] !== undefined || fetching.has(origin)) return

      const icon = iconUrls.find((candidate) => {
        try {
          return ICON_PROTOCOLS.has(new URL(candidate).protocol)
        } catch {
          return false
        }
      })
      if (icon === undefined) return

      fetching.add(origin)
      void fetchFavicon(icon)
        .then((dataUrl) => {
          if (disposed || dataUrl === null) return
          if (!dataUrl.startsWith('data:image/') || dataUrl.length > MAX_FAVICON_DATA_URL) return

          const current = read()
          current.favicons[origin] = dataUrl
          // Insertion-ordered, so the oldest key is the first one. A Map would
          // say this more plainly, but the document is JSON on the way out.
          const origins = Object.keys(current.favicons)
          for (const stale of origins.slice(0, Math.max(0, origins.length - FAVICON_CACHE_CAP))) {
            delete current.favicons[stale]
          }
          touch()
        })
        .catch(() => undefined)
        .finally(() => {
          fetching.delete(origin)
        })
    },

    query(query, limit = MAX_SUGGESTIONS): HistorySuggestion[] {
      const state = read()
      const needle = query.trim().toLowerCase()
      const wanted = Math.max(0, Math.min(limit, MAX_SUGGESTIONS))
      if (wanted === 0) return []

      const out: HistorySuggestion[] = []
      const seen = new Set<string>()
      // Newest first by construction, so the first match for a url is the one
      // worth showing and no sort is needed.
      for (const entry of state.entries) {
        if (seen.has(entry.url)) continue
        if (
          needle !== '' &&
          !entry.url.toLowerCase().includes(needle) &&
          !entry.title.toLowerCase().includes(needle)
        ) {
          continue
        }

        seen.add(entry.url)
        const origin = originOf(entry.url)
        const favicon = origin === null ? undefined : state.favicons[origin]
        out.push({
          url: entry.url,
          title: entry.title,
          ts: entry.ts,
          ...(favicon === undefined ? {} : { favicon })
        })
        if (out.length >= wanted) break
      }
      return out
    },

    clear(): void {
      doc = emptyDocument()
      dirty = true
      // Not debounced: "forget where I have been" is a promise, and a promise
      // that is still sitting in a timer when the process dies was not kept.
      writeNow()
    },

    flush: writeNow,

    dispose(): void {
      if (disposed) return
      writeNow()
      disposed = true
    }
  }
}
