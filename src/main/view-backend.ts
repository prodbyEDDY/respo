import { View, WebContentsView, type BaseWindow, type WebContents } from 'electron'
import { join } from 'path'
import { SYNC_CAPTURE_CHANNEL, type LoadState, type LoadStatePayload } from '@shared/ipc'
import type { DeviceSpec, Rect } from '@shared/types'
import { CDPController } from './cdp-controller'
import { DEVICE_PARTITION, openExternalSafe } from './security'
import type { SyncRegistry } from './sync-engine'
import type { ManagedView, ReportLoadState, ViewBackend } from './view-manager'

/**
 * Web preferences for every device view (spec §7a).
 *
 * The one preload is `device-view`, and it is not a bridge: it exposes nothing
 * to the page, it only listens for input and reports it to main so the other
 * viewports can mirror it. Everything Respo *does* to a page still goes through
 * CDP from main. The sandbox stays on — the preload touches nothing but
 * `ipcRenderer` and the DOM.
 */
const DEVICE_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/device-view.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  partition: DEVICE_PARTITION
} as const

/**
 * The document every view is primed with before CDP emulation is applied. It is
 * plumbing, never something the user asked for, so it is filtered out of every
 * load event rather than flashing through the UI as a navigation.
 */
const PRIMER_URL = 'about:blank'

/**
 * `net::ERR_ABORTED`. A navigation superseded by the next one (the user typing
 * a second url, a redirect) reports this; it is not a failure the user should
 * ever see (spec §5.2).
 */
const ERR_ABORTED = -3

function isPrimer(url: string): boolean {
  return url === '' || url === PRIMER_URL || url.startsWith('about:')
}

/**
 * What one view could do with its own history, right now.
 *
 * Read on demand rather than tracked: Chromium owns the entry list, and
 * anything this module counted would drift the first time a page pushed state.
 *
 * "Back" deliberately does not mean `canGoBack()`. Every view is primed with
 * `about:blank` before emulation can be applied, so the first real page always
 * has a previous entry — and stepping onto it would blank the canvas. A
 * navigation the user never made is not somewhere they can go back to.
 *
 * Exported for its unit test; production code reaches it through `create`.
 */
export function readHistory(wc: WebContents): { canGoBack: boolean; canGoForward: boolean } {
  try {
    const history = wc.navigationHistory
    const index = history.getActiveIndex()
    const previous = index <= 0 ? undefined : history.getAllEntries()[index - 1]
    return {
      canGoBack: previous !== undefined && !isPrimer(previous.url),
      canGoForward: history.canGoForward()
    }
  } catch {
    // A view already tearing down has no history to speak of.
    return { canGoBack: false, canGoForward: false }
  }
}

/**
 * Translate one view's `webContents` load events into `LoadStatePayload`s.
 *
 * Every event is per-view and unbatched here on purpose: the batcher upstream
 * (`createLoadStateBatcher`) is what turns them into one IPC message per turn,
 * so this function only has to be *correct*, not frugal.
 *
 * Exported for its unit test; production code reaches it through `create`.
 */
export function watchLoadState(wc: WebContents, deviceId: string, report: ReportLoadState): void {
  let title: string | undefined
  // Latched per navigation: Chromium keeps talking after a main-frame failure
  // (it commits its own error page), and none of that may overwrite `failed`.
  let failedThisNavigation = false

  const emit = (payload: Omit<LoadStatePayload, 'deviceId'>): void => {
    if (wc.isDestroyed()) return
    report({
      deviceId,
      ...payload,
      ...readHistory(wc),
      ...(title === undefined ? {} : { title })
    })
  }

  /**
   * Events that are *not* "the load finished" must not claim it did. A title
   * lands as soon as `<title>` parses and a `pushState` can happen mid-fetch,
   * so ask the page whether it is still working rather than assuming.
   */
  const settledState = (): LoadState => (wc.isLoading() ? 'loading' : 'ready')

  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || isPrimer(details.url)) return
    if (details.isSameDocument) {
      // A hash change or `pushState`: no fetch, no spinner — but the address
      // bar still has to follow it.
      emit({ state: failedThisNavigation ? 'failed' : settledState(), url: details.url })
      return
    }
    failedThisNavigation = false
    title = undefined
    emit({ state: 'loading', url: details.url })
  })

  wc.on('did-finish-load', () => {
    const url = wc.getURL()
    if (failedThisNavigation || isPrimer(url)) return
    title = wc.getTitle()
    emit({ state: 'ready', url })
  })

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Sub-frame failures are the page's business, not the browser's, and an
    // aborted navigation is the *next* navigation announcing itself.
    if (!isMainFrame || errorCode === ERR_ABORTED || isPrimer(validatedURL)) return
    failedThisNavigation = true
    title = undefined
    emit({
      state: 'failed',
      url: validatedURL,
      errorCode,
      errorDesc: errorDescription
    })
  })

  // A same-document navigation is announced before its entry is committed, so
  // the history read above can be one step stale. This fires after it lands and
  // costs nothing: the batcher keeps one payload per device per turn, so a
  // correction and the event it corrects collapse into the same message.
  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame !== true || failedThisNavigation || isPrimer(url)) return
    emit({ state: settledState(), url })
  })

  wc.on('page-title-updated', (_event, next) => {
    const url = wc.getURL()
    if (failedThisNavigation || isPrimer(url)) return
    title = next
    emit({ state: settledState(), url })
  })
}

export type ElectronViewBackendOptions = {
  /**
   * Parent the device views to a canvas layer instead of the window itself.
   *
   * Chromium's views hierarchy clips a child to its parent, so the layer is
   * what stops a frame scrolled under the toolbar from painting over it. Views
   * composite above the whole window, and nothing in CSS can mask them.
   */
  canvasLayer?: boolean
  /**
   * The CDP session owner. Passed in when something outside the backend — the
   * sync engine — needs to talk to the same sessions; otherwise the backend
   * makes its own.
   */
  cdp?: CDPController
  /** Told about every view's lifetime, so input can be mirrored into it. */
  sync?: SyncRegistry
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
  const cdp = options.cdp ?? new CDPController()
  const sync = options.sync ?? null
  let disposed = false

  if (layer !== null) {
    // Off-screen until the renderer reports the canvas, so nothing flashes at
    // (0, 0) before the first layout.
    layer.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    window.contentView.addChildView(layer)
  }

  return {
    clipsToCanvas: layer !== null,

    create(device: DeviceSpec, report: ReportLoadState): ManagedView {
      const view = new WebContentsView({ webPreferences: { ...DEVICE_WEB_PREFERENCES } })
      view.setBackgroundColor('#ffffff')
      // Hidden until the renderer has told us where the frame is.
      view.setVisible(false)
      parent.addChildView(view)
      views.add(view)

      // Popups are a leading-viewport concern (spec §5.4); nothing opens here.
      // The url is page-controlled, so it goes through the scheme filter.
      view.webContents.setWindowOpenHandler(({ url }) => {
        openExternalSafe(url)
        return { action: 'deny' }
      })

      // One debugger attach for this view's whole life (CLAUDE.md §3).
      //
      // The `about:blank` load is not cosmetic: a `WebContentsView` that has
      // never committed a navigation has no live renderer, and CDP emulation
      // against one takes the browser process down (`setDeviceMetricsOverride`
      // crashes; the touch and user-agent calls simply never resolve). Priming
      // with a blank document gives every later CDP call something to talk to.
      const wc = view.webContents
      watchLoadState(wc, device.id, report)
      const primed = cdp.attach(wc).then(() => wc.loadURL(PRIMER_URL).catch(() => undefined))

      // The engine addresses this view by its `webContents` id — the same id
      // its preload's input messages arrive under — and scales normalized
      // coordinates against the emulated viewport.
      sync?.registerDevice({
        deviceId: device.id,
        target: wc,
        width: device.width,
        height: device.height,
        setCapturing: (capturing) => {
          if (wc.isDestroyed()) return
          wc.send(SYNC_CAPTURE_CHANNEL, capturing)
        }
      })

      // A preload is a document's script: the copy running in the page this
      // view just committed has not been told anything yet, and starts from
      // its own "report everything" default. Say it again now.
      wc.on('dom-ready', () => {
        sync?.refreshCapture(device.id)
      })

      // `emulated` is the gate every navigation waits behind, so a page is
      // never fetched before its device profile is in place.
      let emulated = primed.then(() => cdp.applyDevice(wc, device))

      return {
        setBounds(bounds: Rect): void {
          if (wc.isDestroyed()) return
          view.setBounds(bounds)
        },
        setVisible(visible: boolean): void {
          if (wc.isDestroyed()) return
          view.setVisible(visible)
        },
        setZoomFactor(zoom: number): void {
          if (wc.isDestroyed()) return
          wc.setZoomFactor(zoom)
          // The engine dispatches mouse events into this view, and those
          // coordinates are read in the zoomed widget's space rather than the
          // page's own (see `SyncRegistry.setZoom`).
          sync?.setZoom(device.id, zoom)
        },
        applyDevice(next: DeviceSpec): void {
          if (wc.isDestroyed()) return
          // Rotation and edited metrics change what a normalized coordinate
          // means here, so the engine has to hear about them too.
          sync?.updateDevice(device.id, { width: next.width, height: next.height })
          emulated = emulated.then(() => cdp.applyDevice(wc, next))
        },
        loadUrl(url: string): void {
          if (wc.isDestroyed()) return
          // Queued behind emulation so the document is fetched with the device
          // user agent. A navigation superseded by the next one rejects with
          // ERR_ABORTED; real failures surface through `did-fail-load` later.
          emulated = emulated.then(() => {
            if (wc.isDestroyed()) return
            return wc.loadURL(url).then(
              () => undefined,
              () => undefined
            )
          })
        },
        goBack(): void {
          // The same reading the toolbar's enable state is derived from: back
          // never means back onto the `about:blank` the view was primed with.
          if (wc.isDestroyed() || !readHistory(wc).canGoBack) return
          wc.navigationHistory.goBack()
        },
        goForward(): void {
          if (wc.isDestroyed() || !wc.navigationHistory.canGoForward()) return
          wc.navigationHistory.goForward()
        },
        reload(): void {
          if (wc.isDestroyed()) return
          // A view still sitting on the primer has nothing to reload; give it
          // the session url instead, once emulation has landed.
          if (isPrimer(wc.getURL())) return
          wc.reload()
        },
        dispose(): void {
          views.delete(view)
          sync?.unregisterDevice(device.id)
          cdp.detachSafe(wc)
          parent.removeChildView(view)
          if (!wc.isDestroyed()) wc.close()
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
      cdp.detachAll()
      for (const view of views) {
        parent.removeChildView(view)
        if (!view.webContents.isDestroyed()) view.webContents.close()
      }
      views.clear()
      if (layer !== null) window.contentView.removeChildView(layer)
    }
  }
}
