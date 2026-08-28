import type { PersistedState } from '@shared/persistence-types'
import { ipcBridge } from './ipc'

/**
 * The renderer's half of persistence: read once, then post patches.
 *
 * There is no disk access here and there never will be (CLAUDE.md §7) — main
 * owns the store, merges what arrives and debounces the write. Outside Electron
 * (unit tests, the dev server in a plain browser) both calls degrade quietly,
 * so the stores work with their in-memory defaults.
 */
export async function loadPersistedState(): Promise<PersistedState | null> {
  const bridge = ipcBridge()
  if (bridge === null) return null
  try {
    return await bridge.invoke('store:load')
  } catch (error) {
    console.error('store:load failed', error)
    return null
  }
}

/** Fire-and-forget: a failed write must never break the interaction. */
export function savePersistedState(patch: Partial<PersistedState>): void {
  const bridge = ipcBridge()
  if (bridge === null) return
  void bridge.invoke('store:save', patch).catch((error: unknown) => {
    console.error('store:save failed', error)
  })
}
