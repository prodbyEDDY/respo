import type { ViewRect } from '@shared/ipc'
import type { Rect } from '@shared/types'
import { createRafBatcher, type FrameScheduler } from './raf-batch'
import { measureRects, measureViewport, sameLayoutFrame, type LayoutFrame } from './view-rects'

export type SendLayout = (rects: ViewRect[], viewport: Rect) => Promise<void>

export type LayoutSyncDeps = {
  /** Usually `window.respo.invoke('views:set-layout', ...)`. */
  send: SendLayout
  frames?: FrameScheduler
  now?: () => number
}

export type LayoutSync = {
  /** Scroll container to follow. Pass `null` to detach. */
  setContainer: (element: HTMLElement | null) => void
  /** Register or unregister one device placeholder. */
  setFrame: (deviceId: string, element: HTMLElement | null) => void
  /**
   * `setFrame` as a React-style ref callback. Cached per device id: React
   * detaches and reattaches a ref whose identity changes between renders.
   */
  frameRef: (deviceId: string) => (element: HTMLElement | null) => void
  setZoom: (zoom: number) => void
  /** Called with the round trip of each send, in milliseconds. */
  setRoundTripReporter: (report: ((durationMs: number) => void) | null) => void
  /** Request a measure on the next animation frame. */
  schedule: () => void
  dispose: () => void
}

/**
 * The renderer half of the view/frame glue, deliberately outside React.
 *
 * Everything that can move a frame — canvas scroll, window resize, element
 * resize, zoom, a device appearing — funnels into one rAF-coalesced
 * measure-and-send. That coalescing is the "no per-event IPC" invariant
 * (CLAUDE.md §4), and living in plain TypeScript is what makes it testable
 * rather than merely asserted.
 */
export function createLayoutSync(deps: LayoutSyncDeps): LayoutSync {
  const now = deps.now ?? (() => performance.now())

  const elements = new Map<string, HTMLElement>()
  const refCallbacks = new Map<string, (element: HTMLElement | null) => void>()
  let container: HTMLElement | null = null
  let observer: ResizeObserver | null = null
  let zoom = 1
  let lastSent: LayoutFrame | null = null
  let reportRoundTrip: ((durationMs: number) => void) | null = null

  const batcher = createRafBatcher(flush, deps.frames)
  const schedule = (): void => batcher.schedule()

  function flush(): void {
    if (container === null) return

    const frame: LayoutFrame = {
      rects: measureRects(elements, zoom),
      viewport: measureViewport(container)
    }
    // A ResizeObserver fires plenty of frames where nothing actually moved.
    // Main already has this exact layout; do not spend IPC on it.
    if (sameLayoutFrame(lastSent, frame)) return
    lastSent = frame

    const startedAt = now()
    void deps
      .send(frame.rects, frame.viewport)
      .then(() => reportRoundTrip?.(now() - startedAt))
      .catch((error: unknown) => {
        console.error('views:set-layout failed', error)
      })
  }

  function detach(): void {
    if (container !== null) container.removeEventListener('scroll', schedule)
    if (typeof window !== 'undefined') window.removeEventListener('resize', schedule)
    observer?.disconnect()
    observer = null
  }

  function attach(): void {
    if (container === null) return

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      observer.observe(container)
      for (const element of elements.values()) observer.observe(element)
    }
    // Passive: the canvas keeps scrolling on the compositor, we only observe.
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
  }

  function setFrame(deviceId: string, element: HTMLElement | null): void {
    const previous = elements.get(deviceId)
    if (previous === element) return
    if (previous !== undefined) observer?.unobserve(previous)

    if (element === null) {
      elements.delete(deviceId)
    } else {
      elements.set(deviceId, element)
      observer?.observe(element)
    }
    schedule()
  }

  return {
    setContainer(element): void {
      if (container === element) return
      detach()
      container = element
      // The old container's measurements say nothing about the new one.
      lastSent = null
      attach()
      schedule()
    },

    setFrame,

    frameRef(deviceId): (element: HTMLElement | null) => void {
      const cached = refCallbacks.get(deviceId)
      if (cached !== undefined) return cached

      const callback = (element: HTMLElement | null): void => setFrame(deviceId, element)
      refCallbacks.set(deviceId, callback)
      return callback
    },

    setZoom(next): void {
      if (zoom === next) return
      zoom = next
      schedule()
    },

    setRoundTripReporter(report): void {
      reportRoundTrip = report
    },

    schedule,

    /**
     * Detach from the DOM. Not a one-way latch: a later `setContainer` revives
     * the object, because React StrictMode tears an effect down and runs it
     * again on the very same instance.
     */
    dispose(): void {
      batcher.cancel()
      detach()
      elements.clear()
      refCallbacks.clear()
      container = null
      lastSent = null
    }
  }
}
