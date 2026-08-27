import { create } from 'zustand'
import { normalizeUrl, type LoadStatePayload, type MainEvent } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

export interface NavigationState {
  /**
   * What the address bar shows. Set by an explicit navigation and then kept in
   * step with the *leading* view — the first device to report — so following a
   * link inside a page moves the bar with it.
   */
  url: string
  /** Newest load state per device id, as delivered by the batched main event. */
  perDevice: Record<string, LoadStatePayload>
  /** Device whose url drives the address bar; the first one heard from. */
  leadDeviceId: string | null

  /** Normalize user input and load it into every view. Junk is ignored. */
  navigate: (input: string) => void
  back: () => void
  forward: () => void
  reload: () => void

  /** Apply one batched `load-state` event. Never called per event. */
  applyLoadStates: (batch: readonly LoadStatePayload[]) => void
  /** Seed the bar with main's start url without navigating again. */
  setUrl: (url: string) => void
}

function send(channel: 'nav:back' | 'nav:forward' | 'nav:reload'): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void bridge.invoke(channel).catch((error: unknown) => {
    console.error(`${channel} failed`, error)
  })
}

export const useNavigation = create<NavigationState>((set, get) => ({
  url: '',
  perDevice: {},
  leadDeviceId: null,

  navigate: (input) => {
    const url = normalizeUrl(input)
    // Nothing loadable: leave the bar alone and spend no IPC. Main validates
    // again on its side — this is the fast path, not the security boundary.
    if (url === null) return

    set({ url })

    const bridge = ipcBridge()
    if (bridge === null) return
    void bridge.invoke('nav:navigate', url).catch((error: unknown) => {
      console.error('nav:navigate failed', error)
    })
  },

  back: () => send('nav:back'),
  forward: () => send('nav:forward'),
  reload: () => send('nav:reload'),

  applyLoadStates: (batch) => {
    if (batch.length === 0) return

    const { perDevice, leadDeviceId, url } = get()
    const next = { ...perDevice }
    let lead = leadDeviceId
    let nextUrl = url

    for (const payload of batch) {
      next[payload.deviceId] = payload
      lead ??= payload.deviceId
      // Only the leading view moves the address bar: five devices reporting
      // five redirect chains must not make the bar flicker.
      if (payload.deviceId === lead && payload.url !== '') nextUrl = payload.url
    }

    set({ perDevice: next, leadDeviceId: lead, url: nextUrl })
  },

  setUrl: (url) => set({ url })
}))

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's batched `load-state` events.
 *
 * Reference-counted rather than a plain effect body: React StrictMode mounts,
 * tears down and re-mounts in development, and the bridge subscription must
 * survive that without ending up attached twice.
 */
export function attachNavigationBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type !== 'load-state') return
        useNavigation.getState().applyLoadStates(event.payload)
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
