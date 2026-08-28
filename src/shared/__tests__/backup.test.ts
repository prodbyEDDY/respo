import { describe, expect, it } from 'vitest'
import {
  BACKUP_VERSION,
  mergeBackup,
  parseBackup,
  serializeBackup,
  validateBackup,
  type BackupSource,
  type RespoBackupV1
} from '../backup'
import { CUSTOM_ID_PREFIX } from '../custom-devices'
import type { DeviceSpec } from '../types'

function device(over: Partial<DeviceSpec> = {}): DeviceSpec {
  return {
    id: 'custom-my-phone',
    name: 'My phone',
    width: 400,
    height: 800,
    dpr: 2,
    userAgent: 'MyBot/1.0',
    touch: true,
    type: 'phone',
    rotatable: true,
    ...over
  }
}

function source(over: Partial<BackupSource> = {}): BackupSource {
  return {
    customDevices: [device()],
    suites: [{ id: 'default', name: 'Default', deviceIds: ['iphone-15-pro', 'custom-my-phone'] }],
    ...over
  }
}

/** An empty document — what "import on a clean state" starts from. */
const CLEAN: BackupSource = { customDevices: [], suites: [] }

describe('serializeBackup', () => {
  it('carries the devices and the suites, stamped with the version', () => {
    const backup = serializeBackup(source())

    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.customDevices).toEqual([device()])
    expect(backup.suites[0]?.deviceIds).toEqual(['iphone-15-pro', 'custom-my-phone'])
  })

  it('copies rather than aliases, so a later edit cannot rewrite a written file', () => {
    const state = source()
    const backup = serializeBackup(state)

    state.suites[0]?.deviceIds.push('pixel-8')
    expect(backup.suites[0]?.deviceIds).toEqual(['iphone-15-pro', 'custom-my-phone'])
    expect(backup.customDevices[0]).not.toBe(state.customDevices[0])
  })

  it('carries nothing else — a backup is devices and suites, not a session', () => {
    expect(Object.keys(serializeBackup(source())).sort()).toEqual([
      'customDevices',
      'suites',
      'version'
    ])
  })
})

describe('parseBackup', () => {
  it('round-trips what serializeBackup wrote', () => {
    const backup = serializeBackup(source())
    const result = parseBackup(JSON.stringify(backup))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup).toEqual(backup)
  })

  it('survives a round trip through pretty-printed JSON', () => {
    const backup = serializeBackup(source())
    const result = parseBackup(JSON.stringify(backup, null, 2))
    expect(result.ok && result.backup).toEqual(backup)
  })

  it('rejects broken JSON with a message rather than throwing', () => {
    const result = parseBackup('{ "version": 1, ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not valid json/i)
  })

  it('rejects a document that is not an object', () => {
    expect(parseBackup('[]').ok).toBe(false)
    expect(parseBackup('"hello"').ok).toBe(false)
    expect(parseBackup('null').ok).toBe(false)
  })

  it('rejects a version this build does not know', () => {
    const result = parseBackup(JSON.stringify({ ...serializeBackup(source()), version: 2 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/version/i)
  })

  it('rejects a missing or non-array collection', () => {
    expect(parseBackup(JSON.stringify({ version: 1, suites: [] })).ok).toBe(false)
    expect(parseBackup(JSON.stringify({ version: 1, customDevices: {}, suites: [] })).ok).toBe(
      false
    )
  })

  it('rejects a malformed device rather than importing half of it', () => {
    const backup = serializeBackup(source()) as unknown as Record<string, unknown>
    backup['customDevices'] = [{ ...device(), width: 0 }]

    const result = parseBackup(JSON.stringify(backup))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/width/)
  })

  it('rejects a device with a junk type', () => {
    const backup = serializeBackup(source()) as unknown as Record<string, unknown>
    backup['customDevices'] = [{ ...device(), type: 'watch' }]
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(false)
  })

  it('rejects a suite whose deviceIds are not strings', () => {
    const backup = serializeBackup(source()) as unknown as Record<string, unknown>
    backup['suites'] = [{ id: 'a', name: 'A', deviceIds: [7] }]
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(false)
  })

  it('rejects a document past the size guard rails', () => {
    const customDevices = Array.from({ length: 65 }, (_, i) =>
      device({ id: `custom-${i}`, name: `Device ${i}` })
    )
    expect(parseBackup(JSON.stringify({ version: 1, customDevices, suites: [] })).ok).toBe(false)
  })

  it('drops unknown top-level keys instead of failing on them', () => {
    const result = parseBackup(
      JSON.stringify({ ...serializeBackup(source()), exportedAt: '2026-01-01', extra: 1 })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup).not.toHaveProperty('exportedAt')
  })
})

describe('validateBackup', () => {
  it('accepts an already-parsed object — the door main validates at', () => {
    const backup = serializeBackup(source())
    expect(validateBackup(backup as unknown).ok).toBe(true)
  })

  it('refuses anything that is not a backup', () => {
    expect(validateBackup(undefined).ok).toBe(false)
    expect(validateBackup({ version: 1 }).ok).toBe(false)
  })
})

describe('mergeBackup', () => {
  it('restores a whole document onto a clean state', () => {
    const backup = serializeBackup(source())
    const merged = mergeBackup(CLEAN, backup)

    expect(merged.customDevices).toEqual([device()])
    expect(merged.suites).toEqual([
      { id: 'default', name: 'Default', deviceIds: ['iphone-15-pro', 'custom-my-phone'] }
    ])
    expect(merged.devicesAdded).toBe(1)
    expect(merged.suitesAdded).toBe(1)
  })

  it('overwrites a device of the same name, keeping the id the suites already name', () => {
    const current: BackupSource = {
      customDevices: [device({ id: 'custom-mine', name: 'My phone', width: 300 })],
      suites: [{ id: 'default', name: 'Default', deviceIds: ['custom-mine'] }]
    }
    const merged = mergeBackup(current, serializeBackup(source()))

    expect(merged.customDevices).toHaveLength(1)
    expect(merged.customDevices[0]).toMatchObject({ id: 'custom-mine', width: 400 })
    expect(merged.devicesReplaced).toBe(1)
    expect(merged.devicesAdded).toBe(0)
    // The suite that named the old id still resolves.
    expect(merged.suites[0]?.deviceIds).toContain('custom-mine')
  })

  it('matches names case- and whitespace-insensitively', () => {
    const current: BackupSource = {
      customDevices: [device({ id: 'custom-mine', name: '  MY PHONE ' })],
      suites: []
    }
    const merged = mergeBackup(current, serializeBackup(source()))
    expect(merged.customDevices).toHaveLength(1)
    expect(merged.devicesReplaced).toBe(1)
  })

  it('keeps a device of a different name and adds the imported one beside it', () => {
    const current: BackupSource = {
      customDevices: [device({ id: 'custom-other', name: 'Other' })],
      suites: []
    }
    const merged = mergeBackup(current, serializeBackup(source()))

    expect(merged.customDevices.map((d) => d.name)).toEqual(['Other', 'My phone'])
    expect(merged.devicesAdded).toBe(1)
  })

  it('gives an imported device a free id when its own is taken by another device', () => {
    const current: BackupSource = {
      customDevices: [device({ id: 'custom-my-phone', name: 'Something else' })],
      suites: []
    }
    const merged = mergeBackup(current, serializeBackup(source()))

    expect(merged.customDevices).toHaveLength(2)
    const added = merged.customDevices[1] as DeviceSpec
    expect(added.id).not.toBe('custom-my-phone')
    expect(added.id.startsWith(CUSTOM_ID_PREFIX)).toBe(true)
    // And the imported suite points at the id the device actually got.
    expect(merged.suites[0]?.deviceIds).toContain(added.id)
  })

  it('overwrites the membership of a suite of the same name', () => {
    const current: BackupSource = {
      customDevices: [],
      suites: [{ id: 'default', name: 'Default', deviceIds: ['pixel-8', 'ipad-mini'] }]
    }
    const merged = mergeBackup(current, serializeBackup(source()))

    expect(merged.suites).toHaveLength(1)
    expect(merged.suites[0]?.id).toBe('default')
    expect(merged.suites[0]?.deviceIds).toEqual(['iphone-15-pro', 'custom-my-phone'])
    expect(merged.suitesReplaced).toBe(1)
  })

  it('appends a suite whose name is new, with an id that does not collide', () => {
    const current: BackupSource = {
      customDevices: [],
      suites: [{ id: 'default', name: 'Existing', deviceIds: ['pixel-8'] }]
    }
    const merged = mergeBackup(current, serializeBackup(source()))

    expect(merged.suites.map((s) => s.name)).toEqual(['Existing', 'Default'])
    expect(merged.suites[1]?.id).not.toBe('default')
    expect(merged.suitesAdded).toBe(1)
  })

  it('drops device ids nothing answers to, and skips a suite left with none', () => {
    const backup: RespoBackupV1 = {
      version: 1,
      customDevices: [],
      suites: [
        { id: 'a', name: 'Mixed', deviceIds: ['pixel-8', 'ghost-device'] },
        { id: 'b', name: 'Empty', deviceIds: ['ghost-device'] }
      ]
    }
    const merged = mergeBackup(CLEAN, backup)

    expect(merged.suites).toHaveLength(1)
    expect(merged.suites[0]?.deviceIds).toEqual(['pixel-8'])
    expect(merged.suitesSkipped).toBe(1)
  })

  it('resolves a suite entry against a custom device the document already has', () => {
    const current: BackupSource = {
      customDevices: [device({ id: 'custom-kept', name: 'Kept' })],
      suites: []
    }
    const backup: RespoBackupV1 = {
      version: 1,
      customDevices: [],
      suites: [{ id: 'a', name: 'Uses kept', deviceIds: ['custom-kept'] }]
    }
    expect(mergeBackup(current, backup).suites[0]?.deviceIds).toEqual(['custom-kept'])
  })

  it('collapses duplicate ids inside an imported suite', () => {
    const backup: RespoBackupV1 = {
      version: 1,
      customDevices: [],
      suites: [{ id: 'a', name: 'Dupes', deviceIds: ['pixel-8', 'pixel-8'] }]
    }
    expect(mergeBackup(CLEAN, backup).suites[0]?.deviceIds).toEqual(['pixel-8'])
  })

  it('never grows the document past its caps', () => {
    const current: BackupSource = {
      customDevices: Array.from({ length: 64 }, (_, i) =>
        device({ id: `custom-have-${i}`, name: `Have ${i}` })
      ),
      suites: Array.from({ length: 64 }, (_, i) => ({
        id: `suite-${i}`,
        name: `Suite ${i}`,
        deviceIds: ['pixel-8']
      }))
    }
    const merged = mergeBackup(current, serializeBackup(source()))

    expect(merged.customDevices).toHaveLength(64)
    expect(merged.suites).toHaveLength(64)
    expect(merged.devicesAdded).toBe(0)
  })

  it('leaves the inputs untouched', () => {
    const current = source()
    const backup = serializeBackup(source({ suites: [] }))
    const before = JSON.stringify({ current, backup })

    mergeBackup(current, backup)
    expect(JSON.stringify({ current, backup })).toBe(before)
  })
})
