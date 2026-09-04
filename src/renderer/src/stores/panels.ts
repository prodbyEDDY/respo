import { create } from 'zustand'
import type {
  DevtoolsPanelName,
  DevtoolsStatePayload,
  DockPosition,
  MainEvent,
  RespoApi
} from '@shared/ipc'
import { clampDockSize, DEFAULT_DOCK_SIZE, type DevtoolsSettings } from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'

/**
 * The renderer's half of DevTools: what is open, and how big the dock is.
 *
 * Main is the authority on *what* — it is the side that hosts the frontends and
 * the side that finds out when a DevTools window is closed from its own title
 * bar — so every mutation here forwards to main and installs the state that
 * comes back rather than guessing at one. The renderer owns exactly one thing:
 * the size of the strip it reserves, because that is a fact about its own
 * layout.
 */
export interface PanelsState {
  /** Where a panel opens. Mirrors main; persisted from here. */
  dock: DockPosition
  /** The device filling the dock, or `null` when the dock is closed. */
  dockedDeviceId: string | null
  /** Devices with a DevTools window of their own. Absent id means "no window". */
  detached: Record<string, true>
  /** Thickness of the docked strip in CSS pixels: height at the bottom, width at the right. */
  size: number
  /**
   * Whether the element picker is armed on every device.
   *
   * Not persisted, and not a per-device flag: it is one mode over the whole
   * canvas, and it ends the moment something is picked.
   */
  inspecting: boolean

  /** Open DevTools for a device, or close it if this device already has it. */
  toggle: (deviceId: string) => void
  /** Open DevTools for a device, on the console when asked (the errors chip). */
  open: (deviceId: string, panel?: DevtoolsPanelName) => void
  /** Close one device's DevTools, or — `null` — whatever is in the dock. */
  close: (deviceId?: string | null) => void
  setDock: (dock: DockPosition) => void
  /**
   * Resize the dock. Called once per animation frame at the end of a drag, not
   * per pointer event: the drag itself writes the element's own style, and only
   * the value it settles on comes through the store.
   */
  setSize: (size: number) => void
  /** Arm or disarm the element picker across every device. */
  setInspecting: (active: boolean) => void
  toggleInspecting: () => void
  /** Install a state main just reported. Idempotent. */
  applyState: (state: DevtoolsStatePayload) => void
  /** Install the picker state main just reported — a pick ends the mode. */
  applyInspecting: (active: boolean) => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (devtools: DevtoolsSettings) => void
}

function withBridge<T>(run: (bridge: RespoApi) => Promise<T>, install: (answer: T) => void): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(install, (error: unknown) => {
    console.error('devtools ipc failed', error)
  })
}

/** The common case: main answers with the whole DevTools state. */
function withState(run: (bridge: RespoApi) => Promise<DevtoolsStatePayload>): void {
  withBridge(run, (state) => usePanels.getState().applyState(state))
}

function detachedMap(deviceIds: readonly string[]): Record<string, true> {
  const out: Record<string, true> = {}
  for (const id of deviceIds) out[id] = true
  return out
}

function sameDetached(a: Record<string, true>, b: Record<string, true>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === true)
}

export const usePanels = create<PanelsState>((set, get) => ({
  dock: 'bottom',
  dockedDeviceId: null,
  detached: {},
  size: DEFAULT_DOCK_SIZE,
  inspecting: false,

  toggle: (deviceId) => {
    if (selectIsOpen(get(), deviceId)) get().close(deviceId)
    else get().open(deviceId)
  },

  open: (deviceId, panel) => {
    withState((bridge) =>
      panel === undefined
        ? bridge.invoke('devtools:open', deviceId)
        : bridge.invoke('devtools:open', deviceId, panel)
    )
  },

  close: (deviceId = null) => {
    withState((bridge) => bridge.invoke('devtools:close', deviceId))
  },

  setDock: (dock) => {
    if (get().dock === dock) return
    // Optimistic: the edge is the renderer's own layout decision and the strip
    // should move on the click, not a round trip later. Main answers with the
    // same value plus whatever the migration did to the open panel.
    set({ dock })
    savePersistedState({ devtools: { dock, size: get().size } })
    withState((bridge) => bridge.invoke('devtools:set-dock', dock))
  },

  setSize: (next) => {
    const size = clampDockSize(next)
    if (get().size === size) return
    set({ size })
    savePersistedState({ devtools: { dock: get().dock, size } })
  },

  setInspecting: (active) => {
    if (get().inspecting === active) return
    // Optimistic, like the dock edge: the cursor has to change on the click,
    // and main answers with the mode it really ended up in.
    set({ inspecting: active })
    withBridge(
      (bridge) => bridge.invoke('inspect:set', active),
      (answer) => set({ inspecting: answer })
    )
  },

  toggleInspecting: () => {
    get().setInspecting(!get().inspecting)
  },

  applyInspecting: (active) => {
    if (get().inspecting === active) return
    set({ inspecting: active })
  },

  applyState: (state) => {
    const current = get()
    const detached = detachedMap(state.detachedDeviceIds)
    if (
      current.dock === state.dock &&
      current.dockedDeviceId === state.dockedDeviceId &&
      sameDetached(current.detached, detached)
    ) {
      return
    }
    set({ dock: state.dock, dockedDeviceId: state.dockedDeviceId, detached })
  },

  hydrate: (devtools) => {
    // Main opened nothing at boot — a debugging tool nobody asked for is not
    // worth a frame of canvas — so only the shape of the panel is restored.
    set({ dock: devtools.dock, size: clampDockSize(devtools.size) })
  }
}))

/** Whether this device has DevTools open anywhere. */
export function selectIsOpen(state: PanelsState, deviceId: string): boolean {
  return state.dockedDeviceId === deviceId || state.detached[deviceId] === true
}

/** Whether the dock is showing something the renderer has to reserve room for. */
export function selectDockVisible(state: PanelsState): boolean {
  return state.dockedDeviceId !== null && state.dock !== 'undocked'
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's DevTools state pushes.
 *
 * Reference-counted for the same reason `attachNavigationBridge` is: React
 * StrictMode mounts, tears down and re-mounts in development, and the
 * subscription must survive that without ending up attached twice.
 */
export function attachPanelsBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type === 'devtools-state') usePanels.getState().applyState(event.payload)
        // The picker turns itself off as soon as something is picked, and this
        // is the only way the renderer hears about it.
        else if (event.type === 'inspect-mode') {
          usePanels.getState().applyInspecting(event.payload.active)
        }
      }) ?? (() => undefined)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    subscribers -= 1
    if (subscribers > 0) return
    unsubscribe?.()
    unsubscribe = null
  }
}
