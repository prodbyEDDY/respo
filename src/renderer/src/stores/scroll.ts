import { create } from 'zustand'
import type { MainEvent, ScrollStatePayload } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * Where each device's page is scrolled to, for the parts of the chrome that
 * follow it — the rulers, and a side-by-side design panel.
 *
 * Main only asks a device to report while something here is listening, and
 * two listeners on one device are one request: the reasons are counted, and
 * `scroll:track` goes out when the count crosses zero either way. The
 * samples themselves ride the preload stream mirroring already uses, batched
 * to one `scroll-state` message per turn (CLAUDE.md §4).
 */
export interface ScrollState {
  positions: Record<string, { x: number; y: number }>
  /** Start following one device, for a reason (`'rulers'`, `'overlay'`). */
  track: (deviceId: string, reason: string) => void
  untrack: (deviceId: string, reason: string) => void
  /** Install one batched `scroll-state` event. Never called per event. */
  apply: (batch: readonly ScrollStatePayload[]) => void
  /** Forget devices that are no longer on the canvas. */
  pruneDevices: (deviceIds: readonly string[]) => void
}

const reasons = new Map<string, Set<string>>()

function send(deviceId: string, on: boolean): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void bridge.invoke('scroll:track', deviceId, on).then(
    (position) => {
      // Where the page is right now, so a ruler does not start at zero.
      if (position === null || !reasons.has(deviceId)) return
      useScroll.setState({
        positions: {
          ...useScroll.getState().positions,
          [deviceId]: { x: position.x, y: position.y }
        }
      })
    },
    (error: unknown) => {
      console.error('scroll:track failed', error)
    }
  )
}

export const useScroll = create<ScrollState>((set, get) => ({
  positions: {},

  track: (deviceId, reason) => {
    const set_ = reasons.get(deviceId)
    if (set_ !== undefined) {
      set_.add(reason)
      return
    }
    reasons.set(deviceId, new Set([reason]))
    send(deviceId, true)
  },

  untrack: (deviceId, reason) => {
    const set_ = reasons.get(deviceId)
    if (set_ === undefined) return
    set_.delete(reason)
    if (set_.size > 0) return
    reasons.delete(deviceId)
    send(deviceId, false)
  },

  apply: (batch) => {
    if (batch.length === 0) return
    const positions = { ...get().positions }
    for (const payload of batch) positions[payload.deviceId] = { x: payload.x, y: payload.y }
    set({ positions })
  },

  pruneDevices: (deviceIds) => {
    const live = new Set(deviceIds)
    for (const deviceId of [...reasons.keys()]) if (!live.has(deviceId)) reasons.delete(deviceId)
    const { positions } = get()
    if (Object.keys(positions).every((id) => live.has(id))) return
    const next: Record<string, { x: number; y: number }> = {}
    for (const [id, position] of Object.entries(positions)) if (live.has(id)) next[id] = position
    set({ positions: next })
  }
}))

/** Test seam: forget every listener so suites do not leak into each other. */
export function __resetScrollTrackingForTests(): void {
  reasons.clear()
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's batched `scroll-state` events. Reference-
 * counted like the other bridges, for StrictMode.
 */
export function attachScrollBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type !== 'scroll-state') return
        useScroll.getState().apply(event.payload)
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
