/**
 * Forgetting a site: storage, cookies, cache.
 *
 * The whole point of this module living in main is *whose* data gets deleted.
 * The renderer asks for a kind — "cookies" — and never for an origin: main is
 * the side that knows what the device views are actually showing, and an origin
 * taken from a renderer payload would be a compromised renderer choosing any
 * site on the machine to wipe. So the origin is derived here, from the url the
 * views are on, and a request that has no site behind it is answered with
 * `no-origin` rather than with the whole partition being emptied.
 *
 * Electron is behind an interface for the usual reason: the branching — which
 * storages a target names, when there is an origin to act on — is the part that
 * has to be right, and it should be testable without a browser process.
 */

import type { ClearResult, ClearTarget } from '@shared/ipc'

/**
 * The storage kinds `Session.clearStorageData` accepts, as of Electron 44.
 * Restated here rather than imported: it is a string union in Electron's types,
 * and the point of this module is to be reachable without them.
 */
export type StorageKind =
  | 'cookies'
  | 'filesystem'
  | 'indexdb'
  | 'localstorage'
  | 'shadercache'
  | 'serviceworkers'
  | 'cachestorage'

/** The slice of an Electron `Session` a clear needs. */
export interface ClearableSession {
  clearStorageData(options: { origin?: string; storages?: StorageKind[] }): Promise<void>
  clearCache(): Promise<void>
}

/**
 * Everything a site can keep *except* its cookies.
 *
 * Split from cookies deliberately: "clear storage" is what a developer reaches
 * for twenty times an hour while working on a feature, and having it sign them
 * out every time would make it a tool nobody uses. Cookies are their own item
 * for the times signing out is the point.
 */
export const SITE_STORAGES: readonly StorageKind[] = [
  'localstorage',
  'indexdb',
  'filesystem',
  'serviceworkers',
  'cachestorage'
]

/** The one Chromium calls a cookie. */
export const COOKIE_STORAGES: readonly StorageKind[] = ['cookies']

/**
 * Which storages one target names, or `null` when it names none.
 *
 * `cache` is the `null` case and not an empty list: the HTTP cache is not a
 * per-origin storage at all, it is the session's, and it is emptied through
 * `clearCache` instead.
 */
export function storagesFor(target: ClearTarget): StorageKind[] | null {
  switch (target) {
    case 'storage':
      return [...SITE_STORAGES]
    case 'cookies':
      return [...COOKIE_STORAGES]
    case 'all':
      return [...SITE_STORAGES, ...COOKIE_STORAGES]
    case 'cache':
      return null
  }
}

/** Whether this target also empties the session's HTTP cache. */
export function clearsCache(target: ClearTarget): boolean {
  return target === 'cache' || target === 'all'
}

/**
 * The origin a clear would act on, or `null` when there is no site here.
 *
 * Only `http(s)` pages have one worth acting on. A `file:` page has no origin
 * in any useful sense — Chromium reports the string `"null"` — and a canvas
 * that has not navigated anywhere yet has no page at all.
 */
export function clearableOrigin(url: string | null): string | null {
  if (url === null || url === '') return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin === 'null' ? null : parsed.origin
  } catch {
    return null
  }
}

/**
 * Clear what `target` names for the site `currentUrl` is on.
 *
 * Nothing partial ever happens: a target that needs an origin and has none
 * touches nothing at all and says so, rather than falling back to emptying the
 * partition — "clear this site" quietly becoming "clear every site" is exactly
 * the kind of surprise a destructive action must not have.
 */
export async function clearBrowsingData(
  session: ClearableSession,
  target: ClearTarget,
  currentUrl: string | null
): Promise<ClearResult> {
  const storages = storagesFor(target)
  const origin = clearableOrigin(currentUrl)
  if (storages !== null && origin === null) return { ok: false, reason: 'no-origin' }

  try {
    if (storages !== null && origin !== null) {
      await session.clearStorageData({ origin, storages })
    }
    if (clearsCache(target)) await session.clearCache()
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : String(error)
    }
  }

  return { ok: true, target, origin }
}
