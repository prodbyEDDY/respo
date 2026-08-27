import { describe, expect, it, vi } from 'vitest'
import type { LoadStatePayload } from '@shared/ipc'
import { createLoadStateBatcher, type Deferrer } from '../load-state-batcher'

/** A `setImmediate` stand-in the test drives by hand. */
function manualDeferrer(): Deferrer & { run: () => void; pending: () => boolean } {
  let queued: (() => void) | null = null

  return {
    defer(run: () => void) {
      queued = run
      return () => {
        queued = null
      }
    },
    run() {
      const task = queued
      queued = null
      task?.()
    },
    pending: () => queued !== null
  }
}

function payload(deviceId: string, over: Partial<LoadStatePayload> = {}): LoadStatePayload {
  return { deviceId, state: 'loading', url: 'https://example.com/', ...over }
}

describe('load state batcher', () => {
  it('coalesces a burst of reports into one flush', () => {
    const flush = vi.fn<(batch: LoadStatePayload[]) => void>()
    const timer = manualDeferrer()
    const batcher = createLoadStateBatcher(flush, timer)

    batcher.report(payload('a'))
    batcher.report(payload('b'))
    batcher.report(payload('c'))
    expect(flush).not.toHaveBeenCalled()

    timer.run()

    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0]?.[0].map((p) => p.deviceId)).toEqual(['a', 'b', 'c'])
  })

  it('keeps only the last state per device inside one frame', () => {
    const flush = vi.fn<(batch: LoadStatePayload[]) => void>()
    const timer = manualDeferrer()
    const batcher = createLoadStateBatcher(flush, timer)

    batcher.report(payload('a', { state: 'loading' }))
    batcher.report(payload('a', { state: 'ready', title: 'Example' }))
    timer.run()

    expect(flush.mock.calls[0]?.[0]).toEqual([
      { deviceId: 'a', state: 'ready', url: 'https://example.com/', title: 'Example' }
    ])
  })

  it('does not flush when nothing was reported', () => {
    const flush = vi.fn<(batch: LoadStatePayload[]) => void>()
    const timer = manualDeferrer()
    createLoadStateBatcher(flush, timer)

    timer.run()

    expect(flush).not.toHaveBeenCalled()
  })

  it('starts a fresh frame for reports that arrive after a flush', () => {
    const flush = vi.fn<(batch: LoadStatePayload[]) => void>()
    const timer = manualDeferrer()
    const batcher = createLoadStateBatcher(flush, timer)

    batcher.report(payload('a'))
    timer.run()
    batcher.report(payload('a', { state: 'ready' }))
    timer.run()

    expect(flush).toHaveBeenCalledTimes(2)
    expect(flush.mock.calls[1]?.[0][0]?.state).toBe('ready')
  })

  it('cancels a flush that has not happened yet', () => {
    const flush = vi.fn<(batch: LoadStatePayload[]) => void>()
    const timer = manualDeferrer()
    const batcher = createLoadStateBatcher(flush, timer)

    batcher.report(payload('a'))
    batcher.cancel()

    expect(timer.pending()).toBe(false)
    timer.run()
    expect(flush).not.toHaveBeenCalled()
  })
})
