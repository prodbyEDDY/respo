import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@renderer/components/previewer/Canvas'
import { TopBar } from '@renderer/components/toolbar/TopBar'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ipcBridge } from '@renderer/lib/ipc'
import { createLayoutTelemetry, type LayoutTelemetry } from '@renderer/lib/layout-telemetry'
import { loadPersistedState } from '@renderer/lib/persistence'
import { useDevices } from '@renderer/stores/devices'
import { applyRotation, useLayout } from '@renderer/stores/layout'
import { attachNavigationBridge, useNavigation } from '@renderer/stores/navigation'
import { useSettings } from '@renderer/stores/settings'

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
 * Pull the saved document out of main and install it in the stores.
 *
 * Returns `false` until that has happened, which is what keeps the first
 * `views:sync-devices` from being spent on the default suite: creating five
 * views only to tear them down a round trip later is visible, and expensive.
 * Outside Electron there is nothing to load, so the gate opens immediately.
 */
function usePersistedState(): boolean {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let live = true
    void loadPersistedState().then((state) => {
      if (!live) return
      if (state !== null) {
        useSettings.getState().hydrate(state.ui.theme)
        useDevices.getState().hydrate(state)
      }
      setHydrated(true)
    })

    return () => {
      live = false
    }
  }, [])

  return hydrated
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
  const active = useDevices((s) => s.active)
  const rotated = useLayout((s) => s.rotated)
  const startUrl = useStartUrl()
  const hydrated = usePersistedState()

  // Rotation is expressed as a device spec with its sides swapped, so it flows
  // through the existing path: the frame gets the new box, and main re-runs
  // `Emulation.setDeviceMetricsOverride` because the metrics changed. Memoized
  // because the effect below re-syncs every view when this array changes.
  const devices = useMemo(() => applyRotation(active, rotated), [active, rotated])

  // Batched `load-state` events from main. Reference-counted inside, so
  // StrictMode's mount/unmount/mount never leaves two subscriptions behind.
  useEffect(() => attachNavigationBridge(), [])

  // Hand main the device set. Runs again whenever the selection changes; the
  // view manager reuses the views that stayed and loads the current url into
  // any device that just joined.
  useEffect(() => {
    if (!hydrated) return
    const bridge = ipcBridge()
    if (bridge === null) return

    void bridge.invoke('views:sync-devices', [...devices]).catch((error: unknown) => {
      console.error('failed to sync device views', error)
    })
  }, [devices, hydrated])

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
          <Canvas devices={devices} onLayoutRoundTrip={devTelemetry()?.record} />
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
