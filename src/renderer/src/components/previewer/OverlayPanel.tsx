import { useEffect } from 'react'
import { useDesignOverlay } from '@renderer/stores/design-overlay'
import { useScroll } from '@renderer/stores/scroll'

/**
 * The side-by-side half of a design overlay: the mockup beside the frame,
 * at the frame's zoom, scrolled with the page.
 *
 * Pure renderer — nothing is put on the page for this mode. The image is
 * drawn at the device's width so its pixels are the page's, and shifted by
 * the page's own scroll offset (main reports it while the panel is showing,
 * through the same channel the rulers use).
 */
export function OverlayPanel({
  deviceId,
  imageId,
  width,
  height,
  zoom
}: {
  deviceId: string
  imageId: string
  /** The device's viewport in CSS pixels, as rotated. */
  width: number
  height: number
  zoom: number
}): React.JSX.Element | null {
  const image = useDesignOverlay((s) => s.images[imageId])
  const loadImage = useDesignOverlay((s) => s.loadImage)
  const position = useScroll((s) => s.positions[deviceId])
  const track = useScroll((s) => s.track)
  const untrack = useScroll((s) => s.untrack)

  useEffect(() => {
    loadImage(imageId)
  }, [imageId, loadImage])

  useEffect(() => {
    track(deviceId, 'overlay')
    return () => untrack(deviceId, 'overlay')
  }, [deviceId, track, untrack])

  if (image === undefined || image === null) return null
  const offsetY = (position?.y ?? 0) * zoom

  return (
    <div
      data-overlay-panel={deviceId}
      className="relative shrink-0 overflow-hidden rounded-md border border-border bg-card shadow-hairline"
      style={{ width: Math.round(width * zoom), height: Math.round(height * zoom) }}
    >
      <img
        src={image.dataUrl}
        alt=""
        draggable={false}
        className="absolute top-0 left-1/2 max-w-none select-none"
        style={{
          width: Math.round(Math.min(image.width, width) * zoom),
          transform: `translate(-50%, ${-offsetY}px)`
        }}
      />
    </div>
  )
}
