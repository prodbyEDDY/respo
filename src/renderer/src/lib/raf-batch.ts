/** Injectable `requestAnimationFrame` pair, so batching is testable. */
export type FrameScheduler = {
  request(callback: () => void): number
  cancel(handle: number): void
}

export type RafBatcher = {
  /** Ask for a run on the next frame. Repeat calls inside a frame are free. */
  schedule(): void
  /** Drop a run that has not happened yet. */
  cancel(): void
}

const domFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle)
  }
}

/**
 * Coalesce any number of requests into one call per animation frame.
 *
 * This is the mechanism behind the "no per-event IPC" rule (CLAUDE.md §4): a
 * trackpad can fire dozens of scroll events per frame, and every one of them
 * must collapse into a single `views:set-layout`.
 */
export function createRafBatcher(run: () => void, frames: FrameScheduler = domFrames): RafBatcher {
  let handle: number | null = null

  const tick = (): void => {
    // Cleared before `run` so the callback may schedule the next frame itself.
    handle = null
    run()
  }

  return {
    schedule(): void {
      if (handle !== null) return
      handle = frames.request(tick)
    },
    cancel(): void {
      if (handle === null) return
      frames.cancel(handle)
      handle = null
    }
  }
}
