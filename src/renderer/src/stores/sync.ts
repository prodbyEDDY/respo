import { create } from 'zustand'
import type { RespoApi } from '@shared/ipc'
import type { SyncSettings } from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'
import { createRafBatcher } from '@renderer/lib/raf-batch'

/**
 * The renderer's half of interaction mirroring: which device leads, and which
 * ones are switched off.
 *
 * The *behaviour* lives in main — this store holds only what the UI has to
 * draw (a ring on the lead, a state on two toggles) and forwards each change
 * once. Main is the authority: it decides what a lead election means, and it
 * ignores anything that arrives for a device it does not know.
 */
export interface SyncState {
  /** Master switch. Off means no view mirrors anything. */
  globalEnabled: boolean
  /** Devices the user took out of mirroring. Absent id means "mirroring". */
  disabled: Record<string, boolean>
  /** The device currently driving the others; `null` while nothing is hovered. */
  leadDeviceId: string | null

  toggleGlobal: () => void
  toggleDevice: (deviceId: string) => void
  /**
   * Elect (or clear) the lead. Safe to call on every `mouseenter`: the IPC is
   * coalesced to one call per animation frame and unchanged values cost
   * nothing (CLAUDE.md §4).
   */
  setLead: (deviceId: string | null) => void
  /** Install the switches main restored at boot. Writes nothing back. */
  hydrate: (sync: SyncSettings) => void
}

function invoke(run: (bridge: RespoApi) => Promise<void>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).catch((error: unknown) => {
    console.error('sync ipc failed', error)
  })
}

/**
 * The lead the last frame ended on, and the frame that will report it.
 *
 * A pointer swept across the canvas crosses every frame it passes, and each
 * crossing is a `mouseenter`. Only the one the pointer came to rest in matters,
 * so the batcher sends that one and drops the rest.
 */
let pendingLead: string | null = null
/**
 * `undefined` until the first election is reported — deliberately not `null`,
 * which is a real value here. Main starts a session leading whichever view
 * registered first, so the very first "no lead" has to travel.
 */
let sentLead: string | null | undefined = undefined

const leadBatcher = createRafBatcher(() => {
  if (pendingLead === sentLead) return
  const lead = pendingLead
  sentLead = lead
  invoke((bridge) => bridge.invoke('sync:set-lead', lead))
})

/** Which ids are muted, as the persisted document spells it. */
function disabledIds(disabled: Record<string, boolean>): string[] {
  return Object.keys(disabled).filter((id) => disabled[id] === true)
}

export const useSync = create<SyncState>((set, get) => ({
  globalEnabled: true,
  disabled: {},
  leadDeviceId: null,

  toggleGlobal: () => {
    const globalEnabled = !get().globalEnabled
    set({ globalEnabled })
    invoke((bridge) => bridge.invoke('sync:set-global', globalEnabled))
    savePersistedState({
      sync: { enabled: globalEnabled, disabledDeviceIds: disabledIds(get().disabled) }
    })
  },

  toggleDevice: (deviceId) => {
    const { disabled } = get()
    const nextDisabled = disabled[deviceId] !== true
    // Only the exceptions are kept, so un-muting removes the key rather than
    // leaving a `false` behind that would then be persisted forever.
    const next = { ...disabled }
    if (nextDisabled) next[deviceId] = true
    else delete next[deviceId]

    set({ disabled: next })
    invoke((bridge) => bridge.invoke('sync:set-enabled', deviceId, !nextDisabled))
    savePersistedState({
      sync: { enabled: get().globalEnabled, disabledDeviceIds: disabledIds(next) }
    })
  },

  setLead: (deviceId) => {
    pendingLead = deviceId
    // The ring follows the pointer immediately — it is a local repaint, not a
    // round trip. Only the message to main waits for the frame.
    if (get().leadDeviceId !== deviceId) set({ leadDeviceId: deviceId })
    leadBatcher.schedule()
  },

  hydrate: (sync) => {
    const disabled: Record<string, boolean> = {}
    for (const id of sync.disabledDeviceIds) disabled[id] = true
    // Main already applied these to the engine before the first view existed;
    // re-sending them would be noise.
    set({ globalEnabled: sync.enabled, disabled })
  }
}))

/** Test seam: forget the coalesced lead so suites do not leak into each other. */
export function __resetLeadBatchForTests(): void {
  pendingLead = null
  sentLead = undefined
  leadBatcher.cancel()
}
