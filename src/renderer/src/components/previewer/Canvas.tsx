import { useEffect, useRef } from 'react'
import type { DeviceSpec } from '@shared/types'
import { useViewRects } from '@renderer/hooks/useViewRects'
import { createRafBatcher } from '@renderer/lib/raf-batch'
import { useLayout } from '@renderer/stores/layout'
import { useSync } from '@renderer/stores/sync'
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
 * The lead election, at the moment the canvas loses the pointer.
 *
 * This is the *important* half of the election, not a cleanup. A device page is
 * a native view composited over the whole window: the moment the pointer
 * crosses onto one, the document stops receiving mouse events entirely and
 * Chromium fires `mouseleave` on the canvas. The frames' own `mouseenter` only
 * ever sees the header and the gaps — a pointer entering a page from the side
 * would never reach it.
 *
 * So the pointer's last known position decides:
 *
 * - still inside the canvas → it went *into* a device. The placeholder that
 *   view is glued to is still in the DOM at exactly that point, so hit-testing
 *   it names the device the user is now pointing at.
 * - outside → the pointer really left. Nothing leads.
 */
function electLeadOnLeave(event: React.MouseEvent<HTMLDivElement>): void {
  const box = event.currentTarget.getBoundingClientRect()
  const { clientX: x, clientY: y } = event

  if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) {
    useSync.getState().setLead(null)
    return
  }

  const frame = document.elementFromPoint(x, y)?.closest('[data-device-id]')
  const deviceId = frame?.getAttribute('data-device-id')
  // No frame under the pointer: it left through something else that overlays
  // the canvas. Leave the election where it is rather than guessing.
  if (deviceId === null || deviceId === undefined || deviceId === '') return
  useSync.getState().setLead(deviceId)
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
      onMouseLeave={electLeadOnLeave}
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
