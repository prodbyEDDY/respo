import { create } from 'zustand'
import type { RespoApi } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The debug layers, as the overflow menu shows them. A session mode: not
 * written down, and asked of main when the renderer starts so a reloaded
 * renderer agrees with the pages.
 */
export interface DebugState {
  outline: boolean
  setOutline: (on: boolean) => void
  toggleOutline: () => void
  /** Install what main says. */
  apply: (state: { outline: boolean }) => void
}

function withBridge(run: (bridge: RespoApi) => Promise<unknown>): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).catch((error: unknown) => {
    console.error('debug ipc failed', error)
  })
}

export const useDebug = create<DebugState>((set, get) => ({
  outline: false,

  setOutline: (on) => {
    if (get().outline === on) return
    set({ outline: on })
    withBridge((bridge) => bridge.invoke('debug:set-outline', on))
  },

  toggleOutline: () => get().setOutline(!get().outline),

  apply: (state) => set({ outline: state.outline })
}))

/** Ask main where the switches stand — once, when the renderer starts. */
export function hydrateDebug(): void {
  withBridge(async (bridge) => useDebug.getState().apply(await bridge.invoke('debug:get')))
}
