import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { normalizeUrl } from '@shared/ipc'
import { defaultPersistedState } from '@shared/persistence-types'
import { CDPController } from './cdp-controller'
import { registerHandler, registerInputListener, sendMainEvent } from './ipc'
import {
  createBackupFileIO,
  createElectronStoreBackend,
  createPersistence,
  exportBackup,
  importBackup,
  type Persistence
} from './persistence'
import { installDevicePermissionHandlers, openExternalSafe } from './security'
import { SyncEngine } from './sync-engine'
import {
  validateBoolean,
  validateDeviceId,
  validateDeviceSpecs,
  validateLeadDeviceId,
  validatePersistedPatch,
  validateSyncInputBatch,
  validateThemeSource
} from './validate'
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
let persistence: Persistence | null = null
let syncEngine: SyncEngine | null = null

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
      // The preload only touches `contextBridge` and `ipcRenderer`, both of
      // which a sandboxed preload keeps (spec §7a).
      sandbox: true
    }
  })

  // Every device's load events collapse into one `load-state` message per turn
  // of the event loop — there is no per-event IPC (CLAUDE.md §4).
  loadStates = createLoadStateBatcher((payload) => {
    sendMainEvent(mainWindow.webContents, { type: 'load-state', payload })
  })

  // One CDP controller for the window's views, shared with the sync engine:
  // mirroring rides the same debugger session emulation and screenshots use
  // (CLAUDE.md §3), so there is never a second attach.
  const cdp = new CDPController()
  syncEngine = new SyncEngine(cdp)

  // Restore the mirroring switches here rather than from the renderer: they
  // have to be in place before the first view registers, and the renderer only
  // finishes hydrating after that.
  const savedSync = persistence?.load().sync
  if (savedSync !== undefined) {
    syncEngine.setGlobalEnabled(savedSync.enabled)
    for (const deviceId of savedSync.disabledDeviceIds) syncEngine.setEnabled(deviceId, false)
  }

  viewManager = new ViewManager(
    createElectronViewBackend(mainWindow, {
      canvasLayer: process.env['RESPO_CANVAS_LAYER'] !== '0',
      cdp,
      sync: syncEngine
    }),
    { onLoadState: (payload) => loadStates?.report(payload) }
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    // The window is where every patch comes from, so its last one has to land
    // now — `before-quit` is not guaranteed to run before the process goes.
    persistence?.flush()
    syncEngine?.dispose()
    syncEngine = null
    viewManager?.destroy()
    viewManager = null
    loadStates?.cancel()
    loadStates = null
    stopSpike?.()
    stopSpike = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url)
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
    nativeTheme.themeSource = validateThemeSource(source)
  })

  // Disk lives entirely on this side of the boundary: the renderer reads the
  // document once at boot and posts patches (CLAUDE.md §7).
  registerHandler('store:load', () => persistence?.load() ?? defaultPersistedState())

  registerHandler('store:save', (_event, patch) => {
    persistence?.save(validatePersistedPatch(patch))
  })

  // Import and export are the only paths to a file the *user* names, and both
  // of them run here: the dialog, the validation and the read/write all live in
  // main, and the renderer only ever sees a value (CLAUDE.md §7).
  registerHandler('backup:export', (event, backup) =>
    exportBackup(createBackupFileIO(BrowserWindow.fromWebContents(event.sender)), backup)
  )

  registerHandler('backup:import', (event) =>
    importBackup(createBackupFileIO(BrowserWindow.fromWebContents(event.sender)))
  )

  registerHandler('views:sync-devices', (_event, devices) => {
    // Validated before the null check: a malformed payload must reject whether
    // or not a window happens to be open.
    const specs = validateDeviceSpecs(devices)
    viewManager?.syncDevices(specs)
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

  // Mirroring controls. All three are user gestures — a hover, a click on a
  // toggle — so they are ordinary invokes, not part of any stream. The renderer
  // coalesces the hover election to one call per frame before it gets here.
  registerHandler('sync:set-lead', (_event, deviceId) => {
    syncEngine?.setLead(validateLeadDeviceId(deviceId))
  })

  registerHandler('sync:set-enabled', (_event, deviceId, enabled) => {
    syncEngine?.setEnabled(validateDeviceId(deviceId), validateBoolean(enabled, 'sync:set-enabled'))
  })

  registerHandler('sync:set-global', (_event, enabled) => {
    syncEngine?.setGlobalEnabled(validateBoolean(enabled, 'sync:set-global'))
  })

  // The one-way stream from the device views. Its sender is an untrusted page,
  // so the batch is validated (and clamped) before the engine sees any of it;
  // anything malformed is dropped rather than thrown back at the page.
  registerInputListener((senderId, payload) => {
    syncEngine?.handleInput(senderId, validateSyncInputBatch(payload))
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

  // Before the first handler can be called, and before the window asks.
  persistence = createPersistence(createElectronStoreBackend())
  // Restore the native chrome the user left the app on; the renderer applies
  // the same value to the DOM once it has hydrated.
  nativeTheme.themeSource = persistence.load().ui.theme

  // Before the first view exists, so no page can ask for anything first.
  installDevicePermissionHandlers()

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
  // Flush first: a debounced patch from the last second of the session must
  // reach disk before anything else starts tearing down.
  persistence?.dispose()
  persistence = null
  syncEngine?.dispose()
  syncEngine = null
  viewManager?.destroy()
  viewManager = null
  loadStates?.cancel()
  loadStates = null
  perf?.stop()
  perf = null
  stopSpike?.()
  stopSpike = null
})
