import { useEffect, useMemo, type RefObject } from 'react'
import { ipcBridge } from '@renderer/lib/ipc'
import { createLayoutSync } from '@renderer/lib/layout-sync'

export type UseViewRectsOptions = {
  /** Canvas zoom factor; frames are already scaled by it in the DOM. */
  zoom?: number
  /**
   * Round trip of one `views:set-layout`, in milliseconds: from just before the
   * renderer sends to just after main finished its synchronous apply pass.
   */
  onRoundTrip?: (durationMs: number) => void
}

export type ViewRectsApi = {
  /** `ref` for a device placeholder. Stable per device id. */
  frameRef: (deviceId: string) => (element: HTMLElement | null) => void
  /** Ask for a re-measure on the next frame (device set changed, layout switch). */
  invalidate: () => void
}

/**
 * React binding for `createLayoutSync`: keeps main's `WebContentsView` bounds
 * glued to the placeholder frames this component tree renders.
 */
export function useViewRects(
  containerRef: RefObject<HTMLElement | null>,
  options: UseViewRectsOptions = {}
): ViewRectsApi {
  const { zoom = 1, onRoundTrip } = options

  const sync = useMemo(
    () =>
      createLayoutSync({
        send: async (rects, viewport) => {
          const bridge = ipcBridge()
          // Absent outside Electron (unit tests, plain browser dev server).
          if (bridge === null) return
          await bridge.invoke('views:set-layout', rects, viewport)
        }
      }),
    []
  )

  // No dispose-on-unmount: `setContainer(null)` below already detaches every
  // listener, and the sync object dies with the component. Disposing here would
  // fight React StrictMode, which runs this teardown on a live component.
  useEffect(() => sync.setZoom(zoom), [sync, zoom])
  useEffect(() => {
    sync.setRoundTripReporter(onRoundTrip ?? null)
  }, [sync, onRoundTrip])

  useEffect(() => {
    sync.setContainer(containerRef.current)
    return () => sync.setContainer(null)
  }, [sync, containerRef])

  return { frameRef: sync.frameRef, invalidate: sync.schedule }
}
