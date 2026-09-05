import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewRect } from '@shared/ipc'
import type { Rect } from '@shared/types'
import { createLayoutSync, type LayoutSync } from '../layout-sync'
import type { FrameScheduler } from '../raf-batch'

type Frames = FrameScheduler & { flush: () => void; pending: () => number }

function fakeFrames(): Frames {
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

function boxed(element: HTMLElement, x: number, y: number, width: number, height: number): void {
  Object.defineProperties(element, {
    clientWidth: { value: width, configurable: true },
    clientHeight: { value: height, configurable: true }
  })
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }) as DOMRect
}

describe('createLayoutSync', () => {
  let frames: Frames
  let send: ReturnType<typeof vi.fn>
  let sync: LayoutSync
  let container: HTMLElement
  let frame: HTMLElement

  beforeEach(() => {
    frames = fakeFrames()
    send = vi.fn(() => Promise.resolve())
    sync = createLayoutSync({ send: send as unknown as () => Promise<void>, frames })

    container = document.createElement('div')
    boxed(container, 0, 48, 1200, 800)
    document.body.appendChild(container)

    frame = document.createElement('div')
    boxed(frame, 24, 96, 390, 844)
    container.appendChild(frame)

    sync.setContainer(container)
    sync.setFrame('iphone', frame)
  })

  it('sends the measured layout on the next frame', () => {
    frames.flush()

    expect(send).toHaveBeenCalledTimes(1)
    const [rects, viewport] = send.mock.calls[0] as [ViewRect[], Rect]
    expect(rects).toEqual([{ deviceId: 'iphone', x: 24, y: 96, width: 390, height: 844, zoom: 1 }])
    expect(viewport).toEqual({ x: 0, y: 48, width: 1200, height: 800 })
  })

  it('collapses a burst of scroll events into one send per frame', () => {
    frames.flush()
    send.mockClear()

    // A trackpad flick: dozens of scroll events between two paints.
    for (let i = 0; i < 40; i += 1) {
      boxed(frame, 24, 96 - i, 390, 844)
      container.dispatchEvent(new Event('scroll'))
    }

    expect(send).not.toHaveBeenCalled()
    expect(frames.pending()).toBe(1)

    frames.flush()
    expect(send).toHaveBeenCalledTimes(1)
    // The frame that got sent is the latest one, not the first of the burst.
    expect((send.mock.calls[0] as [ViewRect[], Rect])[0][0]?.y).toBe(96 - 39)
  })

  it('sends once per frame across a sustained scroll', () => {
    frames.flush()
    send.mockClear()

    for (let paint = 0; paint < 5; paint += 1) {
      for (let event = 0; event < 10; event += 1) {
        boxed(frame, 24, 96 - paint - 1, 390, 844)
        container.dispatchEvent(new Event('scroll'))
      }
      frames.flush()
    }

    expect(send).toHaveBeenCalledTimes(5)
  })

  it('does not send when a frame fired but nothing moved', () => {
    frames.flush()
    send.mockClear()

    container.dispatchEvent(new Event('scroll'))
    frames.flush()

    expect(send).not.toHaveBeenCalled()
  })

  it('follows window resizes', () => {
    frames.flush()
    send.mockClear()

    boxed(container, 0, 48, 900, 800)
    window.dispatchEvent(new Event('resize'))
    frames.flush()

    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as [ViewRect[], Rect])[1].width).toBe(900)
  })

  it('resends when the canvas zoom changes', () => {
    frames.flush()
    send.mockClear()

    sync.setZoom(0.5)
    frames.flush()

    expect((send.mock.calls[0] as [ViewRect[], Rect])[0][0]?.zoom).toBe(0.5)
  })

  it('reports the round trip once main has applied the layout', async () => {
    const durations: number[] = []
    sync.setRoundTripReporter((value) => durations.push(value))

    let clock = 100
    const timed = createLayoutSync({
      send: () => {
        clock += 4
        return Promise.resolve()
      },
      frames,
      now: () => clock
    })
    timed.setContainer(container)
    timed.setFrame('iphone', frame)
    const seen: number[] = []
    timed.setRoundTripReporter((value) => seen.push(value))

    frames.flush()
    await Promise.resolve()

    expect(seen).toEqual([4])
    timed.dispose()
  })

  it('drops a device that unmounts', () => {
    frames.flush()
    send.mockClear()

    sync.setFrame('iphone', null)
    frames.flush()

    expect((send.mock.calls[0] as [ViewRect[], Rect])[0]).toEqual([])
  })

  // React StrictMode simulates a remount: effects tear down and run again on
  // the same object. A one-way "disposed" latch would leave the canvas dead.
  it('comes back to life when reattached after a dispose', () => {
    frames.flush()
    sync.dispose()
    send.mockClear()

    sync.setContainer(container)
    sync.setFrame('iphone', frame)
    frames.flush()

    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as [ViewRect[], Rect])[0]).toHaveLength(1)
  })

  it('stops listening once disposed', () => {
    frames.flush()
    send.mockClear()
    sync.dispose()

    boxed(frame, 24, 0, 390, 844)
    container.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    frames.flush()

    expect(send).not.toHaveBeenCalled()
  })
})
