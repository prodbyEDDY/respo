import { useEffect, useMemo, useState } from 'react'
import { DeviceManagerView } from '@renderer/components/device-manager/DeviceManagerView'
import { DevtoolsDock } from '@renderer/components/devtools/DevtoolsDock'
import { Canvas } from '@renderer/components/previewer/Canvas'
import { TopBar } from '@renderer/components/toolbar/TopBar'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useAddressHotkeys } from '@renderer/hooks/useAddressHotkeys'
import { useInspectHotkeys } from '@renderer/hooks/useInspectHotkeys'
import { useLayoutHotkeys } from '@renderer/hooks/useLayoutHotkeys'
import { useShotHotkeys } from '@renderer/hooks/useShotHotkeys'
import { ipcBridge } from '@renderer/lib/ipc'
import { createLayoutTelemetry, type LayoutTelemetry } from '@renderer/lib/layout-telemetry'
import { loadPersistedState } from '@renderer/lib/persistence'
import { cn } from '@renderer/lib/utils'
import { useBookmarks } from '@renderer/stores/bookmarks'
import { useDevices } from '@renderer/stores/devices'
import { applyRotation, useLayout } from '@renderer/stores/layout'
import { attachNavigationBridge, useNavigation } from '@renderer/stores/navigation'
import { attachPanelsBridge, selectDockVisible, usePanels } from '@renderer/stores/panels'
import { useSettings } from '@renderer/stores/settings'
import { attachShotsBridge, useShots } from '@renderer/stores/shots'
import { useSync } from '@renderer/stores/sync'

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
        useSync.getState().hydrate(state.sync)
        useLayout.getState().hydrateRotation(state.rotated)
        useLayout.getState().hydrateLayout(state.layout)
        usePanels.getState().hydrate(state.devtools)
        useShots.getState().hydrate(state.screenshots)
        // The home page itself is main's to apply — it decides the start url
        // before the renderer has hydrated — so this only mirrors it.
        useBookmarks.getState().hydrate(state)
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
  const view = useLayout((s) => s.view)
  const startUrl = useStartUrl()
  const hydrated = usePersistedState()
  const dock = usePanels((s) => s.dock)
  const dockedDeviceId = usePanels((s) => s.dockedDeviceId)
  // The Device Manager replaces the canvas, and the DevTools frontend is a
  // native surface that would composite straight over it.
  const dockVisible = usePanels(selectDockVisible)
  const showDock = view === 'canvas' && dockVisible

  // Rotation is expressed as a device spec with its sides swapped, so it flows
  // through the existing path: the frame gets the new box, and main re-runs
  // `Emulation.setDeviceMetricsOverride` because the metrics changed. Memoized
  // because the effect below re-syncs every view when this array changes.
  const devices = useMemo(() => applyRotation(active, rotated), [active, rotated])

  // Batched `load-state` events from main. Reference-counted inside, so
  // StrictMode's mount/unmount/mount never leaves two subscriptions behind.
  useEffect(() => attachNavigationBridge(), [])

  // Main is the authority on what DevTools is open: it is the side that learns
  // a DevTools window was closed from its own title bar. Reference-counted the
  // same way, for the same StrictMode reason.
  useEffect(() => attachPanelsBridge(), [])

  // Screenshot progress and results, batched the same way load events are.
  useEffect(() => attachShotsBridge(), [])

  // mod+i arms the element picker, Escape puts it away.
  useInspectHotkeys()
  // mod+s photographs the whole canvas.
  useShotHotkeys()
  // mod+shift+l cycles the canvas layout, Escape leaves individual mode.
  useLayoutHotkeys()
  // mod+d saves the page, mod+l goes to the address bar, mod+o opens a file.
  useAddressHotkeys()

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

  // A device that left the canvas must not keep a load state — or the address
  // bar, if it was the view the bar was following.
  useEffect(() => {
    useNavigation.getState().pruneDevices(devices.map((d) => d.id))
  }, [devices])

  // Point every view at the start url. It arrives from main a round trip after
  // mount, so the device sync above has always landed first.
  useEffect(() => {
    if (startUrl === null) return
    useNavigation.getState().navigate(startUrl)
  }, [startUrl])

  // Take the device views off the screen while another surface has the window.
  //
  // They are native views composited above everything the renderer draws, so
  // nothing can cover them — but main hides any device the renderer does not
  // report a rect for, and an empty canvas is exactly that statement. The views
  // stay alive (and keep their pages) and come back when the canvas does.
  useEffect(() => {
    if (view === 'canvas') return
    const bridge = ipcBridge()
    if (bridge === null) return

    void bridge
      .invoke('views:set-layout', [], { x: 0, y: 0, width: 0, height: 0 })
      .catch((error: unknown) => {
        console.error('failed to hide device views', error)
      })
  }, [view])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background">
        <TopBar />

        {/*
          The canvas and the DevTools dock are flex siblings, which is the whole
          mechanism: reserving the strip makes the canvas container smaller, its
          ResizeObserver fires, and every device frame re-measures and reports
          its new box. Nothing here knows about the dock beyond its edge.
        */}
        <div className={cn('flex min-h-0 flex-1', dock === 'right' ? 'flex-row' : 'flex-col')}>
          <div className="min-h-0 min-w-0 flex-1">
            {view === 'devices' ? (
              <DeviceManagerView />
            ) : (
              <Canvas devices={devices} onLayoutRoundTrip={devTelemetry()?.record} />
            )}
          </div>
          {showDock && dockedDeviceId !== null ? <DevtoolsDock deviceId={dockedDeviceId} /> : null}
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
