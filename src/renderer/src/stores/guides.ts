import { create } from 'zustand'
import type { GuideSet, MainEvent, RespoApi, ScrollStatePayload } from '@shared/ipc'
import {
  MAX_GUIDES_PER_AXIS,
  sanitizeGuideAxis,
  type GuidesDocument
} from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'

export type GuideAxis = 'h' | 'v'

/**
 * The renderer's half of rulers and guides.
 *
 * Three things, three lifetimes:
 * - `rulers` — which devices show their rulers. A view mode, so it lives for
 *   the session and is not written down.
 * - `guides` — the lines, by viewport size (`393x852`). The document's, and
 *   written on a debounce: a marker being dragged is one guide moving, not a
 *   hundred documents.
 * - `scroll` — where each ruler-bearing device's page is, as main last said.
 *   Main only asks a device to report while its rulers are showing.
 *
 * The lines themselves are drawn in the page by main (`guides:set`); the
 * frame sends its size's set whenever it changes. See `main/guides.ts`.
 */
export interface GuidesState {
  rulers: Record<string, true>
  guides: GuidesDocument
  scroll: Record<string, { x: number; y: number }>

  /** Show or hide one device's rulers. */
  setRulers: (deviceId: string, on: boolean) => void
  toggleRulers: (deviceId: string) => void
  /** Show or hide the rulers of every device named. */
  setRulersAll: (deviceIds: readonly string[], on: boolean) => void
  /** Add a guide on `axis` at `position` (page CSS px) for one viewport size. */
  addGuide: (key: string, axis: GuideAxis, position: number) => void
  /** Move one guide, addressed by its index in the axis. */
  moveGuide: (key: string, axis: GuideAxis, index: number, position: number) => void
  removeGuide: (key: string, axis: GuideAxis, index: number) => void
  /** Drop every guide of one viewport size. */
  clearGuides: (key: string) => void
  /** Install one batched `scroll-state` event. Never called per event. */
  applyScroll: (batch: readonly ScrollStatePayload[]) => void
  /** Forget devices that are no longer on the canvas. */
  pruneDevices: (deviceIds: readonly string[]) => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (guides: GuidesDocument) => void
}

/** The empty set, for a size that has none. */
export const NO_GUIDES: GuideSet = { h: [], v: [] }

/**
 * How long after the last change the document is written. A drag emits a
 * change per frame; the write happens once the pointer has settled.
 */
export const GUIDES_SAVE_DEBOUNCE_MS = 250

function withBridge<T>(run: (bridge: RespoApi) => Promise<T>, then?: (answer: T) => void): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(then, (error: unknown) => {
    console.error('guides ipc failed', error)
  })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Write the guides document, once the changes have stopped for a moment. */
function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    savePersistedState({ guides: useGuides.getState().guides })
  }, GUIDES_SAVE_DEBOUNCE_MS)
  ;(saveTimer as { unref?: () => void }).unref?.()
}

/** One axis with a guide added, moved or removed — repaired, sorted, deduplicated. */
function withAxis(
  guides: GuidesDocument,
  key: string,
  axis: GuideAxis,
  change: (positions: number[]) => number[]
): GuidesDocument {
  const current = guides[key] ?? NO_GUIDES
  const next = { ...current, [axis]: sanitizeGuideAxis(change([...current[axis]])) }
  const out = { ...guides }
  if (next.h.length === 0 && next.v.length === 0) delete out[key]
  else out[key] = next
  return out
}

export const useGuides = create<GuidesState>((set, get) => ({
  rulers: {},
  guides: {},
  scroll: {},

  setRulers: (deviceId, on) => {
    const { rulers } = get()
    if ((rulers[deviceId] === true) === on) return
    const next = { ...rulers }
    if (on) next[deviceId] = true
    else delete next[deviceId]
    set({ rulers: next })
    // Main answers with where the page is, so the ruler starts in the right
    // place rather than at zero until the first scroll.
    withBridge(
      (bridge) => bridge.invoke('rulers:set', deviceId, on),
      (position) => {
        if (position === null || !get().rulers[deviceId]) return
        set({ scroll: { ...get().scroll, [deviceId]: { x: position.x, y: position.y } } })
      }
    )
  },

  toggleRulers: (deviceId) => {
    get().setRulers(deviceId, get().rulers[deviceId] !== true)
  },

  setRulersAll: (deviceIds, on) => {
    for (const deviceId of deviceIds) get().setRulers(deviceId, on)
  },

  addGuide: (key, axis, position) => {
    const guides = withAxis(get().guides, key, axis, (positions) =>
      positions.length >= MAX_GUIDES_PER_AXIS ? positions : [...positions, position]
    )
    set({ guides })
    scheduleSave()
  },

  moveGuide: (key, axis, index, position) => {
    const guides = withAxis(get().guides, key, axis, (positions) => {
      if (positions[index] === undefined) return positions
      positions[index] = position
      return positions
    })
    set({ guides })
    scheduleSave()
  },

  removeGuide: (key, axis, index) => {
    const guides = withAxis(get().guides, key, axis, (positions) => {
      positions.splice(index, 1)
      return positions
    })
    set({ guides })
    scheduleSave()
  },

  clearGuides: (key) => {
    if (get().guides[key] === undefined) return
    const guides = { ...get().guides }
    delete guides[key]
    set({ guides })
    scheduleSave()
  },

  applyScroll: (batch) => {
    if (batch.length === 0) return
    const scroll = { ...get().scroll }
    for (const payload of batch) scroll[payload.deviceId] = { x: payload.x, y: payload.y }
    set({ scroll })
  },

  pruneDevices: (deviceIds) => {
    const live = new Set(deviceIds)
    const { rulers, scroll } = get()
    const gone = [...Object.keys(rulers), ...Object.keys(scroll)].some((id) => !live.has(id))
    if (!gone) return
    const nextRulers: Record<string, true> = {}
    for (const id of Object.keys(rulers)) if (live.has(id)) nextRulers[id] = true
    const nextScroll: Record<string, { x: number; y: number }> = {}
    for (const [id, position] of Object.entries(scroll)) if (live.has(id)) nextScroll[id] = position
    set({ rulers: nextRulers, scroll: nextScroll })
  },

  hydrate: (guides) => {
    set({ guides })
  }
}))

/** The guides of one viewport size, or the empty set. Stable for a stable document. */
export function selectGuides(state: GuidesState, key: string): GuideSet {
  return state.guides[key] ?? NO_GUIDES
}

/** Test seam: drop a pending write so suites do not leak into each other. */
export function __flushGuidesSaveForTests(): void {
  if (saveTimer === null) return
  clearTimeout(saveTimer)
  saveTimer = null
  savePersistedState({ guides: useGuides.getState().guides })
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's batched `scroll-state` events. Reference-
 * counted like the other bridges, for StrictMode.
 */
export function attachGuidesBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type !== 'scroll-state') return
        useGuides.getState().applyScroll(event.payload)
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
