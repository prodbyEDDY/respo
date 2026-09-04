import { create } from 'zustand'
import type { DiagnosticsPayload, HighlightTarget, MainEvent, RespoApi } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The renderer's half of diagnostics: what each device's page has been
 * complaining about, as main last reported it.
 *
 * Main counts, scans and outlines; this holds the numbers the chips draw and
 * forwards a highlight request. Nothing here is persisted — a count of errors
 * since the last navigation is not a setting.
 */
export interface DiagnosticsState {
  perDevice: Record<string, DiagnosticsPayload>
  /** Install one batched `diagnostics` event. Never called per event. */
  apply: (batch: readonly DiagnosticsPayload[]) => void
  /** Forget devices that are no longer on the canvas. */
  pruneDevices: (deviceIds: readonly string[]) => void
  /** Outline one offender, all of them, or none, on one device. */
  highlight: (deviceId: string, target: HighlightTarget) => void
}

function withBridge(run: (bridge: RespoApi) => Promise<unknown>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).catch((error: unknown) => {
    console.error('diagnostics ipc failed', error)
  })
}

export const useDiagnostics = create<DiagnosticsState>((set, get) => ({
  perDevice: {},

  apply: (batch) => {
    if (batch.length === 0) return
    const next = { ...get().perDevice }
    for (const payload of batch) next[payload.deviceId] = payload
    set({ perDevice: next })
  },

  pruneDevices: (deviceIds) => {
    const live = new Set(deviceIds)
    const { perDevice } = get()
    if (Object.keys(perDevice).every((id) => live.has(id))) return
    const next: Record<string, DiagnosticsPayload> = {}
    for (const [id, payload] of Object.entries(perDevice)) if (live.has(id)) next[id] = payload
    set({ perDevice: next })
  },

  highlight: (deviceId, target) => {
    withBridge((bridge) => bridge.invoke('diagnostics:highlight', deviceId, target))
  }
}))

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's batched `diagnostics` events, and ask for
 * what main already knows — a renderer that started after the pages loaded
 * would otherwise show clean frames over pages full of errors.
 *
 * Reference-counted for the same reason `attachNavigationBridge` is: React
 * StrictMode mounts, tears down and re-mounts in development, and the
 * subscription must survive that without ending up attached twice.
 */
export function attachDiagnosticsBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type !== 'diagnostics') return
        useDiagnostics.getState().apply(event.payload)
      }) ?? (() => undefined)
    withBridge(async (api) => useDiagnostics.getState().apply(await api.invoke('diagnostics:get')))
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
