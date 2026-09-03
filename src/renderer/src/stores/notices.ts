import { create } from 'zustand'

/**
 * One line of feedback about something that just happened.
 *
 * The toolbar is where these appear, and that is not a style choice: device
 * pages are native views composited above everything the renderer paints, so a
 * toast floating over the canvas would be behind a device frame as often as
 * not. The toolbar is the only surface Respo actually owns.
 *
 * Screenshots have their own copy of this idea inside `stores/shots`, where the
 * notice is folded out of batch progress. This one is for the gestures that
 * simply happen and are worth acknowledging — a bookmark saved, a site's data
 * cleared — and is deliberately tiny: one notice at a time, newest wins.
 */
export type NoticeTone = 'ok' | 'error'

export type Notice = {
  /** Bumped per notice, so a timer can only ever dismiss its own. */
  id: number
  tone: NoticeTone
  text: string
}

export interface NoticesState {
  notice: Notice | null
  /** Show one line. Replaces whatever was there; takes itself away again. */
  say: (tone: NoticeTone, text: string) => void
  /** Put it away — the timer, or the user. */
  dismiss: (id?: number) => void
}

/** Long enough to read a sentence, short enough to stay out of the way. */
export const NOTICE_MS = 4000
/** A refusal is worth a longer look: it usually names something to do next. */
export const ERROR_NOTICE_MS = 8000

let sequence = 0
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer(): void {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
}

export const useNotices = create<NoticesState>((set, get) => ({
  notice: null,

  say: (tone, text) => {
    clearTimer()
    sequence += 1
    const notice: Notice = { id: sequence, tone, text }
    set({ notice })

    timer = setTimeout(
      () => {
        timer = null
        useNotices.getState().dismiss(notice.id)
      },
      tone === 'error' ? ERROR_NOTICE_MS : NOTICE_MS
    )
    // A pending notice must never keep a test process alive.
    ;(timer as { unref?: () => void }).unref?.()
  },

  dismiss: (id) => {
    const notice = get().notice
    if (notice === null) return
    // A stale timer firing after a newer notice replaced this one must not take
    // the newer one down with it.
    if (id !== undefined && notice.id !== id) return
    clearTimer()
    set({ notice: null })
  }
}))
