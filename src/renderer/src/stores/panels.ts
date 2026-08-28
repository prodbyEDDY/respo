import { create } from 'zustand'
import type { DevtoolsStatePayload, DockPosition, MainEvent, RespoApi } from '@shared/ipc'
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

  /** Open DevTools for a device, or close it if this device already has it. */
  toggle: (deviceId: string) => void
  open: (deviceId: string) => void
  /** Close one device's DevTools, or — `null` — whatever is in the dock. */
  close: (deviceId?: string | null) => void
  setDock: (dock: DockPosition) => void
  /**
   * Resize the dock. Called once per animation frame at the end of a drag, not
   * per pointer event: the drag itself writes the element's own style, and only
   * the value it settles on comes through the store.
   */
  setSize: (size: number) => void
  /** Install a state main just reported. Idempotent. */
  applyState: (state: DevtoolsStatePayload) => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (devtools: DevtoolsSettings) => void
}

function withBridge(run: (bridge: RespoApi) => Promise<DevtoolsStatePayload>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(
    (state) => usePanels.getState().applyState(state),
    (error: unknown) => {
      console.error('devtools ipc failed', error)
    }
  )
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

  toggle: (deviceId) => {
    if (selectIsOpen(get(), deviceId)) get().close(deviceId)
    else get().open(deviceId)
  },

  open: (deviceId) => {
    withBridge((bridge) => bridge.invoke('devtools:open', deviceId))
  },

  close: (deviceId = null) => {
    withBridge((bridge) => bridge.invoke('devtools:close', deviceId))
  },

  setDock: (dock) => {
    if (get().dock === dock) return
    // Optimistic: the edge is the renderer's own layout decision and the strip
    // should move on the click, not a round trip later. Main answers with the
    // same value plus whatever the migration did to the open panel.
    set({ dock })
    savePersistedState({ devtools: { dock, size: get().size } })
    withBridge((bridge) => bridge.invoke('devtools:set-dock', dock))
  },

  setSize: (next) => {
    const size = clampDockSize(next)
    if (get().size === size) return
    set({ size })
    savePersistedState({ devtools: { dock: get().dock, size } })
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
        if (event.type !== 'devtools-state') return
        usePanels.getState().applyState(event.payload)
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
