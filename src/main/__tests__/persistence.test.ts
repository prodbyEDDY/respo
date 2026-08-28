import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `persistence` pulls in electron-store for its production backend; nothing in
// this suite touches it — every test drives an in-memory backend instead.
vi.mock('electron-store', () => ({ default: class {} }))

import {
  BACKUP_KEY,
  SAVE_DEBOUNCE_MS,
  STATE_KEY,
  createPersistence,
  type PersistenceBackend
} from '../persistence'
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
