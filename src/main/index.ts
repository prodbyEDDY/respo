import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { normalizeUrl, type DevtoolsStatePayload } from '@shared/ipc'
import { defaultPersistedState } from '@shared/persistence-types'
import { CDPController } from './cdp-controller'
import { DevtoolsManager } from './devtools-manager'
import { Inspector } from './inspector'
import { registerHandler, registerInputListener, sendMainEvent } from './ipc'
import {
  createBackupFileIO,
  createElectronStoreBackend,
  createPersistence,
  exportBackup,
  importBackup,
  type Persistence
} from './persistence'
import { createNodeShotFileSystem, ScreenshotQueue } from './screenshot-queue'
import { installDevicePermissionHandlers, openExternalSafe } from './security'
import { SyncEngine } from './sync-engine'
import {
  validateBoolean,
  validateBounds,
  validateDeviceId,
  validateDeviceSpecs,
  validateDockPosition,
  validateLeadDeviceId,
  validateOptionalDeviceId,
  validatePersistedPatch,
  validateScreenshotDirectory,
  validateShotPath,
  validateShotRequest,
  validateSyncInputBatch,
  validateThemeSource
} from './validate'
import { ViewManager } from './view-manager'
import { createDevtoolsPanelFactory, createElectronViewBackend } from './view-backend'
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
let devtools: DevtoolsManager | null = null
let inspector: Inspector | null = null
let shots: ScreenshotQueue | null = null
/**
 * Device names, by id, as the renderer last reported them.
 *
 * Main has no device catalog of its own — `views:sync-devices` is the whole
 * truth about what exists — and a DevTools window titled `iphone-15` instead of
 * `iPhone 15` is a worse window.
 */
const deviceNames = new Map<string, string>()

/** Until the address bar lands, every session opens here. */
const DEFAULT_START_URL = 'https://example.com'

/** The folder under `Pictures` a fresh install writes screenshots into. */
const DEFAULT_SHOT_FOLDER = 'Respo'

/**
 * Where screenshots go, resolved.
 *
 * The document stores `''` until the user picks a folder, because the default
 * is a path only main can name (`app.getPath`) and one that differs per
 * machine. Resolved on every capture rather than cached: the settings dialog
 * can move it mid-session.
 */
function screenshotDirectory(): string {
  const configured = persistence?.load().screenshots.directory ?? ''
  if (configured !== '') return configured
  return join(app.getPath('pictures'), DEFAULT_SHOT_FOLDER)
}

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

  // DevTools is per device, not per app: the manager holds a panel for each one
  // that has it open, and the single dock they take turns in. The dock edge is
  // restored here so the first panel opens where the user left the last one.
  devtools = new DevtoolsManager({
    createPanel: createDevtoolsPanelFactory(mainWindow),
    dock: persistence?.load().devtools.dock ?? 'bottom',
    deviceName: (deviceId) => deviceNames.get(deviceId),
    // The window is what says how big a docked strip may be; the rect the
    // renderer reports is only a measurement (`DevtoolsManagerOptions`).
    contentSize: () => {
      // A window that is tearing down has no content area, and nothing is left
      // to place inside it either.
      if (mainWindow.isDestroyed()) return { width: 0, height: 0 }
      const [width, height] = mainWindow.getContentSize()
      return { width: width ?? 0, height: height ?? 0 }
    },
    onState: (state) => {
      sendMainEvent(mainWindow.webContents, { type: 'devtools-state', payload: state })
    }
  })

  // The element picker is one toggle over every view at once, so it lives
  // beside the manager rather than inside it: it decides *which* device's
  // DevTools opens, and the manager opens it.
  inspector = new Inspector({
    cdp,
    devtools,
    onState: (active) => {
      sendMainEvent(mainWindow.webContents, { type: 'inspect-mode', payload: { active } })
    }
  })

  // Screenshots ride the same CDP sessions as everything else and run three at
  // a time (CLAUDE.md §4): a full-page capture is a document-sized raster, and
  // ten of them at once is the canvas stalling.
  shots = new ScreenshotQueue({
    cdp,
    fs: createNodeShotFileSystem(),
    directory: screenshotDirectory,
    defaults: () => {
      const saved = persistence?.load().screenshots
      return { format: saved?.format ?? 'png', dpr: saved?.dpr ?? 'device' }
    },
    onState: (batch) => {
      sendMainEvent(mainWindow.webContents, { type: 'shot-state', payload: batch })
    },
    // Electron's clipboard is the W3C-shaped one: an item per MIME type,
    // written atomically. PNG is what every paste target understands.
    copyImage: (png) =>
      clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
      ]),
    revealFile: (path) => shell.showItemInFolder(path)
  })

  viewManager = new ViewManager(
    createElectronViewBackend(mainWindow, {
      canvasLayer: process.env['RESPO_CANVAS_LAYER'] !== '0',
      cdp,
      sync: syncEngine,
      devtools,
      inspect: inspector,
      shots
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
    // Before the views: a DevTools window outliving the canvas it belongs to
    // would keep the app alive with nothing to debug, and a view left in the
    // picker would swallow the next click in a page that is still loading.
    inspector?.dispose()
    inspector = null
    // Before the views too: a capture in flight holds a CDP session open.
    shots?.dispose()
    shots = null
    devtools?.dispose()
    devtools = null
    deviceNames.clear()
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
 * What the DevTools channels answer with before a window exists. Nothing is
 * open, and the persisted edge is the honest thing to report.
 */
function emptyDevtoolsState(): DevtoolsStatePayload {
  return {
    dockedDeviceId: null,
    dock: persistence?.load().devtools.dock ?? 'bottom',
    detachedDeviceIds: []
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
    // The screenshots folder is main's field, not the renderer's: the patch's
    // copy is dropped and this one merged back in its place (`validate.ts`).
    const store = persistence
    const context =
      store === null ? {} : { screenshotDirectory: store.load().screenshots.directory }
    store?.save(validatePersistedPatch(patch, context))
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

    deviceNames.clear()
    for (const spec of specs) deviceNames.set(spec.id, spec.name)
    // A device that left the canvas takes its DevTools with it. The backend
    // already unregistered the views it disposed; this catches a manager that
    // is holding a panel for a device no layout will ever mention again.
    const live = new Set(specs.map((spec) => spec.id))
    devtools?.retain(live)
    inspector?.retain(live)
    shots?.retain(live)
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

  // DevTools. All four are user gestures except `set-bounds`, which is the
  // resize drag already coalesced to one call per animation frame by the
  // renderer (CLAUDE.md §4). The three that change what is open answer with the
  // whole state, so the renderer never has to guess what its click did.
  registerHandler(
    'devtools:open',
    (_event, deviceId) => devtools?.openFor(validateDeviceId(deviceId)) ?? emptyDevtoolsState()
  )

  registerHandler(
    'devtools:close',
    (_event, deviceId) =>
      devtools?.close(validateOptionalDeviceId(deviceId)) ?? emptyDevtoolsState()
  )

  registerHandler('devtools:set-bounds', (_event, bounds) => {
    devtools?.setBounds(validateBounds(bounds))
  })

  // The picker is global — one toggle, every view — so it takes no device id.
  // Main answers with the mode it is actually in, and pushes `inspect-mode`
  // when a pick ends the mode without the renderer asking.
  registerHandler(
    'inspect:set',
    (_event, active) => inspector?.setActive(validateBoolean(active, 'inspect:set')) ?? false
  )

  registerHandler('devtools:set-dock', (_event, dock) => {
    const next = validateDockPosition(dock)
    // Persisted by the renderer, which owns the whole `devtools` slice of the
    // document — main only reads it back at the next boot.
    return devtools?.setDock(next) ?? emptyDevtoolsState()
  })

  // Screenshots. `shot:device` and `shot:all` only *start* work — they answer
  // with the batch they queued, and the captures themselves report through
  // batched `shot-state` events (CLAUDE.md §4).
  registerHandler('shot:device', (_event, deviceId, request) => {
    const id = validateDeviceId(deviceId)
    const options = validateShotRequest(request)
    return shots?.captureDevice(id, options) ?? { batchId: '', queued: 0 }
  })

  registerHandler('shot:all', (_event, request) => {
    const options = validateShotRequest(request)
    return shots?.captureAll(options) ?? { batchId: '', queued: 0 }
  })

  registerHandler('shot:copy', (_event, deviceId) => {
    const id = validateDeviceId(deviceId)
    return shots?.copy(id) ?? false
  })

  // The path is the renderer's, so it is checked twice: shape here, and
  // containment in the screenshots folder inside the queue.
  registerHandler('shot:reveal', (_event, path) => shots?.reveal(validateShotPath(path)) ?? false)

  registerHandler('shot:get-dir', () => screenshotDirectory())

  // The folder dialog runs here, like the backup ones — and so does the write.
  //
  // The renderer names no paths of its own (CLAUDE.md §7) and it does not
  // persist this one either: a folder the user chose in a system dialog is the
  // only way the screenshots directory ever moves, so the write belongs on this
  // side of the boundary. The renderer is told what landed and reflects it.
  registerHandler('shot:choose-dir', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose a folder for screenshots',
      defaultPath: screenshotDirectory(),
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const result = await (window === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(window, options))
    if (result.canceled) return null

    const chosen = result.filePaths[0]
    if (chosen === undefined || chosen === '') return null
    // Checked even though it came from the OS: `validateScreenshotDirectory` is
    // what says this is an absolute path of a sane length, and it is about to
    // become the folder every capture writes into.
    const directory = validateScreenshotDirectory(chosen)

    const store = persistence
    if (store === null) return directory
    store.save({ screenshots: { ...store.load().screenshots, directory } })
    return directory
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
  inspector?.dispose()
  inspector = null
  shots?.dispose()
  shots = null
  devtools?.dispose()
  devtools = null
  viewManager?.destroy()
  viewManager = null
  loadStates?.cancel()
  loadStates = null
  perf?.stop()
  perf = null
  stopSpike?.()
  stopSpike = null
})
