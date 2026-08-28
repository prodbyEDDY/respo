import type { LoadStatePayload } from '@shared/ipc'

/**
 * Deferral primitive behind the coalescing. Injectable so the batching logic is
 * testable without real timers; the default is `setImmediate`, which fires
 * after the current turn of the event loop and before any I/O callback.
 */
export type Deferrer = {
  /** Run `task` once the current turn drains. Returns a canceller. */
  defer(task: () => void): () => void
}

/** The default: coalesce to one flush per turn of the event loop. */
export const immediateDeferrer: Deferrer = {
  defer(task) {
    const handle = setImmediate(task)
    return () => {
      clearImmediate(handle)
    }
  }
}

export type LoadStateBatcher = {
  /** Record one device's newest state. Cheap; sends nothing by itself. */
  report(payload: LoadStatePayload): void
  /** Drop a flush that has not happened yet (the window is going away). */
  cancel(): void
}

/**
 * Collapses the load events of every device view into one IPC message per turn.
 *
 * Five views loading a page produce a stream of start/finish/title events; the
 * rule (CLAUDE.md §4) is that none of them may become its own IPC message. The
 * batcher keeps the *latest* state per device and flushes the whole set once,
 * so a five-device navigation costs one `load-state` event, not fifteen.
 */
export function createLoadStateBatcher(
  flush: (batch: LoadStatePayload[]) => void,
  deferrer: Deferrer = immediateDeferrer
): LoadStateBatcher {
  // Insertion-ordered: devices reach the renderer in the order they spoke up.
  const pending = new Map<string, LoadStatePayload>()
  let cancelFlush: (() => void) | null = null

  const run = (): void => {
    cancelFlush = null
    if (pending.size === 0) return

    const batch = [...pending.values()]
    pending.clear()
    flush(batch)
  }

  return {
    report(payload): void {
      pending.set(payload.deviceId, payload)
      cancelFlush ??= deferrer.defer(run)
    },

    cancel(): void {
      pending.clear()
      cancelFlush?.()
      cancelFlush = null
    }
  }
}
