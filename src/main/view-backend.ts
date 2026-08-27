import { shell, View, WebContentsView, type BaseWindow } from 'electron'
import type { Rect } from '@shared/types'
import type { ManagedView, ViewBackend } from './view-manager'

/**
 * Web preferences for every device view (spec §7a).
 *
 * No preload and no privileged bridge: everything Respo does to a page goes
 * through CDP from main, so the page itself gets nothing.
 */
const DEVICE_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  partition: 'persist:respo'
} as const

export type ElectronViewBackendOptions = {
  /**
   * Parent the device views to a canvas layer instead of the window itself.
   *
   * Chromium's views hierarchy clips a child to its parent, so the layer is
   * what stops a frame scrolled under the toolbar from painting over it. Views
   * composite above the whole window, and nothing in CSS can mask them.
   */
  canvasLayer?: boolean
}

/** One `WebContentsView` per device, positioned by `ViewManager`. */
export function createElectronViewBackend(
  window: BaseWindow,
  options: ElectronViewBackendOptions = {}
): ViewBackend {
  const useLayer = options.canvasLayer ?? true

  const views = new Set<WebContentsView>()
  const layer = useLayer ? new View() : null
  const parent = layer ?? window.contentView
  let disposed = false

  if (layer !== null) {
    // Off-screen until the renderer reports the canvas, so nothing flashes at
    // (0, 0) before the first layout.
    layer.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    window.contentView.addChildView(layer)
  }

  return {
    clipsToCanvas: layer !== null,

    // `DeviceSpec` starts mattering with CDP emulation; until then a view only
    // needs its bounds, so the parameter is deliberately not taken here.
    create(): ManagedView {
      const view = new WebContentsView({ webPreferences: { ...DEVICE_WEB_PREFERENCES } })
      view.setBackgroundColor('#ffffff')
      // Hidden until the renderer has told us where the frame is.
      view.setVisible(false)
      parent.addChildView(view)
      views.add(view)

      // Popups are a leading-viewport concern (spec §5.4); nothing opens here.
      view.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url)
        return { action: 'deny' }
      })

      return {
        setBounds(bounds: Rect): void {
          if (view.webContents.isDestroyed()) return
          view.setBounds(bounds)
        },
        setVisible(visible: boolean): void {
          if (view.webContents.isDestroyed()) return
          view.setVisible(visible)
        },
        setZoomFactor(zoom: number): void {
          if (view.webContents.isDestroyed()) return
          view.webContents.setZoomFactor(zoom)
        },
        loadUrl(url: string): void {
          if (view.webContents.isDestroyed()) return
          // A navigation superseded by the next one rejects with ERR_ABORTED;
          // real failures surface through `did-fail-load` in a later task.
          view.webContents.loadURL(url).catch(() => undefined)
        },
        dispose(): void {
          views.delete(view)
          parent.removeChildView(view)
          if (!view.webContents.isDestroyed()) view.webContents.close()
        }
      }
    },

    setCanvas(viewport: Rect): void {
      layer?.setBounds({
        x: Math.round(viewport.x),
        y: Math.round(viewport.y),
        width: Math.round(viewport.width),
        height: Math.round(viewport.height)
      })
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      for (const view of views) {
        parent.removeChildView(view)
        if (!view.webContents.isDestroyed()) view.webContents.close()
      }
      views.clear()
      if (layer !== null) window.contentView.removeChildView(layer)
    }
  }
}
