import type { HistorySuggestion } from '@shared/ipc'
import type { Bookmark } from '@shared/persistence-types'
import type { AddressSuggestion } from '@renderer/components/toolbar/AddressSuggestions'

/** How many rows the address bar offers at once. Matches main's own cap. */
export const MAX_ADDRESS_SUGGESTIONS = 8

/**
 * How many of those rows bookmarks may take.
 *
 * A ceiling and not a share: bookmarks are the user's own decisions and belong
 * at the top, but a list of forty saved pages must not push out the page they
 * were on five minutes ago, which is what they are usually reaching for.
 */
export const MAX_BOOKMARK_SUGGESTIONS = 3

function matches(needle: string, ...fields: string[]): boolean {
  if (needle === '') return true
  return fields.some((field) => field.toLowerCase().includes(needle))
}

/**
 * Build the list under the address bar out of what the user kept and where
 * they have been.
 *
 * Bookmarks are filtered here rather than in main because they are already in
 * the renderer — they are part of the settings document — and a round trip to
 * filter forty strings would be a round trip to avoid work that is cheaper than
 * the message announcing it. History is filtered in main, where it lives; this
 * only merges what came back.
 *
 * A url that is both saved and visited appears once, as a bookmark: the star is
 * the more useful thing to know about it.
 */
export function mergeSuggestions(
  query: string,
  bookmarks: readonly Bookmark[],
  history: readonly HistorySuggestion[],
  limit = MAX_ADDRESS_SUGGESTIONS
): AddressSuggestion[] {
  const needle = query.trim().toLowerCase()
  const out: AddressSuggestion[] = []
  const seen = new Set<string>()

  for (const bookmark of bookmarks) {
    if (out.length >= MAX_BOOKMARK_SUGGESTIONS || out.length >= limit) break
    if (!matches(needle, bookmark.url, bookmark.title)) continue
    if (seen.has(bookmark.url)) continue
    seen.add(bookmark.url)
    out.push({ kind: 'bookmark', url: bookmark.url, title: bookmark.title })
  }

  for (const entry of history) {
    if (out.length >= limit) break
    if (seen.has(entry.url)) continue
    seen.add(entry.url)
    out.push({
      kind: 'history',
      url: entry.url,
      title: entry.title,
      ...(entry.favicon === undefined ? {} : { favicon: entry.favicon })
    })
  }

  return out
}
