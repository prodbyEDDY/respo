import { create } from 'zustand'
import { normalizeUrl } from '@shared/ipc'
import {
  MAX_BOOKMARKS,
  MAX_TITLE_LENGTH,
  type Bookmark,
  type PersistedState
} from '@shared/persistence-types'
import { savePersistedState } from '@renderer/lib/persistence'

/**
 * The pages the user keeps: their bookmarks, and the one they call home.
 *
 * Both live in the same store because they are the same kind of thing — a url
 * the user chose to keep — and because they are persisted in the same patch.
 * Unlike history, which is main's (it is large and written constantly), this is
 * a short list of the user's own decisions: it belongs in the settings document
 * with everything else they chose.
 *
 * Every url that comes in is normalized on the way, which is what makes
 * "is this page bookmarked?" a string comparison against the address bar rather
 * than a fuzzy match: both sides went through `normalizeUrl`.
 */
export interface BookmarksState {
  /** Saved pages, newest first. */
  items: Bookmark[]
  /** The page every session opens on, or `''` for none. */
  homeUrl: string

  /**
   * Save a page. Answers with the bookmark — the existing one when the page was
   * already saved, so the star can open its editor either way.
   */
  add: (url: string, title: string) => Bookmark | null
  /**
   * Save or unsave, in one gesture. Answers with what it did, so the caller can
   * say so; `null` means the url was not one worth saving.
   */
  toggle: (url: string, title: string) => 'added' | 'removed' | null
  /** Edit a saved page. A url that is not loadable is refused, not stored. */
  update: (id: string, patch: { title?: string; url?: string }) => void
  remove: (id: string) => void

  /** Make `url` the home page, or `''` to have none. */
  setHome: (url: string) => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (state: Pick<PersistedState, 'bookmarks' | 'homeUrl'>) => void
}

/**
 * A stable id for a new bookmark.
 *
 * Both of the other fields are editable, so neither can identify a row: a user
 * fixing a typo in a url must not have the list treat it as a different
 * bookmark. The counter is what keeps two saves inside the same millisecond
 * apart.
 */
let sequence = 0
function makeBookmarkId(): string {
  sequence += 1
  return `bm-${Date.now().toString(36)}-${sequence.toString(36)}`
}

/** Write the whole slice back. Main merges and debounces (CLAUDE.md §7). */
function persist(state: Pick<BookmarksState, 'items' | 'homeUrl'>): void {
  savePersistedState({ bookmarks: state.items, homeUrl: state.homeUrl })
}

export const useBookmarks = create<BookmarksState>((set, get) => ({
  items: [],
  homeUrl: '',

  add: (input, title) => {
    const url = normalizeUrl(input)
    if (url === null) return null

    const existing = get().items.find((item) => item.url === url)
    if (existing !== undefined) return existing

    const bookmark: Bookmark = {
      id: makeBookmarkId(),
      title: title.slice(0, MAX_TITLE_LENGTH),
      url,
      addedAt: Date.now()
    }
    // Newest first, and bounded: the list is a way back to pages, not an
    // archive, and the menu it feeds shows a handful of them.
    const items = [bookmark, ...get().items].slice(0, MAX_BOOKMARKS)
    set({ items })
    persist({ items, homeUrl: get().homeUrl })
    return bookmark
  },

  toggle: (input, title) => {
    const url = normalizeUrl(input)
    if (url === null) return null

    const existing = get().items.find((item) => item.url === url)
    if (existing === undefined) {
      get().add(url, title)
      return 'added'
    }
    get().remove(existing.id)
    return 'removed'
  },

  update: (id, patch) => {
    const url = patch.url === undefined ? undefined : normalizeUrl(patch.url)
    // An unloadable url is not an edit, it is a typo mid-sentence: the rest of
    // the patch still lands, and the url keeps its last good value.
    const items = get().items.map((item) =>
      item.id === id
        ? {
            ...item,
            ...(patch.title === undefined ? {} : { title: patch.title.slice(0, MAX_TITLE_LENGTH) }),
            ...(url === null || url === undefined ? {} : { url })
          }
        : item
    )
    set({ items })
    persist({ items, homeUrl: get().homeUrl })
  },

  remove: (id) => {
    const items = get().items.filter((item) => item.id !== id)
    if (items.length === get().items.length) return
    set({ items })
    persist({ items, homeUrl: get().homeUrl })
  },

  setHome: (input) => {
    const homeUrl = input === '' ? '' : (normalizeUrl(input) ?? '')
    if (homeUrl === '' && input !== '') return
    if (get().homeUrl === homeUrl) return
    set({ homeUrl })
    persist({ items: get().items, homeUrl })
  },

  hydrate: (state) => {
    set({ items: [...state.bookmarks], homeUrl: state.homeUrl })
  }
}))

/**
 * The bookmark saved for this exact url, or `null`.
 *
 * Takes the state and a url rather than being a curried selector: a selector
 * that built a closure per render would be a new function every time, and one
 * that returned a fresh object would re-render forever (React error #185).
 * Components hold `items` and derive through `useMemo`.
 */
export function selectBookmarkFor(state: BookmarksState, url: string): Bookmark | null {
  return state.items.find((item) => item.url === url) ?? null
}
