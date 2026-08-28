import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `persistence` pulls in electron-store for its production backend; nothing in
// this suite touches it — every test drives an in-memory backend instead. Same
// for `electron`: the backup helpers take their dialog and disk access as an
// injected `BackupFileIO`, so the real one is never constructed here.
vi.mock('electron-store', () => ({ default: class {} }))
vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() } }))

import {
  BACKUP_KEY,
  MAX_BACKUP_BYTES,
  SAVE_DEBOUNCE_MS,
  STATE_KEY,
  createPersistence,
  exportBackup,
  importBackup,
  type BackupFileIO,
  type PersistenceBackend
} from '../persistence'
import { serializeBackup } from '@shared/backup'
import { defaultPersistedState, SCHEMA_VERSION } from '@shared/persistence-types'

function memoryBackend(seed: Record<string, unknown> = {}): PersistenceBackend & {
  data: Record<string, unknown>
  writes: number
} {
  const data: Record<string, unknown> = { ...seed }
  return {
    data,
    writes: 0,
    get(key) {
      return data[key]
    },
    set(key, value) {
      this.writes += 1
      data[key] = value
    }
  }
}

describe('createPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads defaults from an empty store', () => {
    const backend = memoryBackend()
    expect(createPersistence(backend).load()).toEqual(defaultPersistedState())
  })

  it('loads what was stored', () => {
    const stored = defaultPersistedState()
    stored.ui.theme = 'dark'
    const backend = memoryBackend({ [STATE_KEY]: stored })
    expect(createPersistence(backend).load().ui.theme).toBe('dark')
  })

  it('parks an unreadable state under the backup key and starts from defaults', () => {
    const junk = { schemaVersion: 99, nonsense: true }
    const backend = memoryBackend({ [STATE_KEY]: junk })

    expect(createPersistence(backend).load()).toEqual(defaultPersistedState())
    expect(backend.data[BACKUP_KEY]).toEqual(junk)
    // The repaired state is written back, so the next boot is a plain load.
    expect(backend.data[STATE_KEY]).toEqual(defaultPersistedState())
  })

  it('does not write a backup for a store that was simply empty', () => {
    const backend = memoryBackend()
    createPersistence(backend).load()
    expect(backend.data[BACKUP_KEY]).toBeUndefined()
  })

  it('debounces writes: a burst of saves costs one write', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()
    const writesAfterLoad = backend.writes

    persistence.save({ ui: { theme: 'dark' } })
    persistence.save({ activeSuiteId: 'a' })
    persistence.save({ activeSuiteId: 'b' })

    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1)
    expect(backend.writes).toBe(writesAfterLoad)

    vi.advanceTimersByTime(1)
    expect(backend.writes).toBe(writesAfterLoad + 1)
    expect(backend.data[STATE_KEY]).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      activeSuiteId: 'b',
      ui: { theme: 'dark' }
    })
  })

  it('restarts the debounce window on every save', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()
    const before = backend.writes

    persistence.save({ activeSuiteId: 'a' })
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 10)
    persistence.save({ activeSuiteId: 'b' })
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 10)
    expect(backend.writes).toBe(before)

    vi.advanceTimersByTime(10)
    expect(backend.writes).toBe(before + 1)
  })

  it('serves the pending state to a reader before it has been flushed', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()
    persistence.save({ ui: { theme: 'light' } })
    expect(persistence.load().ui.theme).toBe('light')
  })

  it('flush writes immediately and clears the pending timer', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()
    const before = backend.writes

    persistence.save({ activeSuiteId: 'now' })
    persistence.flush()
    expect(backend.writes).toBe(before + 1)
    expect(backend.data[STATE_KEY]).toMatchObject({ activeSuiteId: 'now' })

    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    expect(backend.writes).toBe(before + 1)
  })

  it('flush is a no-op when nothing is pending', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()
    const before = backend.writes
    persistence.flush()
    expect(backend.writes).toBe(before)
  })

  it('dispose flushes the last patch — quitting must not lose it', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()

    persistence.save({ ui: { theme: 'dark' } })
    persistence.dispose()
    expect(backend.data[STATE_KEY]).toMatchObject({ ui: { theme: 'dark' } })

    // And nothing fires afterwards.
    const after = backend.writes
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2)
    expect(backend.writes).toBe(after)
  })

  it('ignores saves once disposed', () => {
    const backend = memoryBackend()
    const persistence = createPersistence(backend)
    persistence.load()
    persistence.dispose()

    const after = backend.writes
    persistence.save({ activeSuiteId: 'late' })
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2)
    expect(backend.writes).toBe(after)
  })

  it('saving before an explicit load still merges onto the stored state', () => {
    const stored = defaultPersistedState()
    stored.suites.push({ id: 'stored', name: 'Stored', deviceIds: ['pixel-8'] })
    stored.activeSuiteId = 'stored'
    const backend = memoryBackend({ [STATE_KEY]: stored })
    const persistence = createPersistence(backend)

    persistence.save({ ui: { theme: 'dark' } })
    persistence.flush()
    expect(backend.data[STATE_KEY]).toMatchObject({
      activeSuiteId: 'stored',
      ui: { theme: 'dark' }
    })
  })

  it('survives a backend that throws on write', () => {
    const backend: PersistenceBackend = {
      get: () => undefined,
      set: () => {
        throw new Error('disk full')
      }
    }
    const persistence = createPersistence(backend)
    expect(() => persistence.load()).not.toThrow()
    persistence.save({ activeSuiteId: 'x' })
    expect(() => persistence.flush()).not.toThrow()
  })
})

/** A document worth exporting: one device of the user's own, in one suite. */
function sampleBackup(): ReturnType<typeof serializeBackup> {
  return serializeBackup({
    customDevices: [
      {
        id: 'custom-kiosk',
        name: 'Kiosk',
        width: 1080,
        height: 1920,
        dpr: 1,
        userAgent: 'KioskOS',
        touch: true,
        type: 'tablet',
        rotatable: false
      }
    ],
    suites: [{ id: 'default', name: 'Default', deviceIds: ['custom-kiosk', 'iphone-15-pro'] }]
  })
}

function fileIO(over: Partial<BackupFileIO> = {}): BackupFileIO & { written: string | null } {
  const io = {
    written: null as string | null,
    showSave: async () => 'C:/tmp/backup.json',
    showOpen: async () => 'C:/tmp/backup.json',
    read: async () => JSON.stringify(sampleBackup()),
    size: async () => 512,
    write: async (_path: string, contents: string) => {
      io.written = contents
    },
    ...over
  }
  return io
}

describe('exportBackup', () => {
  it('writes the document as readable JSON to the chosen path', async () => {
    const io = fileIO()
    const result = await exportBackup(io, sampleBackup())

    expect(result).toEqual({ ok: true, path: 'C:/tmp/backup.json' })
    expect(io.written).not.toBeNull()
    expect(JSON.parse(io.written as string)).toEqual(sampleBackup())
    // Indented, because a person may well open the file.
    expect(io.written).toContain('\n  "version": 1')
  })

  it('offers a dated file name', async () => {
    let offered = ''
    await exportBackup(
      fileIO({
        showSave: async (name) => {
          offered = name
          return 'C:/tmp/backup.json'
        }
      }),
      sampleBackup()
    )
    expect(offered).toMatch(/^respo-devices-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('reports a dismissed dialog as cancelled, not as a failure', async () => {
    const io = fileIO({ showSave: async () => null })
    expect(await exportBackup(io, sampleBackup())).toEqual({ ok: false, reason: 'cancelled' })
    expect(io.written).toBeNull()
  })

  it('refuses a payload that is not a backup — the renderer is not trusted', async () => {
    const io = fileIO()
    const result = await exportBackup(io, { version: 1, customDevices: 'nope', suites: [] })

    expect(result.ok).toBe(false)
    expect(io.written).toBeNull()
  })

  it('reports a failed write instead of throwing at the renderer', async () => {
    const result = await exportBackup(
      fileIO({
        write: async () => {
          throw new Error('disk full')
        }
      }),
      sampleBackup()
    )
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'disk full' })
  })
})

describe('importBackup', () => {
  it('returns the validated document', async () => {
    const result = await importBackup(fileIO())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup).toEqual(sampleBackup())
    expect(result.path).toBe('C:/tmp/backup.json')
  })

  it('reports a dismissed dialog as cancelled', async () => {
    expect(await importBackup(fileIO({ showOpen: async () => null }))).toEqual({
      ok: false,
      reason: 'cancelled'
    })
  })

  it('refuses a file that is not JSON', async () => {
    const result = await importBackup(fileIO({ read: async () => 'not json at all' }))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('refuses a JSON file that is not a backup', async () => {
    const result = await importBackup(fileIO({ read: async () => '{"hello":"world"}' }))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('refuses a file too large to be a backup, without reading it', async () => {
    let read = false
    const result = await importBackup(
      fileIO({
        size: async () => MAX_BACKUP_BYTES + 1,
        read: async () => {
          read = true
          return ''
        }
      })
    )
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(read).toBe(false)
  })

  it('reports an unreadable file as a failure', async () => {
    const result = await importBackup(
      fileIO({
        read: async () => {
          throw new Error('permission denied')
        }
      })
    )
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'permission denied' })
  })
})
