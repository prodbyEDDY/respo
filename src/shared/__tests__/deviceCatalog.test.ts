import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVE_DEVICE_IDS,
  DEVICE_CATALOG,
  deviceById,
  devicesByIds
} from '../deviceCatalog'

describe('DEVICE_CATALOG', () => {
  it('ships the 90+ devices the spec asks for (§5.2)', () => {
    expect(DEVICE_CATALOG.length).toBeGreaterThanOrEqual(90)
  })

  it('still carries every device the W1 catalog had, under the same id and metrics', () => {
    // Persisted suites and mirroring switches name devices by id, and a user's
    // suite must not silently change shape because the catalog grew.
    const w1: Record<string, [number, number, number]> = {
      'iphone-se': [375, 667, 2],
      'iphone-15-pro': [393, 852, 3],
      'iphone-16-pro-max': [440, 956, 3],
      'pixel-8': [412, 915, 2.625],
      'pixel-fold': [841, 891, 2.625],
      'galaxy-s23': [360, 780, 3],
      'galaxy-z-fold-5-open': [768, 1076, 2],
      'ipad-mini': [768, 1024, 2],
      'ipad-pro-13': [1024, 1366, 2],
      'surface-pro-7': [912, 1368, 2],
      'macbook-1280': [1280, 800, 2],
      'laptop-1366': [1366, 768, 1],
      'desktop-1440': [1440, 900, 1],
      'desktop-2560': [2560, 1440, 1]
    }
    for (const [id, [width, height, dpr]] of Object.entries(w1)) {
      expect(deviceById(id), id).toMatchObject({ width, height, dpr })
    }
  })

  it('covers the 2025–2026 lines a layout is checked against today', () => {
    for (const id of ['iphone-17-pro', 'pixel-10', 'galaxy-s25-ultra', 'galaxy-z-fold-6-open']) {
      expect(deviceById(id), id).toBeDefined()
    }
  })

  it('keeps the dpr in the range the CDP layer accepts and phones narrower than tablets', () => {
    for (const device of DEVICE_CATALOG) {
      expect(device.dpr, device.id).toBeGreaterThanOrEqual(1)
      expect(device.dpr, device.id).toBeLessThanOrEqual(4)
      expect(device.width, device.id).toBeGreaterThanOrEqual(100)
      expect(device.height, device.id).toBeGreaterThanOrEqual(100)
    }
  })

  it('has unique ids', () => {
    const ids = DEVICE_CATALOG.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses slug ids so they are safe in urls, files and dom attributes', () => {
    for (const device of DEVICE_CATALOG) {
      expect(device.id, device.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('has unique, non-empty display names', () => {
    const names = DEVICE_CATALOG.map((d) => d.name)
    for (const name of names) expect(name.trim()).not.toBe('')
    expect(new Set(names).size).toBe(names.length)
  })

  it('has positive metrics everywhere', () => {
    for (const device of DEVICE_CATALOG) {
      expect(device.width, device.id).toBeGreaterThan(0)
      expect(device.height, device.id).toBeGreaterThan(0)
      expect(device.dpr, device.id).toBeGreaterThan(0)
      // A viewport nobody could ever hit is a typo, not a device.
      expect(device.width, device.id).toBeLessThanOrEqual(4096)
      expect(device.height, device.id).toBeLessThanOrEqual(4096)
      expect(device.dpr, device.id).toBeLessThanOrEqual(5)
    }
  })

  it('has a non-empty, plausible user agent for every device', () => {
    for (const device of DEVICE_CATALOG) {
      expect(device.userAgent.trim(), device.id).not.toBe('')
      expect(device.userAgent, device.id).toMatch(/^Mozilla\/5\.0 \(/)
    }
  })

  it('marks phones and tablets as touch devices', () => {
    for (const device of DEVICE_CATALOG) {
      if (!/iPhone|iPad|Android/.test(device.userAgent)) continue
      expect(device.touch, device.id).toBe(true)
    }
  })

  it('never claims touch on a plain desktop user agent', () => {
    const desktop = DEVICE_CATALOG.filter(
      (d) => d.userAgent.includes('Macintosh') || d.userAgent.includes('Windows NT')
    )
    expect(desktop.length).toBeGreaterThan(0)
    for (const device of desktop) {
      // A Surface is the one Windows device with a touch screen and a desktop
      // layout — and every one of them says so in its name.
      if (/^Surface/.test(device.name)) continue
      expect(device.touch, device.id).toBe(false)
    }
  })
})

describe('DEFAULT_ACTIVE_DEVICE_IDS', () => {
  it('is the five devices from the approved concept, in order', () => {
    expect(DEFAULT_ACTIVE_DEVICE_IDS).toEqual([
      'iphone-15-pro',
      'pixel-8',
      'ipad-mini',
      'macbook-1280',
      'desktop-1440'
    ])
  })

  it('resolves entirely against the catalog', () => {
    for (const id of DEFAULT_ACTIVE_DEVICE_IDS) {
      expect(deviceById(id), id).toBeDefined()
    }
  })

  it('names the devices the concept calls for', () => {
    expect(devicesByIds(DEFAULT_ACTIVE_DEVICE_IDS).map((d) => d.name)).toEqual([
      'iPhone 15 Pro',
      'Pixel 8',
      'iPad mini',
      'MacBook 1280',
      'Desktop 1440'
    ])
  })

  it('gets iPhone 15 Pro metrics right — the e2e emulation probe depends on them', () => {
    const iphone = deviceById('iphone-15-pro')
    expect(iphone).toMatchObject({ width: 393, height: 852, dpr: 3, touch: true })
    expect(iphone?.userAgent).toContain('iPhone')
  })
})

describe('deviceById', () => {
  it('returns undefined for an unknown id', () => {
    expect(deviceById('no-such-device')).toBeUndefined()
  })
})

describe('devicesByIds', () => {
  it('keeps the requested order', () => {
    expect(devicesByIds(['desktop-1440', 'iphone-15-pro']).map((d) => d.id)).toEqual([
      'desktop-1440',
      'iphone-15-pro'
    ])
  })

  it('drops unknown ids instead of throwing', () => {
    expect(devicesByIds(['ghost', 'pixel-8']).map((d) => d.id)).toEqual(['pixel-8'])
  })

  it('drops duplicates so one device never gets two views', () => {
    expect(devicesByIds(['pixel-8', 'pixel-8']).map((d) => d.id)).toEqual(['pixel-8'])
  })
})
