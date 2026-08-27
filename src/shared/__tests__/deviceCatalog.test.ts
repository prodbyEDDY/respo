import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVE_DEVICE_IDS,
  DEVICE_CATALOG,
  deviceById,
  devicesByIds
} from '../deviceCatalog'

describe('DEVICE_CATALOG', () => {
  it('ships a usable number of devices', () => {
    expect(DEVICE_CATALOG.length).toBeGreaterThanOrEqual(25)
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
      if (device.id === 'surface-pro-7' || device.id === 'surface-pro-9') continue
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
