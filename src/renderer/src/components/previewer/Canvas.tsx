import { useEffect, useRef } from 'react'
import type { DeviceSpec } from '@shared/types'
import { useViewRects } from '@renderer/hooks/useViewRects'
import { DeviceFrame } from './DeviceFrame'

export type CanvasProps = {
  devices: readonly DeviceSpec[]
  zoom?: number
  /** Round trip of one layout sync, in ms. Used by the dev perf harness. */
  onLayoutRoundTrip?: (durationMs: number) => void
}

/**
 * The scrolling canvas of device frames.
 *
 * The canvas owns the scroll, the frames own their geometry, and
 * `useViewRects` reports both to main once per animation frame. Scrolling stays
 * a plain native scroll — no `wheel` interception — so the compositor keeps
 * doing it and the layout sync only observes.
 */
export function Canvas({ devices, zoom = 1, onLayoutRoundTrip }: CanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { frameRef, invalidate } = useViewRects(containerRef, {
    zoom,
    onRoundTrip: onLayoutRoundTrip
  })

  // A device joining or leaving changes every frame after it.
  useEffect(() => {
    invalidate()
  }, [devices, zoom, invalidate])

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
