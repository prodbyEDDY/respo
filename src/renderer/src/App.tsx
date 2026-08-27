import { useEffect, useState } from 'react'
import { Canvas } from '@renderer/components/previewer/Canvas'
import { TopBar } from '@renderer/components/toolbar/TopBar'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ipcBridge } from '@renderer/lib/ipc'
import { createLayoutTelemetry, type LayoutTelemetry } from '@renderer/lib/layout-telemetry'
import { useDevices } from '@renderer/stores/devices'
import { attachNavigationBridge, useNavigation } from '@renderer/stores/navigation'

/** TEMPORARY: the canvas zoom control arrives with Task 8. */
const SPIKE_ZOOM = 1

/**
 * Main owns the start url (CLI/deep-link argument, or the default) and has
 * already validated it. `null` until it answers, or outside Electron.
 */
function useStartUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const bridge = ipcBridge()
    if (bridge === null) return

    let live = true
    void bridge
      .invoke('app:get-start-url')
      .then((value) => {
        if (live) setUrl(value)
      })
      .catch((error: unknown) => {
        console.error('failed to read the start url', error)
      })

    return () => {
      live = false
    }
  }, [])

  return url
}

/**
 * One instrument per window, not per mount: it must survive StrictMode's
 * double-invoke, and its reporting interval outlives any component.
 */
let telemetry: LayoutTelemetry | null = null
function devTelemetry(): LayoutTelemetry | null {
  if (!import.meta.env.DEV) return null
  telemetry ??= createLayoutTelemetry()
  return telemetry
}

function App(): React.JSX.Element {
  const devices = useDevices((s) => s.active)
  const startUrl = useStartUrl()

  // Batched `load-state` events from main. Reference-counted inside, so
  // StrictMode's mount/unmount/mount never leaves two subscriptions behind.
  useEffect(() => attachNavigationBridge(), [])

  // Hand main the device set. Runs again whenever the selection changes; the
  // view manager reuses the views that stayed and loads the current url into
  // any device that just joined.
  useEffect(() => {
    const bridge = ipcBridge()
    if (bridge === null) return

    void bridge.invoke('views:sync-devices', [...devices]).catch((error: unknown) => {
      console.error('failed to sync device views', error)
    })
  }, [devices])

  // Point every view at the start url. It arrives from main a round trip after
  // mount, so the device sync above has always landed first.
  useEffect(() => {
    if (startUrl === null) return
    useNavigation.getState().navigate(startUrl)
  }, [startUrl])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background">
        <TopBar />

        <div className="min-h-0 flex-1">
          <Canvas devices={devices} zoom={SPIKE_ZOOM} onLayoutRoundTrip={devTelemetry()?.record} />
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
