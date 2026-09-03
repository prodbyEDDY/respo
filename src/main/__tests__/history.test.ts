import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `history` reaches its store through the same `PersistenceBackend` seam the
// settings document uses, and that module pulls in electron-store for its
// production backend. Nothing here touches either: every test drives an
// in-memory backend and an injected favicon fetcher.
vi.mock('electron-store', () => ({ default: class {} }))
vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() } }))

import {
  createHistory,
  FAVICON_CACHE_CAP,
  HISTORY_CAP,
  HISTORY_DEBOUNCE_MS,
  HISTORY_KEY,
  MAX_FAVICON_DATA_URL,
  MAX_SUGGESTIONS,
  originOf,
  sanitizeHistory
} from '../history'
import type { PersistenceBackend } from '../persistence'

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

/** A clock that only moves when a test says so. */
function clock(start = 1_000): { now: () => number; tick: (ms: number) => void } {
  let value = start
  return {
    now: () => value,
    tick: (ms) => {
      value += ms
    }
  }
}

const ICON = 'data:image/png;base64,AAAA'

/** Let a fetch and everything chained onto it settle. Real timers only. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createHistory', () => {
  it('records a visit and answers with it', () => {
    const history = createHistory(memoryBackend(), { now: clock().now })
    history.record('https://example.com/', 'Example')

    expect(history.query('')).toEqual([{ url: 'https://example.com/', title: 'Example', ts: 1000 }])
  })

  it('keeps the newest page first', () => {
    const history = createHistory(memoryBackend())
    history.record('https://a.test/', 'A')
    history.record('https://b.test/', 'B')

    expect(history.query('').map((row) => row.url)).toEqual(['https://b.test/', 'https://a.test/'])
  })

  it('treats a repeat of the newest page as the same visit', () => {
    const time = clock()
    const history = createHistory(memoryBackend(), { now: time.now })
    history.record('https://example.com/', '')
    time.tick(500)
    // The title arrives after the url it belongs to — one visit, not two.
    history.record('https://example.com/', 'Example')

    expect(history.query('')).toEqual([{ url: 'https://example.com/', title: 'Example', ts: 1500 }])
  })

  it('never lets a late empty title erase the one it already had', () => {
    const history = createHistory(memoryBackend())
    history.record('https://example.com/', 'Example')
    history.record('https://example.com/', '')

    expect(history.query('')[0]?.title).toBe('Example')
  })

  it('records the same page again once something else has been visited', () => {
    const history = createHistory(memoryBackend())
    history.record('https://a.test/', 'A')
    history.record('https://b.test/', 'B')
    history.record('https://a.test/', 'A')

    // Newest first, and the older visit to `a` is still behind `b`.
    expect(history.query('').map((row) => row.url)).toEqual([
      'https://a.test/',
      'https://b.test/',
      'https://a.test/'
    ])
    // ...but the suggestion list only offers it once.
    expect(history.query('a.test')).toHaveLength(1)
  })

  it.each([
    ['a scheme no view may load', 'javascript:alert(1)'],
    ['something that is not a url at all', 'not a url'],
    ['nothing', '']
  ])('refuses to record %s', (_label, url) => {
    const history = createHistory(memoryBackend())
    history.record(url, 'nope')

    expect(history.query('')).toEqual([])
  })

  it('records a local file, which is somewhere the user has been', () => {
    const history = createHistory(memoryBackend())
    history.record('file:///c:/pages/index.html', 'Local')

    expect(history.query('').map((row) => row.url)).toEqual(['file:///c:/pages/index.html'])
  })

  it('drops the oldest page once the cap is reached', () => {
    const history = createHistory(memoryBackend(), { cap: 3 })
    for (const n of [1, 2, 3, 4]) history.record(`https://example.com/${n}`, `${n}`)

    expect(history.query('', 8).map((row) => row.url)).toEqual([
      'https://example.com/4',
      'https://example.com/3',
      'https://example.com/2'
    ])
  })

  describe('query', () => {
    function seeded(): ReturnType<typeof createHistory> {
      const history = createHistory(memoryBackend())
      history.record('https://example.com/docs', 'Documentation')
      history.record('https://other.test/', 'Something else')
      return history
    }

    it('matches the url', () => {
      expect(
        seeded()
          .query('example')
          .map((row) => row.url)
      ).toEqual(['https://example.com/docs'])
    })

    it('matches the title, case-insensitively', () => {
      expect(
        seeded()
          .query('DOCUMENT')
          .map((row) => row.url)
      ).toEqual(['https://example.com/docs'])
    })

    it('answers an empty query with the most recent pages', () => {
      expect(seeded().query('')).toHaveLength(2)
    })

    it('never answers with more rows than the address bar shows', () => {
      const history = createHistory(memoryBackend())
      for (let n = 0; n < 30; n += 1) history.record(`https://example.com/${n}`, `${n}`)

      expect(history.query('', 100)).toHaveLength(MAX_SUGGESTIONS)
    })

    it('answers nothing when nothing matches', () => {
      expect(seeded().query('nowhere')).toEqual([])
    })
  })

  describe('favicons', () => {
    it('downloads one icon per origin and hands it back with every page there', async () => {
      const fetchFavicon = vi.fn(async () => ICON)
      const history = createHistory(memoryBackend(), { fetchFavicon })
      history.record('https://example.com/a', 'A')
      history.record('https://example.com/b', 'B')

      history.noteFavicon('https://example.com/a', ['https://example.com/favicon.ico'])
      history.noteFavicon('https://example.com/b', ['https://example.com/favicon.ico'])
      await settle()

      expect(fetchFavicon).toHaveBeenCalledTimes(1)
      expect(history.query('').map((row) => row.favicon)).toEqual([ICON, ICON])
    })

    it('never fetches an icon over a scheme it should not', () => {
      const fetchFavicon = vi.fn(async () => ICON)
      const history = createHistory(memoryBackend(), { fetchFavicon })
      history.noteFavicon('https://example.com/', ['file:///c:/evil.ico', 'data:image/png;base64,'])

      expect(fetchFavicon).not.toHaveBeenCalled()
    })

    it('ignores an answer that is not an image data url', async () => {
      const fetchFavicon = vi.fn(async () => 'https://tracker.test/pixel.gif')
      const history = createHistory(memoryBackend(), { fetchFavicon })
      history.record('https://example.com/', 'A')
      history.noteFavicon('https://example.com/', ['https://example.com/favicon.ico'])
      await settle()

      expect(fetchFavicon).toHaveBeenCalled()
      expect(history.query('')[0]?.favicon).toBeUndefined()
    })

    it('ignores an icon too large to be worth carrying', async () => {
      const huge = `data:image/png;base64,${'A'.repeat(MAX_FAVICON_DATA_URL)}`
      const fetchFavicon = vi.fn(async () => huge)
      const history = createHistory(memoryBackend(), { fetchFavicon })
      history.record('https://example.com/', 'A')
      history.noteFavicon('https://example.com/', ['https://example.com/favicon.ico'])
      await settle()

      expect(history.query('')[0]?.favicon).toBeUndefined()
    })

    it('has no origin to cache a local file under', () => {
      const fetchFavicon = vi.fn(async () => ICON)
      const history = createHistory(memoryBackend(), { fetchFavicon })
      history.noteFavicon('file:///c:/page.html', ['https://example.com/favicon.ico'])

      expect(fetchFavicon).not.toHaveBeenCalled()
    })

    it('evicts the oldest origin once the cache is full', async () => {
      const fetchFavicon = vi.fn(async () => ICON)
      const history = createHistory(memoryBackend(), { fetchFavicon })
      for (let n = 0; n <= FAVICON_CACHE_CAP; n += 1) {
        history.noteFavicon(`https://site-${n}.test/`, ['https://site.test/favicon.ico'])
      }
      await settle()
      expect(fetchFavicon).toHaveBeenCalledTimes(FAVICON_CACHE_CAP + 1)

      history.record('https://site-0.test/', 'first')
      expect(history.query('site-0')[0]?.favicon).toBeUndefined()
      history.record('https://site-1.test/', 'second')
      expect(history.query('site-1')[0]?.favicon).toBe(ICON)
    })
  })

  describe('persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('writes behind a debounce rather than per visit', () => {
      const backend = memoryBackend()
      const history = createHistory(backend, { debounceMs: HISTORY_DEBOUNCE_MS })
      history.record('https://a.test/', 'A')
      history.record('https://b.test/', 'B')
      expect(backend.writes).toBe(0)

      vi.advanceTimersByTime(HISTORY_DEBOUNCE_MS)
      expect(backend.writes).toBe(1)
      expect(backend.data[HISTORY_KEY]).toMatchObject({ entries: expect.any(Array) })
    })

    it('flushes what is pending when the app goes away', () => {
      const backend = memoryBackend()
      const history = createHistory(backend)
      history.record('https://a.test/', 'A')
      history.dispose()

      expect(backend.writes).toBe(1)
    })

    it('reads back what a previous session left', () => {
      const backend = memoryBackend({
        [HISTORY_KEY]: {
          entries: [{ url: 'https://example.com/', title: 'Example', ts: 5 }],
          favicons: { 'https://example.com': ICON }
        }
      })

      expect(createHistory(backend).query('')).toEqual([
        { url: 'https://example.com/', title: 'Example', ts: 5, favicon: ICON }
      ])
    })

    it('forgets everything at once, and does not wait to say so', () => {
      const backend = memoryBackend()
      const history = createHistory(backend)
      history.record('https://a.test/', 'A')
      history.clear()

      expect(history.query('')).toEqual([])
      // A promise to forget that is still sitting in a timer when the process
      // dies was not kept.
      expect(backend.data[HISTORY_KEY]).toEqual({ entries: [], favicons: {} })
    })

    it('keeps working when the store cannot be read', () => {
      const backend: PersistenceBackend = {
        get() {
          throw new Error('nope')
        },
        set: vi.fn()
      }
      const history = createHistory(backend)
      history.record('https://a.test/', 'A')

      expect(history.query('')).toHaveLength(1)
    })
  })
})

describe('sanitizeHistory', () => {
  it.each([
    ['not an object', 'nope'],
    ['an array', []],
    ['null', null]
  ])('reads %s as an empty history', (_label, raw) => {
    expect(sanitizeHistory(raw)).toEqual({ entries: [], favicons: {} })
  })

  it('drops only the junk rows', () => {
    const doc = sanitizeHistory({
      entries: [
        { url: 'https://good.test/', title: 'Good', ts: 1 },
        { url: 'javascript:alert(1)', title: 'Bad', ts: 2 },
        'not an entry',
        { title: 'no url', ts: 3 }
      ],
      favicons: {}
    })

    expect(doc.entries).toEqual([{ url: 'https://good.test/', title: 'Good', ts: 1 }])
  })

  it('repairs a row rather than dropping it when only its title is odd', () => {
    const doc = sanitizeHistory({ entries: [{ url: 'https://a.test/', title: 42, ts: 'soon' }] })

    expect(doc.entries).toEqual([{ url: 'https://a.test/', title: '', ts: 0 }])
  })

  it('refuses an icon that is not an image data url', () => {
    const doc = sanitizeHistory({
      entries: [],
      favicons: {
        'https://a.test': 'https://tracker.test/pixel.gif',
        'https://b.test': ICON
      }
    })

    expect(doc.favicons).toEqual({ 'https://b.test': ICON })
  })

  it('never reads back more entries than the cap allows', () => {
    const entries = Array.from({ length: HISTORY_CAP + 10 }, (_value, n) => ({
      url: `https://example.com/${n}`,
      title: '',
      ts: n
    }))

    expect(sanitizeHistory({ entries }).entries).toHaveLength(HISTORY_CAP)
  })
})

describe('originOf', () => {
  it.each([
    ['https://example.com/a?b#c', 'https://example.com'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['file:///c:/page.html', null],
    ['javascript:alert(1)', null],
    ['not a url', null]
  ])('reads %s as %s', (url, expected) => {
    expect(originOf(url)).toBe(expected)
  })
})
