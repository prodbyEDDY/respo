import { describe, expect, it, vi } from 'vitest'
import {
  clearableOrigin,
  clearBrowsingData,
  clearsCache,
  COOKIE_STORAGES,
  SITE_STORAGES,
  storagesFor,
  type ClearableSession
} from '../clear-data'

function session(): ClearableSession & {
  clearStorageData: ReturnType<typeof vi.fn>
  clearCache: ReturnType<typeof vi.fn>
} {
  return {
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined)
  }
}

const PAGE = 'https://example.com/docs/page?q=1#top'

describe('storagesFor', () => {
  it('keeps cookies out of a storage clear', () => {
    expect(storagesFor('storage')).toEqual([...SITE_STORAGES])
    expect(storagesFor('storage')).not.toContain('cookies')
  })

  it('clears only cookies when that is what was asked', () => {
    expect(storagesFor('cookies')).toEqual([...COOKIE_STORAGES])
  })

  it('names no storage for the cache, which is the session s and not a site s', () => {
    expect(storagesFor('cache')).toBeNull()
  })

  it('names everything for "all"', () => {
    expect(storagesFor('all')).toEqual([...SITE_STORAGES, ...COOKIE_STORAGES])
  })
})

describe('clearsCache', () => {
  it.each([
    ['cache', true],
    ['all', true],
    ['storage', false],
    ['cookies', false]
  ] as const)('%s -> %s', (target, expected) => {
    expect(clearsCache(target)).toBe(expected)
  })
})

describe('clearableOrigin', () => {
  it('takes the origin of the page, not the page', () => {
    expect(clearableOrigin(PAGE)).toBe('https://example.com')
  })

  it('keeps the port, which is part of who a site is', () => {
    expect(clearableOrigin('http://localhost:5173/app')).toBe('http://localhost:5173')
  })

  it.each([
    ['a local file, which has no origin to speak of', 'file:///c:/page.html'],
    ['a canvas that has not been anywhere', null],
    ['an empty url', ''],
    ['something that is not a url', 'not a url']
  ])('has nothing to clear for %s', (_label, url) => {
    expect(clearableOrigin(url)).toBeNull()
  })
})

describe('clearBrowsingData', () => {
  it('clears one site s storage, and only that site s', async () => {
    const target = session()
    const result = await clearBrowsingData(target, 'storage', PAGE)

    expect(result).toEqual({ ok: true, target: 'storage', origin: 'https://example.com' })
    expect(target.clearStorageData).toHaveBeenCalledWith({
      origin: 'https://example.com',
      storages: [...SITE_STORAGES]
    })
    expect(target.clearCache).not.toHaveBeenCalled()
  })

  it('empties the cache without needing a site', async () => {
    const target = session()
    const result = await clearBrowsingData(target, 'cache', 'file:///c:/page.html')

    expect(result).toEqual({ ok: true, target: 'cache', origin: null })
    expect(target.clearCache).toHaveBeenCalledTimes(1)
    expect(target.clearStorageData).not.toHaveBeenCalled()
  })

  it('does both for "all"', async () => {
    const target = session()
    await clearBrowsingData(target, 'all', PAGE)

    expect(target.clearStorageData).toHaveBeenCalledTimes(1)
    expect(target.clearCache).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['storage', 'file:///c:/page.html'],
    ['cookies', null],
    ['all', 'not a url']
  ] as const)('refuses to clear %s when there is no site behind it', async (target, url) => {
    const spy = session()
    const result = await clearBrowsingData(spy, target, url)

    // "clear this site" must never quietly become "clear every site".
    expect(result).toEqual({ ok: false, reason: 'no-origin' })
    expect(spy.clearStorageData).not.toHaveBeenCalled()
    expect(spy.clearCache).not.toHaveBeenCalled()
  })

  it('reports a failure rather than claiming a clear that did not happen', async () => {
    const target = session()
    target.clearStorageData.mockRejectedValueOnce(new Error('busy'))

    expect(await clearBrowsingData(target, 'cookies', PAGE)).toEqual({
      ok: false,
      reason: 'failed',
      message: 'busy'
    })
  })
})
