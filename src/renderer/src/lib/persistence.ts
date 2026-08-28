import type { RespoBackupV1 } from '@shared/backup'
import type { BackupExportResult, BackupImportResult } from '@shared/ipc'
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

/** What a backup round trip reports when there is no main process to ask. */
const NO_BRIDGE = 'Backups are only available in the Respo app.'

/**
 * Hand a backup to main, which puts a save dialog in front of the user and
 * writes the file. Awaited, unlike `savePersistedState`: the user is standing
 * in front of a dialog and is owed an answer.
 */
export async function exportBackupFile(backup: RespoBackupV1): Promise<BackupExportResult> {
  const bridge = ipcBridge()
  if (bridge === null) return { ok: false, reason: 'failed', message: NO_BRIDGE }
  try {
    return await bridge.invoke('backup:export', backup)
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error) }
  }
}

/** The other direction: main opens a file and validates it before we see it. */
export async function importBackupFile(): Promise<BackupImportResult> {
  const bridge = ipcBridge()
  if (bridge === null) return { ok: false, reason: 'failed', message: NO_BRIDGE }
  try {
    return await bridge.invoke('backup:import')
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error) }
  }
}
