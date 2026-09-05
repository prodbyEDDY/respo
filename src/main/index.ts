import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  nativeImage,
  nativeTheme,
  session,
  shell
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import {
  DEFAULT_PERMISSION_DECISIONS,
  normalizeUrl,
  type DevtoolsStatePayload,
  type MainEvent,
  type PermissionStatePayload,
  type UpdateStatePayload,
  type ScrollStatePayload,
  type WatcherState
} from '@shared/ipc'
import { defaultPersistedState } from '@shared/persistence-types'
import { authHostLabel, authRealmLabel, createAuthManager, type AuthManager } from './auth'
import { CDPController } from './cdp-controller'
import { clearBrowsingData } from './clear-data'
import { DevtoolsManager } from './devtools-manager'
import { DebugCssManager } from './debug-css'
import { DesignOverlayManager } from './design-overlay'
import { DiagnosticsManager } from './diagnostics'
import { EmulationManager } from './emulation'
import { chokidarFactory, FileWatcher } from './file-watcher'
import { GuidesManager } from './guides'
import { createFaviconFetcher } from './favicons'
import { createHistory, type History } from './history'
import { Inspector } from './inspector'
import { registerHandler, registerInputListener, sendMainEvent } from './ipc'
import { createLeadTracker, type LeadTracker } from './lead-tracker'
import { ensureLogsDirectory, installLogging, watchRendererErrors } from './log'
import {
  createBackupFileIO,
  createElectronStoreBackend,
  createOverlayStoreBackend,
  createPersistence,
  exportBackup,
  importBackup,
  type Persistence,
  type PersistenceBackend
} from './persistence'
import { createPermissionsManager, type PermissionsManager } from './permissions'
import { createNodeShotFileSystem, ScreenshotQueue } from './screenshot-queue'
import {
  DEVICE_PARTITION,
  installDevicePermissionHandlers,
  isDeviceWebContents,
  openExternalSafe,
  shouldTrustCertificate
} from './security'
import { SyncEngine } from './sync-engine'
import { createUpdater, resolveUpdaterMode, writeFeedConfig, type Updater } from './updater'
import {
  validateAppResource,
  validateAuthCredentials,
  validateBoolean,
  validateBounds,
  validateClearTarget,
  validateDeviceId,
  validateDeviceSpecs,
  validateDockPosition,
  validateEmulationProfile,
  validateGuideSet,
  validateHighlightTarget,
  validateHistoryQuery,
  validateImageId,
  validateLeadDeviceId,
  validateOptionalDeviceId,
  validateOptionalDevtoolsPanel,
  validateOptionalOverlayApply,
  validateOptionalVisionDeficiency,
  validateOverlayDataUrl,
  validatePermissionDecision,
  validatePermissionType,
  validatePersistedPatch,
  validatePromptId,
  validateReloadRequest,
  validateScreenshotDirectory,
  validateShotPath,
  validateShotRequest,
  validateSyncInputBatch,
  validateThemeSource
} from './validate'
import { ViewManager } from './view-manager'
import { createDevtoolsPanelFactory, createElectronViewBackend } from './view-backend'
import {
  createKeyedBatcher,
  createLoadStateBatcher,
  type KeyedBatcher,
  type LoadStateBatcher
} from './load-state-batcher'
import { startPerfMonitor, type PerfMonitor } from './perf'
import { runScrollSpike } from './spike'
import icon from '../../resources/icon.png?asset'

/**
 * The file log, up before anything else: an exception thrown while the store
 * is being read is exactly the kind that has to land somewhere (`log.ts`).
 */
const log = installLogging({ dev: is.dev })

let viewManager: ViewManager | null = null
let loadStates: LoadStateBatcher | null = null
let perf: PerfMonitor | null = null
let stopSpike: (() => void) | null = null
let storeBackend: PersistenceBackend | null = null
let persistence: Persistence | null = null
let history: History | null = null
let lead: LeadTracker | null = null
let syncEngine: SyncEngine | null = null
let devtools: DevtoolsManager | null = null
let inspector: Inspector | null = null
let shots: ScreenshotQueue | null = null
/**
 * The environment every page is shown in — colour scheme, network, locale and
 * the rest of the emulation pack. Restored from disk before the first view.
 */
let emulation: EmulationManager | null = null
/** Console errors and overflow, per device, batched to the renderer. */
let diagnostics: DiagnosticsManager | null = null
/** Ruler guides, as CSS layers on the pages. */
let guides: GuidesManager | null = null
/** Design overlays: the image store, and the CSS layers on the pages. */
let overlays: DesignOverlayManager | null = null
/** Live reload of a local page, following the lead's url. */
let watcher: FileWatcher | null = null
/** Debug layers over every page: the outline switch. */
let debugCss: DebugCssManager | null = null
/** chokidar's `watch`, once its module has loaded. */
let chokidarReady: import('./file-watcher').WatchFactory | null = null
/** Scroll offsets of the devices whose rulers are showing, one message per turn. */
let scrollStates: KeyedBatcher<ScrollStatePayload> | null = null
/** Devices whose rulers are showing — the only ones whose scroll travels. */
const rulers = new Set<string>()
/**
 * Who may use a camera, and which questions are waiting.
 *
 * Created before the window, unlike everything else above: the permission
 * handlers have to be installed before any view exists, so no page can ask for
 * anything before there is a policy to ask (`app.whenReady`).
 */
let permissions: PermissionsManager | null = null
/**
 * The HTTP authentication challenges waiting for an answer.
 *
 * App-scoped like the permission policy, and for the same reason: `login` is an
 * `app` event, and a challenge can arrive before the renderer has finished
 * hydrating.
 */
let auth: AuthManager | null = null
/**
 * The update state machine. App-scoped: it outlives the window (an install
 * closes the window first) and its launch timer is armed once per process.
 */
let updater: Updater | null = null
/**
 * Device names, by id, as the renderer last reported them.
 *
 * Main has no device catalog of its own — `views:sync-devices` is the whole
 * truth about what exists — and a DevTools window titled `iphone-15` instead of
 * `iPhone 15` is a worse window.
 */
const deviceNames = new Map<string, string>()

/**
 * The window main pushes events to, or `null` while there is none.
 *
 * Held rather than looked up: DevTools panels get `BrowserWindow`s of their own
 * (`createDevtoolsPanelFactory`), so "the first window" is not a reliable name
 * for Respo's own. Managers created before the window — the permission policy —
 * push through this, and do nothing while it is null.
 */
let appWindow: BrowserWindow | null = null

/** Send one main event to Respo's window, if it is there to receive it. */
function pushToWindow(event: MainEvent): void {
  if (appWindow === null || appWindow.isDestroyed()) return
  sendMainEvent(appWindow.webContents, event)
}

/** Where a session opens when nothing else has an opinion. */
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
 * The url the views open on, in order of who gets to decide.
 *
 * `RESPO_START_URL` is the seam the e2e suite (and, later, the CLI/deep-link
 * entry point) uses and it wins outright: someone who launched Respo *at* a url
 * asked for that url. The home page comes next — it is a standing preference,
 * which is exactly what a launch argument overrides. Both go through the same
 * validation as anything else main is asked to load (spec §7a).
 *
 * The home page is resolved here and not in the renderer on purpose: views are
 * created and pointed somewhere before the renderer finishes hydrating, so a
 * home page applied from that side would show as the default page loading and
 * then being replaced.
 */
function resolveStartUrl(): string {
  const requested = process.env['RESPO_START_URL']
  if (requested !== undefined && requested.trim() !== '') {
    const normalized = normalizeUrl(requested)
    if (normalized !== null) return normalized
    console.error(`ignoring unloadable RESPO_START_URL: ${requested}`)
  }

  const home = persistence?.load().homeUrl ?? ''
  if (home !== '') {
    const normalized = normalizeUrl(home)
    if (normalized !== null) return normalized
  }

  return DEFAULT_START_URL
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
    // A packaged build carries the icon in the executable; this is for the
    // unpackaged runs (`npm run dev`, e2e), which would otherwise show
    // Electron's own mark in the taskbar. Harmless where it is ignored.
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only touches `contextBridge` and `ipcRenderer`, both of
      // which a sandboxed preload keeps (spec §7a).
      sandbox: true
    }
  })

  // Managers created before the window (the permission policy) push through
  // this; it is cleared again on `closed`.
  appWindow = mainWindow

  // Which page the session is on, folded out of the same batch: history records
  // one visit for five viewports, and a clear knows whose data it would delete.
  lead = createLeadTracker()

  // Every device's load events collapse into one `load-state` message per turn
  // of the event loop — there is no per-event IPC (CLAUDE.md §4).
  loadStates = createLoadStateBatcher((payload) => {
    sendMainEvent(mainWindow.webContents, { type: 'load-state', payload })
    const page = lead?.apply(payload) ?? null
    if (page !== null) history?.record(page.url, page.title)
    // The canvas may have moved to another site, and the permission panel is
    // about *this* site. Costs nothing when it did not: the manager pushes only
    // when the picture it would send actually changed.
    permissions?.refresh()
    // A local page gets its folder watched; anything else stops the watch.
    // This runs inside the batcher's flush: nothing here may throw.
    try {
      watcher?.follow(lead?.url() ?? null)
    } catch (error) {
      console.error('watcher: follow failed', error)
    }
  })

  // One CDP controller for the window's views, shared with the sync engine:
  // mirroring rides the same debugger session emulation and screenshots use
  // (CLAUDE.md §3), so there is never a second attach.
  const cdp = new CDPController()
  // Scroll offsets ride the same preload stream mirroring does; only the
  // devices with rulers showing are asked to report, and their samples are
  // coalesced to one `scroll-state` message per turn (CLAUDE.md §4).
  scrollStates = createKeyedBatcher<ScrollStatePayload>((batch) => {
    sendMainEvent(mainWindow.webContents, { type: 'scroll-state', payload: batch })
  })
  syncEngine = new SyncEngine(cdp, {
    onScroll: (deviceId, x, y) => {
      if (rulers.has(deviceId)) scrollStates?.report({ deviceId, x, y })
    }
  })

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

  // The environment profile, restored here for the same reason the mirroring
  // switches are: it has to be on a view before that view fetches anything,
  // and the renderer only finishes hydrating after the first view exists.
  emulation = new EmulationManager({
    cdp,
    ...(persistence === null ? {} : { initial: persistence.load().emulation })
  })

  // What each page complains about, coalesced per turn like load events: a
  // page throwing in a loop is one message per flush, never one per throw.
  diagnostics = new DiagnosticsManager({
    cdp,
    onState: (batch) => {
      sendMainEvent(mainWindow.webContents, { type: 'diagnostics', payload: batch })
    }
  })

  // Guides are stylesheets on the pages; the manager only needs to measure.
  guides = new GuidesManager({ cdp })
  // So is the outline switch.
  debugCss = new DebugCssManager()

  // Live reload. chokidar is loaded lazily — it is only ever needed once a
  // local page is open — and the watcher itself is created now so the views
  // can register with it.
  const liveReload = new FileWatcher({
    watch: (root, options) => {
      // Not yet loaded: a page opened before the module resolved gets its
      // watcher the moment it does. `follow` re-runs on every load batch.
      const factory = chokidarReady
      if (factory === null) throw new Error('watcher not ready')
      return factory(root, options)
    },
    cdp,
    reloadAll: () => viewManager?.reload(),
    onState: (state) => {
      sendMainEvent(mainWindow.webContents, { type: 'watcher', payload: state })
    }
  })
  watcher = liveReload
  void chokidarFactory().then(
    (factory) => {
      chokidarReady = factory
      liveReload.follow(lead?.url() ?? null)
    },
    (error: unknown) => {
      console.error('live reload is unavailable', error)
    }
  )

  // Design images live in their own store file — megabytes, not settings —
  // and are decoded by Chromium itself before anything is kept.
  if (storeBackend !== null) {
    overlays = new DesignOverlayManager({
      backend: createOverlayStoreBackend(),
      decode: (bytes) => {
        const image = nativeImage.createFromBuffer(bytes)
        if (image.isEmpty()) return null
        return image.getSize()
      }
    })
  }

  viewManager = new ViewManager(
    createElectronViewBackend(mainWindow, {
      canvasLayer: process.env['RESPO_CANVAS_LAYER'] !== '0',
      cdp,
      sync: syncEngine,
      devtools,
      inspect: inspector,
      shots,
      emulation,
      diagnostics,
      guides,
      ...(overlays === null ? {} : { overlays }),
      watcher: liveReload,
      debug: debugCss,
      // Popups belong to the viewport the user is interacting with — the same
      // election the mirroring follows.
      isLead: (deviceId) => syncEngine?.lead() === deviceId,
      onFavicon: (pageUrl, icons) => history?.noteFavicon(pageUrl, icons)
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
    // Same reasoning: the pages visited in the last second of the session are
    // sitting behind the history debounce.
    history?.flush()
    lead = null
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
    emulation?.dispose()
    emulation = null
    diagnostics?.dispose()
    diagnostics = null
    guides?.dispose()
    guides = null
    overlays?.dispose()
    overlays = null
    watcher?.dispose()
    watcher = null
    debugCss?.dispose()
    debugCss = null
    rulers.clear()
    scrollStates?.cancel()
    scrollStates = null
    loadStates?.cancel()
    loadStates = null
    stopSpike?.()
    stopSpike = null
    appWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url)
    return { action: 'deny' }
  })

  // What Respo's own window prints at `error`, into the log file. The
  // development branch below already puts the same lines on stdout.
  if (!is.dev) watchRendererErrors(mainWindow.webContents, log)

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
 * What the permission channels answer with before the policy exists. Nobody has
 * been asked anything, and no site has been decided about.
 */
function emptyPermissionState(): PermissionStatePayload {
  return { origin: null, decisions: { ...DEFAULT_PERMISSION_DECISIONS }, prompts: [] }
}

/**
 * What the update channels answer with before the updater exists. Nothing is
 * known and nothing is running — the honest picture of a process still coming
 * up, and of a unit test that never creates one.
 */
function emptyUpdateState(): UpdateStatePayload {
  return {
    stage: 'idle',
    enabled: false,
    autoCheck: persistence?.load().updates.autoCheck ?? true,
    current: app.getVersion(),
    version: null,
    percent: null,
    error: null,
    lastCheckAt: null
  }
}

/**
 * Where the bundled third-party notices are. `extraResources` puts the file
 * beside the asar in a packaged build; in development it is the repository's
 * own copy, two levels up from `out/main` — not `app.getAppPath()`, which is
 * whatever the launcher pointed Electron at (a file, in e2e).
 */
function noticesPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'NOTICE.md')
    : join(__dirname, '..', '..', 'NOTICE.md')
}

/**
 * The two app-level events where a *server* gets to interrupt the user.
 *
 * Both are scoped to the device views, and the scoping is the point. Respo's
 * own window has nothing to authenticate to and no certificate to forgive, and
 * a relaxation that reached it would be a relaxation of the tool rather than of
 * the pages under development (`security.ts`).
 */
function installNetworkPrompts(): void {
  app.on('login', (event, webContents, _details, authInfo, callback) => {
    // Not a device view: leave Electron's default in place, which is to cancel
    // the request. Nothing in Respo's own chrome should ever be logging in.
    if (auth === null || !isDeviceWebContents(webContents)) return

    // Taking the callback over. From here the request waits for us, so every
    // path below has to end in the callback being called exactly once — which
    // is what `AuthManager` guarantees, including on dispose.
    event.preventDefault()
    auth.challenge(
      authHostLabel(authInfo.scheme, authInfo.host, authInfo.port),
      authInfo.isProxy,
      authRealmLabel(authInfo.realm),
      callback
    )
  })

  app.on('certificate-error', (event, webContents, _url, _error, _certificate, callback) => {
    const trust = shouldTrustCertificate({
      allowInsecure: persistence?.load().security.allowInsecureCertificates === true,
      isDeviceView: isDeviceWebContents(webContents)
    })
    if (!trust) {
      // The documented shape of a refusal: no `preventDefault`, and `false`.
      callback(false)
      return
    }
    event.preventDefault()
    callback(true)
  })
}

/**
 * Every handler is attached through `registerHandler`, so `@shared/ipc` stays
 * the only place a channel can be introduced.
 */
function registerIpcHandlers(): void {
  registerHandler('app:get-version', () => app.getVersion())

  registerHandler('app:get-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }))

  // The renderer names a kind of thing; the path is resolved here, and it is
  // one of two (CLAUDE.md §7). `openPath` answers with an error string, or ''.
  registerHandler('app:open-resource', async (_event, resource) => {
    const which = validateAppResource(resource)
    const target = which === 'logs' ? ensureLogsDirectory() : noticesPath()
    const failure = await shell.openPath(target)
    if (failure !== '') {
      log.warn(`could not open ${which} (${target}): ${failure}`)
      return false
    }
    return true
  })

  // Updates. Every call answers with the whole state; the machine pushes
  // `update-state` on its own when a download moves or a launch check lands.
  registerHandler('updates:get', () => updater?.state() ?? emptyUpdateState())

  registerHandler('updates:check', () => updater?.check() ?? emptyUpdateState())

  registerHandler('updates:download', () => updater?.download() ?? emptyUpdateState())

  registerHandler('updates:install', () => {
    updater?.install()
  })

  registerHandler('updates:set-auto-check', (_event, enabled) => {
    // Validated before the null check, like every other payload: a malformed
    // call must reject whether or not the updater exists yet.
    const next = validateBoolean(enabled, 'updates:set-auto-check')
    return updater?.setAutoCheck(next) ?? emptyUpdateState()
  })

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
    emulation?.retain(live)
    diagnostics?.retain(live)
    guides?.retain(live)
    overlays?.retain(live)
    debugCss?.retain(live)
    for (const deviceId of [...rulers]) {
      if (live.has(deviceId)) continue
      rulers.delete(deviceId)
      // …and its preload stops reporting every frame to nobody.
      syncEngine?.setReporting(deviceId, false)
    }
    // A lead that left the canvas must not keep deciding what gets recorded —
    // or whose cookies a clear would take (`lead-tracker.ts`).
    lead?.retain(specs.map((spec) => spec.id))
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

  registerHandler('nav:reload', (_event, request) => {
    viewManager?.reload(validateReloadRequest(request))
  })

  // Per device, unlike the three above: a crash and a scroll position are
  // facts about one view, and the others must not pay for them.
  registerHandler('view:restart', (_event, deviceId) => {
    viewManager?.restart(validateDeviceId(deviceId))
  })

  registerHandler('view:scroll-to-top', (_event, deviceId) => {
    viewManager?.scrollToTop(validateDeviceId(deviceId))
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
  registerHandler('devtools:open', (_event, deviceId, panel) => {
    const id = validateDeviceId(deviceId)
    const which = validateOptionalDevtoolsPanel(panel)
    if (devtools === null) return emptyDevtoolsState()
    return which === 'console' ? devtools.openConsole(id) : devtools.openFor(id)
  })

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

  // History. The renderer asks for the handful of rows that match what is being
  // typed rather than holding a copy of two thousand of them; the call arrives
  // on a debounce behind the address bar, which is typing rate (CLAUDE.md §4).
  registerHandler(
    'history:query',
    (_event, query) => history?.query(validateHistoryQuery(query)) ?? []
  )

  registerHandler('history:clear', () => {
    history?.clear()
  })

  // The other file dialog that runs here, like the backup ones: the renderer
  // names no paths (CLAUDE.md §7) and is handed a url, already normalized, so
  // what comes back is the same kind of value the address bar produces.
  registerHandler('file:open', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Open a local page',
      properties: ['openFile' as const],
      filters: [
        { name: 'Web pages', extensions: ['html', 'htm', 'xhtml', 'shtml'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = await (window === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(window, options))
    if (result.canceled) return null

    const chosen = result.filePaths[0]
    if (chosen === undefined || chosen === '') return null
    // Through the same filter as anything else a view is told to load — "the
    // OS gave it to us" is a reason to expect a good path, not to skip the
    // check (spec §7a).
    return normalizeUrl(pathToFileURL(chosen).href)
  })

  // Clears. The renderer names a *kind*; the origin comes from what main knows
  // the views are showing, never from the payload (`clear-data.ts`).
  registerHandler('data:clear', async (_event, target) => {
    const kind = validateClearTarget(target)
    const result = await clearBrowsingData(
      session.fromPartition(DEVICE_PARTITION),
      kind,
      lead?.url() ?? null
    )
    // A page that outlives its own storage is showing state that no longer
    // exists — service workers especially, which keep answering until the
    // document that registered them is replaced.
    if (result.ok) viewManager?.reload()
    return result
  })

  // Permissions. The renderer answers a *question* by id and sets a capability
  // by type; it never names an origin, for the same reason a clear does not
  // (`permissions.ts`). Reads answer with the whole picture, so the panel never
  // has to reconcile a delta against what it was pushed.
  registerHandler('permissions:get', () => permissions?.state() ?? emptyPermissionState())

  registerHandler('permissions:respond', (_event, id, allow) => {
    permissions?.respond(
      validatePromptId(id, 'permissions:respond'),
      validateBoolean(allow, 'permissions:respond')
    )
  })

  registerHandler('permissions:dismiss', (_event, id) => {
    permissions?.dismiss(validatePromptId(id, 'permissions:dismiss'))
  })

  registerHandler('permissions:set', (_event, type, decision) => {
    const capability = validatePermissionType(type)
    const answer = validatePermissionDecision(decision)
    return permissions?.setDecision(capability, answer) ?? emptyPermissionState()
  })

  registerHandler('permissions:reset', () => permissions?.resetOrigin() ?? emptyPermissionState())

  // Authentication. The reply names the challenge it answers — never "the
  // pending one" — and the credentials are handed straight to the Electron
  // callbacks waiting behind it. Nothing about this payload is logged, here or
  // anywhere below it (`auth.ts`).
  registerHandler('auth:respond', (_event, id, credentials) => {
    auth?.respond(validatePromptId(id, 'auth:respond'), validateAuthCredentials(credentials))
  })

  // The emulation pack. The renderer owns the document (it persists the
  // profile like every other slice) and main mirrors it onto the views; the
  // whole profile travels each time and the controller diffs it per view.
  registerHandler('emulation:set', (_event, profile) => {
    emulation?.setProfile(validateEmulationProfile(profile))
  })

  registerHandler('emulation:set-device-vision', (_event, deviceId, vision) => {
    emulation?.setDeviceVision(validateDeviceId(deviceId), validateOptionalVisionDeficiency(vision))
  })

  registerHandler(
    'emulation:get',
    () =>
      emulation?.state() ?? { profile: defaultPersistedState().emulation.profile, deviceVision: {} }
  )

  // Diagnostics. The renderer highlights by *index* into the last report it
  // was pushed — the selectors are page text and never leave main.
  registerHandler('diagnostics:highlight', (_event, deviceId, target) =>
    diagnostics?.highlight(validateDeviceId(deviceId), validateHighlightTarget(target))
  )

  registerHandler('diagnostics:get', () => diagnostics?.state() ?? [])

  // Rulers and guides. A device with rulers showing reports its scroll
  // offsets (see `scroll-state`); the guides are a stylesheet on its page.
  registerHandler('scroll:track', async (_event, deviceId, enabled) => {
    const id = validateDeviceId(deviceId)
    const on = validateBoolean(enabled, 'scroll:track')
    if (on) rulers.add(id)
    else rulers.delete(id)
    syncEngine?.setReporting(id, on)
    return on ? ((await guides?.scrollOf(id)) ?? null) : null
  })

  registerHandler('guides:set', (_event, deviceId, set) =>
    guides?.set(validateDeviceId(deviceId), validateGuideSet(set))
  )

  // Design overlays. The bytes travel once (`store-image`), then only an id.
  registerHandler(
    'overlay:store-image',
    (_event, dataUrl) =>
      overlays?.storeImage(validateOverlayDataUrl(dataUrl)) ?? {
        ok: false,
        reason: 'unreadable',
        message: 'Overlays are not available.'
      }
  )

  registerHandler('overlay:image', (_event, id) => overlays?.image(validateImageId(id)) ?? null)

  registerHandler('overlay:set', (_event, deviceId, apply) =>
    overlays?.set(validateDeviceId(deviceId), validateOptionalOverlayApply(apply))
  )

  // Live reload. No payloads: the watcher follows the canvas on its own, and
  // the renderer can only pause it or ask where it stands.
  const OFF: WatcherState = { state: 'off', file: null, lastReloadAt: null }
  registerHandler('watcher:toggle', () => watcher?.toggle() ?? OFF)
  registerHandler('watcher:get', () => watcher?.state() ?? OFF)

  // Debug layers. One boolean, every device.
  registerHandler('debug:set-outline', (_event, on) => {
    debugCss?.setOutline(validateBoolean(on, 'debug:set-outline'))
  })
  registerHandler('debug:get', () => debugCss?.state() ?? { outline: false })

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

  log.info(`Respo ${app.getVersion()} starting (${process.platform} ${process.arch})`)

  // Before the first handler can be called, and before the window asks.
  //
  // One backend for both documents: `electron-store` caches the file it owns,
  // and two instances over the same file would each be writing back a copy that
  // predates the other's last write.
  storeBackend = createElectronStoreBackend()
  persistence = createPersistence(storeBackend)
  // History is the same file under its own key, and deliberately not part of
  // the settings document: it is large, it is written on every navigation, and
  // the renderer only ever wants a few rows of it (`history.ts`).
  history = createHistory(storeBackend, {
    // The site's own icon, over the session the page was loaded in — never a
    // third-party favicon service (`favicons.ts`).
    fetchFavicon: createFaviconFetcher((url) => session.fromPartition(DEVICE_PARTITION).fetch(url))
  })
  // Restore the native chrome the user left the app on; the renderer applies
  // the same value to the DOM once it has hydrated.
  nativeTheme.themeSource = persistence.load().ui.theme

  // The policy behind the permission handlers. It reads and writes the
  // `permissions` slice of the document *directly*, without going through
  // `store:save`: that slice is main's field, and the renderer's patches never
  // carry it (`validate.ts`).
  permissions = createPermissionsManager({
    store: {
      read: () => persistence?.load().permissions ?? {},
      write: (next) => persistence?.save({ permissions: next })
    },
    // The site the *canvas* is on — what the panel is about. A request always
    // carries its own requesting origin and never consults this.
    currentOrigin: () => lead?.url() ?? null,
    onState: (payload) => pushToWindow({ type: 'permission-state', payload })
  })

  // Before the first view exists, so no page can ask for anything first.
  installDevicePermissionHandlers(permissions)

  // The other two things a *server* — rather than a page — can put in front of
  // the user. Both are `app` events, and both are installed before any view
  // exists, so nothing can slip past while the window is still coming up.
  auth = createAuthManager({
    onState: (payload) => pushToWindow({ type: 'auth-state', payload })
  })
  installNetworkPrompts()

  // Updates. Off in development and under `RESPO_NO_UPDATER=1`; a loopback
  // `RESPO_UPDATE_URL` swaps the GitHub feed for a local one (`updater.ts`).
  // The `updates` slice of the document is main's, written here and never by
  // a renderer patch (`validate.ts`).
  const updaterMode = resolveUpdaterMode(process.env, app.isPackaged, log)
  if (updaterMode.enabled && updaterMode.feedUrl !== null) {
    // The config file is what a packaged build reads too; written into the
    // profile so nothing in the repository has to exist for a test feed.
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.updateConfigPath = writeFeedConfig(app.getPath('userData'), updaterMode.feedUrl)
  }
  autoUpdater.logger = log
  // There is no web installer: the installer *is* the artifact. Saying so
  // keeps electron-updater from warning about it on every download.
  autoUpdater.disableWebInstaller = true
  const store = persistence
  updater = createUpdater({
    autoUpdater,
    currentVersion: app.getVersion(),
    mode: updaterMode,
    store: {
      read: () => store.load().updates,
      write: (next) => store.save({ updates: next })
    },
    onState: (payload) => pushToWindow({ type: 'update-state', payload }),
    log
  })

  registerIpcHandlers()

  createWindow()

  // After the window: the check is the least urgent thing at launch, and its
  // answer has somewhere to go.
  updater.scheduleStartupCheck()

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
  // A launch check that has not fired yet has nowhere to report to.
  updater?.dispose()
  updater = null
  // Before the store is flushed: a question answered in the last moment of the
  // session is a decision that still has to reach disk. Everything left waiting
  // is denied — nothing may be left holding a callback nobody can answer.
  permissions?.dispose()
  permissions = null
  // Every unanswered challenge is cancelled: a request whose callback is never
  // called holds its connection open for as long as the process lives.
  auth?.dispose()
  auth = null
  // Flush first: a debounced patch from the last second of the session must
  // reach disk before anything else starts tearing down.
  persistence?.dispose()
  persistence = null
  history?.dispose()
  history = null
  storeBackend = null
  lead = null
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
  emulation?.dispose()
  emulation = null
  debugCss?.dispose()
  debugCss = null
  watcher?.dispose()
  watcher = null
  diagnostics?.dispose()
  diagnostics = null
  overlays?.dispose()
  overlays = null
  guides?.dispose()
  guides = null
  scrollStates?.cancel()
  scrollStates = null
  loadStates?.cancel()
  loadStates = null
  perf?.stop()
  perf = null
  stopSpike?.()
  stopSpike = null
})
