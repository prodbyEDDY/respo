import { describe, expect, it, vi } from 'vitest'
import { createRafBatcher, type FrameScheduler } from '../raf-batch'

/** Deterministic stand-in for `requestAnimationFrame`. */
function fakeFrames(): FrameScheduler & { flush: () => void; pending: () => number } {
  const callbacks = new Map<number, () => void>()
  let nextId = 1

  return {
    request(callback) {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    },
    cancel(id) {
      callbacks.delete(id)
    },
    flush() {
      const due = [...callbacks.values()]
      callbacks.clear()
      for (const callback of due) callback()
    },
    pending: () => callbacks.size
  }
}

describe('createRafBatcher', () => {
  it('collapses a burst of synchronous requests into one run per frame', () => {
    const frames = fakeFrames()
    const run = vi.fn()
    const batcher = createRafBatcher(run, frames)

    // What a trackpad flick looks like: many scroll events inside one frame.
    for (let i = 0; i < 50; i += 1) batcher.schedule()

    expect(frames.pending()).toBe(1)
    expect(run).not.toHaveBeenCalled()

    frames.flush()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs once per frame across consecutive frames', () => {
    const frames = fakeFrames()
    const run = vi.fn()
    const batcher = createRafBatcher(run, frames)

    for (let frame = 0; frame < 3; frame += 1) {
      batcher.schedule()
      batcher.schedule()
      frames.flush()
    }

    expect(run).toHaveBeenCalledTimes(3)
  })

  it('does not run again on an idle frame', () => {
    const frames = fakeFrames()
    const run = vi.fn()
    const batcher = createRafBatcher(run, frames)

    batcher.schedule()
    frames.flush()
    frames.flush()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('lets the callback ask for the next frame without dropping it', () => {
    const frames = fakeFrames()
    const run = vi.fn(() => {
      if (run.mock.calls.length < 2) batcher.schedule()
    })
    const batcher = createRafBatcher(run, frames)

    batcher.schedule()
    frames.flush()
    expect(frames.pending()).toBe(1)

    frames.flush()
    expect(run).toHaveBeenCalledTimes(2)
    expect(frames.pending()).toBe(0)
  })

  it('cancels a frame that has not fired yet', () => {
    const frames = fakeFrames()
    const run = vi.fn()
    const batcher = createRafBatcher(run, frames)

    batcher.schedule()
    batcher.cancel()
    frames.flush()

    expect(run).not.toHaveBeenCalled()
    expect(frames.pending()).toBe(0)
  })

  it('stays usable after a cancel', () => {
    const frames = fakeFrames()
    const run = vi.fn()
    const batcher = createRafBatcher(run, frames)

    batcher.cancel()
    batcher.schedule()
    frames.flush()

    expect(run).toHaveBeenCalledTimes(1)
  })
})
