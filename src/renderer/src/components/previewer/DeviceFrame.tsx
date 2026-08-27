import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import type { LoadStatePayload } from '@shared/ipc'
import type { DeviceSpec } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { useNavigation } from '@renderer/stores/navigation'

export type DeviceFrameProps = {
  device: DeviceSpec
  /** Canvas zoom. The placeholder shrinks; main restores the logical viewport. */
  zoom: number
  /** Attaches the element main measures and glues the `WebContentsView` to. */
  viewportRef: (element: HTMLElement | null) => void
}

/** A ring, not a GIF: `animate-spin` is a transform, so it stays on the GPU. */
function Spinner(): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="size-3 animate-spin rounded-full border-2 border-status-loading border-t-transparent"
    />
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * What the user sees instead of Chromium's own error page.
 *
 * This only becomes visible because main hides a view whose main frame failed:
 * a `WebContentsView` composites above the entire window, so nothing the
 * renderer draws can ever sit on top of a live one.
 */
function LoadError({ state }: { state: LoadStatePayload }): React.JSX.Element {
  const reload = useNavigation((s) => s.reload)

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
      <ExclamationTriangleIcon aria-hidden="true" className="size-6 text-status-error" />
      <p className="text-caption font-medium text-foreground">
        Couldn&apos;t load {hostOf(state.url)}
      </p>
      <p className="max-w-full truncate text-micro text-muted-foreground">
        {state.errorDesc ?? 'The page failed to load'}
        {state.errorCode === undefined ? '' : ` (${state.errorCode})`}
      </p>
      <Button variant="outline" size="sm" onClick={reload} className="mt-1">
        <ArrowPathIcon />
        Retry
      </Button>
    </div>
  )
}

/**
 * Chrome around one device: a caption, and an empty rectangle standing in for
 * the page.
 *
 * Nothing is ever painted inside that rectangle while the page is live. The
 * real page is a `WebContentsView` composited on top of the whole window by
 * main, positioned to exactly this element's box — so anything drawn here would
 * be hidden, and anything drawn *around* here must stay outside it. The one
 * exception is the failure card above, which main makes room for by hiding the
 * view that failed.
 */
export function DeviceFrame({ device, zoom, viewportRef }: DeviceFrameProps): React.JSX.Element {
  const load = useNavigation((s) => s.perDevice[device.id])
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
        {load?.state === 'loading' ? <Spinner /> : null}
      </header>

      <div
        ref={viewportRef}
        data-device-id={device.id}
        data-load-state={load?.state ?? 'idle'}
        className="relative rounded-md border border-border bg-card shadow-hairline"
        style={{ width, height }}
      >
        {load?.state === 'failed' ? <LoadError state={load} /> : null}
      </div>
    </section>
  )
}
