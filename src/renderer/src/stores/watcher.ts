import { create } from 'zustand'
import type { MainEvent, RespoApi, WatcherState } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The renderer's view of live reload: whether the local page is being
 * watched, and the one thing the user can do about it — pause.
 *
 * Main decides what to watch (it follows the canvas's url) and does the
 * reloading; this holds the state the address-bar dot draws.
 */
export interface WatcherStore extends WatcherState {
  /** Pause or resume. Main answers with the state it ended up in. */
  toggle: () => void
  /** Install a state main pushed or answered with. */
  apply: (state: WatcherState) => void
}

function withBridge(run: (bridge: RespoApi) => Promise<WatcherState>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(
    (state) => useWatcher.getState().apply(state),
    (error: unknown) => {
      console.error('watcher ipc failed', error)
    }
  )
}

export const useWatcher = create<WatcherStore>((set) => ({
  state: 'off',
  file: null,
  lastReloadAt: null,

  toggle: () => {
    withBridge((bridge) => bridge.invoke('watcher:toggle'))
  },

  apply: (state) => {
    set({ state: state.state, file: state.file, lastReloadAt: state.lastReloadAt })
  }
}))

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe to main's `watcher` events, and ask where it stands — a renderer
 * that started after the page was opened would otherwise show no dot over a
 * folder that is being watched. Reference-counted like the other bridges.
 */
export function attachWatcherBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type !== 'watcher') return
        useWatcher.getState().apply(event.payload)
      }) ?? (() => undefined)
    withBridge((api) => api.invoke('watcher:get'))
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
