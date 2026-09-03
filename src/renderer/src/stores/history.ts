import { create } from 'zustand'
import type { HistorySuggestion } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The renderer's window onto main's history.
 *
 * Deliberately *not* a copy of it. Main holds two thousand pages and the icons
 * that go with them; the address bar shows eight rows. So this store holds only
 * the answer to the question currently being asked, and asks again — behind a
 * debounce — when the question changes.
 *
 * The debounce is what keeps this inside the no-per-event-IPC rule (CLAUDE.md
 * §4): a keystroke is not a message, a pause in typing is.
 */
export interface HistoryState {
  /** What the last query asked for. Mirrors the address bar's draft. */
  query: string
  /** Main's answer to it, newest first. */
  suggestions: HistorySuggestion[]

  /** Ask, on a debounce. Safe to call on every keystroke. */
  setQuery: (query: string) => void
  /** Ask now — the address bar just took focus and has nothing to show yet. */
  refresh: (query?: string) => void
  /** Drop the answer and cancel a question in flight. The list just closed. */
  reset: () => void
  /** Forget everything main remembers, and stop offering it. */
  clear: () => void
}

/**
 * How long a pause in typing has to be before it becomes a question.
 *
 * Short enough that the list feels attached to the keyboard, long enough that a
 * word typed at speed is one round trip rather than five.
 */
export const SUGGEST_DEBOUNCE_MS = 100

let timer: ReturnType<typeof setTimeout> | null = null
/** Bumped per request, so a slow answer cannot overwrite a newer one. */
let sequence = 0

function cancelPending(): void {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
}

function ask(query: string): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return

  sequence += 1
  const ticket = sequence
  void bridge.invoke('history:query', query).then(
    (suggestions) => {
      // A query that has since been superseded answers to nobody.
      if (ticket !== sequence) return
      useHistory.setState({ suggestions })
    },
    (error: unknown) => {
      console.error('history:query failed', error)
    }
  )
}

export const useHistory = create<HistoryState>((set, get) => ({
  query: '',
  suggestions: [],

  setQuery: (query) => {
    if (get().query !== query) set({ query })
    cancelPending()
    timer = setTimeout(() => {
      timer = null
      ask(query)
    }, SUGGEST_DEBOUNCE_MS)
    // A pending query must never keep a test process alive.
    ;(timer as { unref?: () => void }).unref?.()
  },

  refresh: (query) => {
    const next = query ?? get().query
    if (get().query !== next) set({ query: next })
    cancelPending()
    ask(next)
  },

  reset: () => {
    cancelPending()
    // The ticket moves too: an answer already on its way must not repopulate a
    // list the user just closed.
    sequence += 1
    set({ query: '', suggestions: [] })
  },

  clear: () => {
    cancelPending()
    sequence += 1
    set({ query: '', suggestions: [] })

    const bridge = ipcBridge()
    if (bridge === null) return
    void bridge.invoke('history:clear').catch((error: unknown) => {
      console.error('history:clear failed', error)
    })
  }
}))
