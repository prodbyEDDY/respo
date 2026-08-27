import type { DeviceSpec } from '@shared/types'

export type DeviceFrameProps = {
  device: DeviceSpec
  /** Canvas zoom. The placeholder shrinks; main restores the logical viewport. */
  zoom: number
  /** Attaches the element main measures and glues the `WebContentsView` to. */
  viewportRef: (element: HTMLElement | null) => void
}

/**
 * Chrome around one device: a caption, and an empty rectangle standing in for
 * the page.
 *
 * Nothing is ever painted inside that rectangle. The real page is a
 * `WebContentsView` composited on top of the whole window by main, positioned
 * to exactly this element's box — so anything drawn here would be hidden, and
 * anything drawn *around* here must stay outside it.
 */
export function DeviceFrame({ device, zoom, viewportRef }: DeviceFrameProps): React.JSX.Element {
  const width = Math.round(device.width * zoom)
  const height = Math.round(device.height * zoom)

  return (
    <section className="flex flex-col gap-1" aria-label={device.name}>
      <header className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-caption font-medium text-foreground">{device.name}</h2>
        <p className="text-micro tabular-nums text-muted-foreground">
          {device.width} × {device.height}
          {zoom === 1 ? '' : ` · ${Math.round(zoom * 100)}%`}
        </p>
      </header>

      <div
        ref={viewportRef}
        data-device-id={device.id}
        className="rounded-md border border-border bg-card shadow-hairline"
        style={{ width, height }}
      />
    </section>
  )
}
