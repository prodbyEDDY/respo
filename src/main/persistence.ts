/**
 * The one place Respo touches durable storage (CLAUDE.md §7).
 *
 * The renderer never writes disk: it asks for the state once at boot and posts
 * patches afterwards. Main merges those onto the document it already holds and
 * writes the result behind a debounce, so dragging a zoom slider or flipping
 * through themes costs one file write instead of dozens.
 */

import { dialog, type BrowserWindow } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import ElectronStore from 'electron-store'
import { validateBackup } from '@shared/backup'
import type { BackupExportResult, BackupImportResult } from '@shared/ipc'
import {
  defaultPersistedState,
  mergePersistedState,
  migratePersistedState,
  type PersistedState
} from '@shared/persistence-types'

/** Top-level keys inside the store file. */
export const STATE_KEY = 'state'
/** Where a document this build could not read is parked instead of deleted. */
export const BACKUP_KEY = 'backup'

/** Long enough to swallow a burst of UI changes, short enough to survive a crash. */
export const SAVE_DEBOUNCE_MS = 300

/**
 * The slice of `electron-store` this module uses. Behind an interface so the
 * debounce and merge logic — the part that has to be correct — is unit-testable
 * without a real store or a real disk.
 */
export interface PersistenceBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type Persistence = {
  /** The current state. Cheap after the first call; never throws. */
  load(): PersistedState
  /** Merge a patch in. The write itself is debounced. */
  save(patch: Partial<PersistedState>): void
  /** Write anything pending right now — the app is going away. */
  flush(): void
  dispose(): void
}

export type PersistenceOptions = {
  debounceMs?: number
}

export function createPersistence(
  backend: PersistenceBackend,
  options: PersistenceOptions = {}
): Persistence {
  const debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS

  let current: PersistedState | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  let disposed = false

  const write = (state: PersistedState): void => {
    try {
      backend.set(STATE_KEY, state)
    } catch (error) {
      // A store we cannot write to is a degraded session, not a dead app: the
      // in-memory state stays authoritative for as long as this window lives.
      console.error('persistence: failed to write state', error)
    }
  }

  const read = (): PersistedState => {
    if (current !== null) return current

    let raw: unknown
    try {
      raw = backend.get(STATE_KEY)
    } catch (error) {
      console.error('persistence: failed to read state', error)
      raw = undefined
    }

    const { state, backup } = migratePersistedState(raw)
    if (backup !== null) {
      // Reset, but not erased: the user gets their old document back if they
      // ever need it, and the repaired one is written so the next boot is a
      // plain load rather than another migration.
      try {
        backend.set(BACKUP_KEY, backup)
      } catch (error) {
        console.error('persistence: failed to back up an unreadable state', error)
      }
      write(state)
    }

    current = state
    return current
  }

  const flushNow = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!dirty) return
    dirty = false
    write(current ?? defaultPersistedState())
  }

  return {
    load: read,

    save(patch): void {
      if (disposed) return
      current = mergePersistedState(read(), patch)
      dirty = true
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(flushNow, debounceMs)
      // A pending write must never keep the process alive on its own.
      timer.unref?.()
    },

    flush: flushNow,

    dispose(): void {
      if (disposed) return
      flushNow()
      disposed = true
    }
  }
}

/**
 * `electron-store` is ESM-only and electron-vite leaves runtime dependencies
 * external, so the CJS main bundle reaches it through `require()`. Node hands a
 * CJS caller the module *namespace* for an ESM package — the constructor is on
 * `.default`, not the object itself. Unwrap it once, and keep working if the
 * package is ever bundled (then it already is the constructor).
 */
const Store = ((ElectronStore as unknown as { default?: typeof ElectronStore }).default ??
  ElectronStore) as typeof ElectronStore

/** The production backend: one JSON file under the app's user-data directory. */
export function createElectronStoreBackend(): PersistenceBackend {
  const store = new Store<Record<string, unknown>>({ name: 'respo-state' })
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value)
  }
}

/**
 * The backend for design-overlay images: its own file. electron-store writes
 * a whole file per `set`, and the images are measured in megabytes — kept in
 * the settings file, every debounced settings save would rewrite them too.
 */
export function createOverlayStoreBackend(): PersistenceBackend {
  const store = new Store<Record<string, unknown>>({ name: 'respo-overlays' })
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value)
  }
}

/* ---------------------------------------------------------------------------
   Backup files.

   The other half of "the renderer never writes disk": import and export are the
   only places Respo touches a path the user chose, and both of them live here,
   behind a system dialog. The renderer sends a value and receives a value; it
   never learns a path it did not already see in the dialog.
   --------------------------------------------------------------------------- */

/** No plausible backup is anywhere near this. Enough to refuse a decoy. */
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024

const BACKUP_FILTERS = [
  { name: 'Respo backup', extensions: ['json'] },
  { name: 'All files', extensions: ['*'] }
]

/** `respo-devices-2026-08-28.json` — sortable, and obvious a year later. */
function defaultBackupName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `respo-devices-${stamp}.json`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The dialog and filesystem calls, behind an interface.
 *
 * Not for the production path — that is the default below — but so the failure
 * handling, which is the part that has to be right, is reachable by a unit test
 * without a real window or a real disk.
 */
export interface BackupFileIO {
  showSave(defaultName: string): Promise<string | null>
  showOpen(): Promise<string | null>
  read(path: string): Promise<string>
  size(path: string): Promise<number>
  write(path: string, contents: string): Promise<void>
}

export function createBackupFileIO(window: BrowserWindow | null): BackupFileIO {
  return {
    async showSave(defaultName) {
      const result = await (window === null
        ? dialog.showSaveDialog({ defaultPath: defaultName, filters: BACKUP_FILTERS })
        : dialog.showSaveDialog(window, { defaultPath: defaultName, filters: BACKUP_FILTERS }))
      return result.canceled || result.filePath === '' ? null : result.filePath
    },
    async showOpen() {
      const options = { properties: ['openFile' as const], filters: BACKUP_FILTERS }
      const result = await (window === null
        ? dialog.showOpenDialog(options)
        : dialog.showOpenDialog(window, options))
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    read: (path) => readFile(path, 'utf8'),
    size: async (path) => (await stat(path)).size,
    write: (path, contents) => writeFile(path, contents, 'utf8')
  }
}

/**
 * Write a backup the renderer handed over to a file the user picks.
 *
 * Validated here rather than trusted: `store:save` is not the only door into
 * this process, and a payload that reaches the disk is exactly the one that
 * must not be taken on the renderer's word (CLAUDE.md §6).
 */
export async function exportBackup(io: BackupFileIO, value: unknown): Promise<BackupExportResult> {
  const validated = validateBackup(value)
  if (!validated.ok) return { ok: false, reason: 'failed', message: validated.error }

  let path: string | null
  try {
    path = await io.showSave(defaultBackupName())
  } catch (error) {
    return { ok: false, reason: 'failed', message: messageOf(error) }
  }
  if (path === null) return { ok: false, reason: 'cancelled' }

  try {
    // Indented: a backup is a file a person may well open and read.
    await io.write(path, `${JSON.stringify(validated.backup, null, 2)}\n`)
  } catch (error) {
    return { ok: false, reason: 'failed', message: messageOf(error) }
  }

  return { ok: true, path }
}

/** Read a backup the user picks, refusing anything that is not one. */
export async function importBackup(io: BackupFileIO): Promise<BackupImportResult> {
  let path: string | null
  try {
    path = await io.showOpen()
  } catch (error) {
    return { ok: false, reason: 'failed', message: messageOf(error) }
  }
  if (path === null) return { ok: false, reason: 'cancelled' }

  let contents: string
  try {
    // Sized before it is read: the dialog accepts any file, and a multi-gigabyte
    // one picked by mistake must not be pulled into memory to find that out.
    const bytes = await io.size(path)
    if (bytes > MAX_BACKUP_BYTES) {
      return { ok: false, reason: 'invalid', message: 'That file is too large to be a backup.' }
    }
    contents = await io.read(path)
  } catch (error) {
    return { ok: false, reason: 'failed', message: messageOf(error) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return { ok: false, reason: 'invalid', message: 'The file is not valid JSON.' }
  }

  const validated = validateBackup(parsed)
  if (!validated.ok) return { ok: false, reason: 'invalid', message: validated.error }

  return { ok: true, backup: validated.backup, path }
}
