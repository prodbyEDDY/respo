import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CanvasLayoutMode } from '@shared/persistence-types'
import type { DeviceSpec } from '@shared/types'
import { useViewRects } from '@renderer/hooks/useViewRects'
import {
  CANVAS_PADDING,
  fitZoom,
  FRAME_CAPTION_HEIGHT,
  planMasonry
} from '@renderer/lib/canvas-layout'
import { createRafBatcher } from '@renderer/lib/raf-batch'
import { useLayout } from '@renderer/stores/layout'
import { useSync } from '@renderer/stores/sync'
import { DeviceFrame } from './DeviceFrame'
import { DeviceTabs, TAB_STRIP_HEIGHT } from './DeviceTabs'

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
 * The device `individual` is showing.
 *
 * Falls back to the first frame on the canvas rather than to nothing: the
 * remembered id can name a device that has since left the suite, and a mode
 * that showed an empty canvas because of it would look broken with no way out
 * except a keyboard shortcut.
 */
function individualDevice(
  devices: readonly DeviceSpec[],
  deviceId: string | null
): DeviceSpec | undefined {
  return devices.find((device) => device.id === deviceId) ?? devices[0]
}

/**
 * The scroll area's inner width, as React state.
 *
 * Only masonry needs this — it is the one arrangement whose *shape* depends on
 * how much room there is, because CSS has no way to say "the shortest column".
 * A `ResizeObserver` rather than the window's resize event: the canvas also
 * narrows when the DevTools dock takes the right-hand strip, which no window
 * event announces. Measured in a layout effect so the first paint already has
 * the real number instead of one column's worth of frames jumping apart.
 */
function useContentWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return

    const measure = (): void => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}

/** Arrangement classes for the modes CSS can express on its own. */
const ARRANGEMENT: Record<Exclude<CanvasLayoutMode, 'masonry' | 'individual'>, string> = {
  // One device per row, in suite order: scroll down and you have seen them all.
  column: 'flex flex-col items-start gap-6 p-6',
  // Rows that wrap at the canvas width — each row as tall as its tallest frame.
  flex: 'flex flex-wrap content-start items-start gap-6 p-6'
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
 *
 * The layout mode changes *what is in the DOM*, and nothing else: every mode
 * renders the same `DeviceFrame`s through the same measured placeholders, so
 * switching costs one layout frame and no view is ever recreated. `individual`
 * renders one frame, which is also how the other views are suspended — main
 * hides every device the renderer did not report a rect for, and a device that
 * is not on the canvas is offscreen by definition.
 */
export function Canvas({ devices, onLayoutRoundTrip }: CanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const zoom = useLayout((s) => s.zoom)
  const mode = useLayout((s) => s.mode)
  const individualDeviceId = useLayout((s) => s.individualDeviceId)
  const { frameRef, invalidate } = useViewRects(containerRef, {
    zoom,
    onRoundTrip: onLayoutRoundTrip
  })

  const contentWidth = useContentWidth(containerRef)

  const shown = mode === 'individual' ? individualDevice(devices, individualDeviceId) : undefined

  // Masonry is the one arrangement CSS cannot do: the packing depends on how
  // tall each frame draws, which is device metrics and zoom, not a box model.
  // Derived rather than stored — a selector that built this on every render
  // would be a new array every time (CLAUDE.md pitfalls).
  const columns = useMemo(() => {
    if (mode !== 'masonry') return []
    return planMasonry(devices, zoom, contentWidth - CANVAS_PADDING * 2)
  }, [devices, zoom, mode, contentWidth])

  // A device joining or leaving changes every frame after it — and so does a
  // layout switch, which moves every frame at once.
  useEffect(() => {
    invalidate()
  }, [devices, zoom, mode, individualDeviceId, invalidate])

  // Expanding a device fits it to the canvas: an "expand" that leaves the user
  // scrolling to reach the bottom of the page has not expanded anything. Once,
  // when the shown device changes — not on every resize, because the zoom
  // buttons still work here and a canvas that re-fitted would undo them.
  const fitted = useRef<string | null>(null)
  useEffect(() => {
    if (mode !== 'individual' || shown === undefined) {
      fitted.current = null
      return
    }
    if (fitted.current === shown.id) return
    fitted.current = shown.id

    const box = containerRef.current?.getBoundingClientRect()
    if (box === undefined || box.width <= 0) return
    useLayout.getState().setZoom(
      fitZoom(
        shown,
        { width: box.width, height: box.height },
        {
          width: CANVAS_PADDING * 2,
          height: CANVAS_PADDING * 2 + FRAME_CAPTION_HEIGHT + TAB_STRIP_HEIGHT
        }
      )
    )
  }, [mode, shown])

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

  const frame = (device: DeviceSpec): React.JSX.Element => (
    <DeviceFrame key={device.id} device={device} zoom={zoom} viewportRef={frameRef(device.id)} />
  )

  return (
    <div className="flex h-full w-full flex-col">
      {/*
        The tab strip is a sibling of the scroll area, not a child of it: it is
        how you leave the mode and how you switch device, and a control that
        scrolled away with the frame would be neither.
      */}
      {mode === 'individual' && shown !== undefined ? (
        <DeviceTabs devices={devices} shownDeviceId={shown.id} />
      ) : null}

      <div
        ref={containerRef}
        data-testid="canvas"
        data-layout={mode}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background"
        onMouseLeave={electLeadOnLeave}
      >
        {mode === 'individual' ? (
          <div className="flex items-start justify-center p-6">
            {shown === undefined ? null : frame(shown)}
          </div>
        ) : mode === 'masonry' ? (
          <div className="flex items-start gap-6 p-6">
            {columns.map((column) => (
              <div key={column[0]?.id ?? 'empty'} className="flex flex-col items-start gap-6">
                {column.map(frame)}
              </div>
            ))}
          </div>
        ) : (
          <div className={ARRANGEMENT[mode]}>{devices.map(frame)}</div>
        )}
      </div>
    </div>
  )
}
