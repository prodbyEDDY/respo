import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { normalizeUrl } from '@shared/ipc'
import { registerHandler, sendMainEvent } from './ipc'
import { ViewManager } from './view-manager'
import { createElectronViewBackend } from './view-backend'
import { createLoadStateBatcher, type LoadStateBatcher } from './load-state-batcher'
import { startPerfMonitor, type PerfMonitor } from './perf'
import { runScrollSpike } from './spike'
import icon from '../../resources/icon.png?asset'

let viewManager: ViewManager | null = null
let loadStates: LoadStateBatcher | null = null
let perf: PerfMonitor | null = null
let stopSpike: (() => void) | null = null

/** Until the address bar lands, every session opens here. */
const DEFAULT_START_URL = 'https://example.com'

/**
 * The url the views open on. `RESPO_START_URL` is the seam the e2e suite (and,
 * later, the CLI/deep-link entry point) uses; it goes through the same
 * validation as anything else main is asked to load (spec §7a).
 */
function resolveStartUrl(): string {
  const requested = process.env['RESPO_START_URL']
  if (requested === undefined || requested.trim() === '') return DEFAULT_START_URL
  const normalized = normalizeUrl(requested)
  if (normalized === null) {
    console.error(`ignoring unloadable RESPO_START_URL: ${requested}`)
    return DEFAULT_START_URL
  }
  return normalized
}

function createWindow(): void {
  // Wide enough that a handful of device frames fit side by side; this is a
  // multi-viewport browser, not a single-page window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Every device's load events collapse into one `load-state` message per turn
  // of the event loop — there is no per-event IPC (CLAUDE.md §4).
  loadStates = createLoadStateBatcher((payload) => {
    sendMainEvent(mainWindow.webContents, { type: 'load-state', payload })
  })

  viewManager = new ViewManager(
    createElectronViewBackend(mainWindow, {
      canvasLayer: process.env['RESPO_CANVAS_LAYER'] !== '0'
    }),
    { onLoadState: (payload) => loadStates?.report(payload) }
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    viewManager?.destroy()
    viewManager = null
    loadStates?.cancel()
    loadStates = null
    stopSpike?.()
    stopSpike = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev) {
    // Renderer instrumentation is part of the R1 evidence; surface it on the
    // same stdout as the main-process numbers.
    mainWindow.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error(`[renderer] ${event.message}`)
      else if (event.message.startsWith('[')) console.log(event.message)
    })
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (is.dev && process.env['RESPO_SPIKE'] === '1') {
    const deltaY = Number(process.env['RESPO_SPIKE_DELTA'])
    stopSpike = runScrollSpike(mainWindow, {
      captureDir: process.env['RESPO_SPIKE_DIR'],
      ...(Number.isFinite(deltaY) && deltaY > 0 ? { deltaY } : {})
    })
  }
}

/**
 * Every handler is attached through `registerHandler`, so `@shared/ipc` stays
 * the only place a channel can be introduced.
 */
function registerIpcHandlers(): void {
  registerHandler('app:get-version', () => app.getVersion())

  registerHandler('app:get-start-url', () => resolveStartUrl())

  registerHandler('theme:set-source', (_event, source) => {
    nativeTheme.themeSource = source
  })

  registerHandler('views:sync-devices', (_event, devices) => {
    viewManager?.syncDevices(devices)
  })

  // The hot path: one call per animation frame, applied synchronously so every
  // view lands in the same frame the renderer painted its placeholder in.
  registerHandler('views:set-layout', (_event, rects, viewport) => {
    if (viewManager === null) return
    const startedAt = performance.now()
    viewManager.applyLayout(rects, viewport)
    perf?.recordLayoutApply(performance.now() - startedAt)
  })

  registerHandler('nav:navigate', (_event, url) => {
    viewManager?.navigateAll(url)
  })

  registerHandler('nav:back', () => {
    viewManager?.goBack()
  })

  registerHandler('nav:forward', () => {
    viewManager?.goForward()
  })

  registerHandler('nav:reload', () => {
    viewManager?.reload()
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.prodbyeddy.respo')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (is.dev) perf = startPerfMonitor()

  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  viewManager?.destroy()
  viewManager = null
  loadStates?.cancel()
  loadStates = null
  perf?.stop()
  perf = null
  stopSpike?.()
  stopSpike = null
})
