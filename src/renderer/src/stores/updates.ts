import { create } from 'zustand'
import type { MainEvent, RespoApi, UpdateStatePayload } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The renderer's view of the updater.
 *
 * Main is the authority and this is a mirror of what it last said: every call
 * answers with the whole state, and main pushes `update-state` whenever the
 * machine moves on its own — a download progressing, the launch check landing.
 * The store holds no logic about *when* anything happens; it holds the answer
 * to "what does the chip say right now".
 */
export interface UpdatesState {
  status: UpdateStatePayload
  /** A manual check, from About. */
  check: () => void
  /** The chip's first click. Nothing downloads without it. */
  download: () => void
  /** The chip's second click: quit, install, relaunch. */
  install: () => void
  setAutoCheck: (enabled: boolean) => void
  /** Install what main just answered or pushed. Idempotent. */
  applyState: (status: UpdateStatePayload) => void
  /** Ask main for the current picture — the state may have moved before mount. */
  refresh: () => void
}

/** Before main has answered anything: nothing known, nothing offered. */
export function emptyUpdateStatus(): UpdateStatePayload {
  return {
    stage: 'idle',
    enabled: false,
    autoCheck: true,
    current: '',
    version: null,
    percent: null,
    error: null,
    lastCheckAt: null
  }
}

function withState(run: (bridge: RespoApi) => Promise<UpdateStatePayload>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(
    (status) => useUpdates.getState().applyState(status),
    (error: unknown) => {
      console.error('updates ipc failed', error)
    }
  )
}

function sameStatus(a: UpdateStatePayload, b: UpdateStatePayload): boolean {
  return (
    a.stage === b.stage &&
    a.enabled === b.enabled &&
    a.autoCheck === b.autoCheck &&
    a.current === b.current &&
    a.version === b.version &&
    a.percent === b.percent &&
    a.error === b.error &&
    a.lastCheckAt === b.lastCheckAt
  )
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: emptyUpdateStatus(),

  check: () => {
    withState((bridge) => bridge.invoke('updates:check'))
  },

  download: () => {
    withState((bridge) => bridge.invoke('updates:download'))
  },

  install: () => {
    const bridge = ipcBridge()
    if (bridge === null) return
    void bridge.invoke('updates:install').catch((error: unknown) => {
      console.error('updates:install failed', error)
    })
  },

  setAutoCheck: (enabled) => {
    if (get().status.autoCheck === enabled) return
    // Optimistic: a checkbox has to move on the click. Main answers with the
    // value it actually stored.
    set({ status: { ...get().status, autoCheck: enabled } })
    withState((bridge) => bridge.invoke('updates:set-auto-check', enabled))
  },

  applyState: (status) => {
    if (sameStatus(get().status, status)) return
    set({ status })
  },

  refresh: () => {
    withState((bridge) => bridge.invoke('updates:get'))
  }
}))

/**
 * Whether the toolbar has something to say.
 *
 * Exactly the download path — an update to offer, one coming down, one ready —
 * plus a failure *on* that path, which is worth a retry button. A failed
 * check is not: it goes to the log and to About, not to the toolbar.
 */
export function selectChipVisible(state: UpdatesState): boolean {
  const { stage, version } = state.status
  return (
    stage === 'available' ||
    stage === 'downloading' ||
    stage === 'downloaded' ||
    (stage === 'error' && version !== null)
  )
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's `update-state` pushes, and ask once for the
 * current picture — the launch check may have landed before the window was
 * listening. Reference-counted for StrictMode, like the other bridges.
 */
export function attachUpdatesBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type === 'update-state') useUpdates.getState().applyState(event.payload)
      }) ?? (() => undefined)
    useUpdates.getState().refresh()
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
