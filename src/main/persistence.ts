/**
 * The one place Respo touches durable storage (CLAUDE.md §7).
 *
 * The renderer never writes disk: it asks for the state once at boot and posts
 * patches afterwards. Main merges those onto the document it already holds and
 * writes the result behind a debounce, so dragging a zoom slider or flipping
 * through themes costs one file write instead of dozens.
 */

import ElectronStore from 'electron-store'
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
