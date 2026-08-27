import { useEffect, useRef } from 'react'
import type { DeviceSpec } from '@shared/types'
import { useViewRects } from '@renderer/hooks/useViewRects'
import { createRafBatcher } from '@renderer/lib/raf-batch'
import { useLayout } from '@renderer/stores/layout'
import { DeviceFrame } from './DeviceFrame'

export type CanvasProps = {
  devices: readonly DeviceSpec[]
  /** Round trip of one layout sync, in ms. Used by the dev perf harness. */
  onLayoutRoundTrip?: (durationMs: number) => void
}

/**
 * How fast ctrl+wheel zooms, per pixel of wheel delta. One notch on a mouse
 * (deltaY = 100) moves the canvas about 14%.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0015

/** Wheel deltas come in pixels, lines or pages; the gesture needs pixels. */
function wheelPixels(event: WheelEvent, element: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * element.clientHeight
  return event.deltaY
}

/**
 * The scrolling canvas of device frames.
 *
 * The canvas owns the scroll, the frames own their geometry, and
 * `useViewRects` reports both to main once per animation frame. Scrolling stays
 * a plain native scroll — no `wheel` interception — so the compositor keeps
 * doing it and the layout sync only observes. Ctrl+wheel is the one exception:
 * it is a zoom gesture, not a scroll, and it is coalesced to one store write
 * per frame rather than one per event (CLAUDE.md §4).
 */
export function Canvas({ devices, onLayoutRoundTrip }: CanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const zoom = useLayout((s) => s.zoom)
  const { frameRef, invalidate } = useViewRects(containerRef, {
    zoom,
    onRoundTrip: onLayoutRoundTrip
  })

  // A device joining or leaving changes every frame after it.
  useEffect(() => {
    invalidate()
  }, [devices, zoom, invalidate])

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return

    // A trackpad pinch fires dozens of wheel events per frame. They accumulate
    // here and become one zoom — and therefore one layout sync — per frame.
    let pendingDelta = 0
    const batcher = createRafBatcher(() => {
      const delta = pendingDelta
      pendingDelta = 0
      if (delta === 0) return
      const layout = useLayout.getState()
      // Multiplicative, so a notch feels the same at 25% and at 200%.
      layout.setZoom(layout.zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY))
    })

    const onWheel = (event: WheelEvent): void => {
      // Without ctrl this is an ordinary scroll: leave it to the compositor.
      if (!event.ctrlKey) return
      // Also stops Chromium page-zooming the whole Respo window.
      event.preventDefault()
      pendingDelta += wheelPixels(event, element)
      batcher.schedule()
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      batcher.cancel()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      data-testid="canvas"
      className="h-full w-full overflow-auto overscroll-contain bg-background"
    >
      <div className="flex flex-wrap content-start items-start gap-6 p-6">
        {devices.map((device) => (
          <DeviceFrame
            key={device.id}
            device={device}
            zoom={zoom}
            viewportRef={frameRef(device.id)}
          />
        ))}
      </div>
    </div>
  )
}
