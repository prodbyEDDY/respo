/**
 * Turning a site's declared icon into something the toolbar can draw.
 *
 * Two rules shape this file. **No third-party icon service** — the icon comes
 * from the site itself, over the same session the page was loaded in, or it
 * does not come at all; asking a favicon CDN would tell someone else's server
 * every domain the user visits. And **an icon is a picture, not a payload** —
 * whatever comes back is bounded, checked for an image content type, and turned
 * into a `data:` url before anything renders it, so the renderer never fetches
 * from a page-controlled url of its own.
 */

import { MAX_FAVICON_DATA_URL } from './history'
import type { FaviconFetcher } from './history'

/**
 * Ceiling on the bytes downloaded for one icon.
 *
 * Base64 costs a third on top, so this is the size that keeps the encoded url
 * inside `MAX_FAVICON_DATA_URL`. Most real favicons are a few kilobytes; the
 * ones that are not are usually a mistake on the site's side, and skipping them
 * costs a picture, not a feature.
 */
export const MAX_FAVICON_BYTES = Math.floor((MAX_FAVICON_DATA_URL / 4) * 3) - 64

/** Image types worth rendering. `svg` is deliberately absent — see below. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon'
])

/**
 * Encode a downloaded icon, or refuse it.
 *
 * SVG is excluded on purpose: an SVG is a document — it can carry script and
 * external references — and this one comes from a page Respo does not control
 * and would be rendered inside Respo's own chrome. Every other format here is
 * inert raster data. Anything unrecognised, empty or oversized is refused
 * rather than guessed at.
 *
 * Exported for its unit test; production code reaches it through the fetcher.
 */
export function encodeFavicon(contentType: string | null, bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FAVICON_BYTES) return null

  // `image/png; charset=binary` — the parameters are not part of the type.
  const type = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!IMAGE_TYPES.has(type)) return null

  const encoded = Buffer.from(bytes).toString('base64')
  const dataUrl = `data:${type};base64,${encoded}`
  return dataUrl.length > MAX_FAVICON_DATA_URL ? null : dataUrl
}

/** The slice of `Session.fetch` this module needs. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

/**
 * Build the fetcher `History` downloads icons with.
 *
 * `fetch` is passed in — in production it is the *device session's* own fetch,
 * so the request rides the same cookie jar, cache and proxy the page did, and
 * nothing about it is a second identity for the user.
 */
export function createFaviconFetcher(fetch: FetchLike): FaviconFetcher {
  return async (iconUrl: string): Promise<string | null> => {
    try {
      const response = await fetch(iconUrl)
      if (!response.ok) return null

      // Checked before the body is read: a server that announces a hundred
      // megabytes must not get us to allocate them to find that out.
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_FAVICON_BYTES) return null

      const buffer = await response.arrayBuffer()
      return encodeFavicon(response.headers.get('content-type'), new Uint8Array(buffer))
    } catch {
      // A site that will not serve its own icon is not an error worth a log
      // line per navigation.
      return null
    }
  }
}
