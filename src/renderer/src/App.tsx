import { useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Canvas } from '@renderer/components/previewer/Canvas'
import { ipcBridge } from '@renderer/lib/ipc'
import { createLayoutTelemetry, type LayoutTelemetry } from '@renderer/lib/layout-telemetry'
import { useDevices } from '@renderer/stores/devices'
import { useSettings, type Theme } from '@renderer/stores/settings'

const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/** TEMPORARY: the address bar and device picker arrive later in W1. */
const SPIKE_URL = 'https://example.com'
const SPIKE_ZOOM = 1

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

/**
 * Temporary theme switcher. Replaced by the real settings surface in W1/T7.
 */
function ThemeSwitcher(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {THEMES.map((option) => (
        <Button
          key={option}
          size="xs"
          variant={theme === option ? 'default' : 'ghost'}
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
          className="capitalize"
        >
          {option}
        </Button>
      ))}
    </div>
  )
}

function App(): React.JSX.Element {
  const devices = useDevices((s) => s.active)

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

  // Point every view at the start url once. Declared after the sync effect, so
  // React runs it second and main already knows about the devices.
  useEffect(() => {
    const bridge = ipcBridge()
    if (bridge === null) return

    void bridge.invoke('nav:navigate', SPIKE_URL).catch((error: unknown) => {
      console.error('failed to open the start url', error)
    })
  }, [])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-subheading font-semibold text-foreground">Respo</span>
          <span className="text-caption text-muted-foreground">
            {devices.length} devices · {SPIKE_URL}
          </span>
        </div>
        <ThemeSwitcher />
      </header>

      <div className="min-h-0 flex-1">
        <Canvas devices={devices} zoom={SPIKE_ZOOM} onLayoutRoundTrip={devTelemetry()?.record} />
      </div>
    </div>
  )
}

export default App
