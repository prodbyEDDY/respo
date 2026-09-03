import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { RespoApi } from '@shared/ipc'
import { selectBookmarkFor, useBookmarks } from '../bookmarks'

type BridgeMock = { invoke: Mock<RespoApi['invoke']> }

function installBridge(): BridgeMock {
  const invoke = vi.fn(() => Promise.resolve(undefined)) as unknown as Mock<RespoApi['invoke']>
  const respo: RespoApi = {
    invoke: invoke as unknown as RespoApi['invoke'],
    onMainEvent: () => () => undefined
  }
  ;(window as Window & { respo?: RespoApi }).respo = respo
  return { invoke }
}

/** The `store:save` patches this store posted, newest last. */
function saved(bridge: BridgeMock): Record<string, unknown>[] {
  return bridge.invoke.mock.calls
    .filter((call) => call[0] === 'store:save')
    .map((call) => call[1] as Record<string, unknown>)
}

describe('bookmarks store', () => {
  let bridge: BridgeMock

  beforeEach(() => {
    bridge = installBridge()
    useBookmarks.setState({ items: [], homeUrl: '' })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'respo')
  })

  describe('add', () => {
    it('normalizes the url it keeps', () => {
      const bookmark = useBookmarks.getState().add('example.com', 'Example')

      expect(bookmark?.url).toBe('https://example.com/')
      expect(useBookmarks.getState().items).toHaveLength(1)
    })

    it('writes the whole slice back through main', () => {
      useBookmarks.getState().add('example.com', 'Example')

      expect(saved(bridge)).toEqual([{ bookmarks: useBookmarks.getState().items, homeUrl: '' }])
    })

    it('answers with the existing bookmark rather than saving a second one', () => {
      const first = useBookmarks.getState().add('https://example.com/', 'Example')
      const again = useBookmarks.getState().add('example.com', 'Renamed')

      expect(again).toEqual(first)
      expect(useBookmarks.getState().items).toHaveLength(1)
      // Nothing changed, so nothing was written the second time.
      expect(saved(bridge)).toHaveLength(1)
    })

    it('refuses a url no view could load', () => {
      expect(useBookmarks.getState().add('javascript:alert(1)', 'Bad')).toBeNull()
      expect(useBookmarks.getState().items).toEqual([])
    })

    it('keeps the newest first', () => {
      useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().add('https://b.test/', 'B')

      expect(useBookmarks.getState().items.map((item) => item.url)).toEqual([
        'https://b.test/',
        'https://a.test/'
      ])
    })

    it('gives every bookmark an id of its own', () => {
      useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().add('https://b.test/', 'B')
      const ids = useBookmarks.getState().items.map((item) => item.id)

      expect(new Set(ids).size).toBe(2)
    })
  })

  describe('toggle', () => {
    it('saves a page that is not saved', () => {
      expect(useBookmarks.getState().toggle('https://a.test/', 'A')).toBe('added')
      expect(useBookmarks.getState().items).toHaveLength(1)
    })

    it('unsaves one that is', () => {
      useBookmarks.getState().add('https://a.test/', 'A')

      expect(useBookmarks.getState().toggle('a.test', 'A')).toBe('removed')
      expect(useBookmarks.getState().items).toEqual([])
    })

    it('says nothing happened for a url it could not have saved', () => {
      expect(useBookmarks.getState().toggle('   ', '')).toBeNull()
    })
  })

  describe('update', () => {
    it('renames without touching the url', () => {
      const bookmark = useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().update(bookmark?.id ?? '', { title: 'Renamed' })

      expect(useBookmarks.getState().items[0]).toMatchObject({
        title: 'Renamed',
        url: 'https://a.test/'
      })
    })

    it('normalizes a new url', () => {
      const bookmark = useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().update(bookmark?.id ?? '', { url: 'b.test' })

      expect(useBookmarks.getState().items[0]?.url).toBe('https://b.test/')
    })

    it('keeps the last good url when the new one is a typo mid-sentence', () => {
      const bookmark = useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().update(bookmark?.id ?? '', { title: 'Kept', url: 'http://' })

      expect(useBookmarks.getState().items[0]).toMatchObject({
        title: 'Kept',
        url: 'https://a.test/'
      })
    })

    it('does nothing for an id it does not have', () => {
      useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().update('bm-nope', { title: 'x' })

      expect(useBookmarks.getState().items[0]?.title).toBe('A')
    })
  })

  describe('remove', () => {
    it('takes the bookmark out and says so on disk', () => {
      const bookmark = useBookmarks.getState().add('https://a.test/', 'A')
      useBookmarks.getState().remove(bookmark?.id ?? '')

      expect(useBookmarks.getState().items).toEqual([])
      expect(saved(bridge).at(-1)).toEqual({ bookmarks: [], homeUrl: '' })
    })

    it('writes nothing for an id it does not have', () => {
      useBookmarks.getState().remove('bm-nope')

      expect(saved(bridge)).toEqual([])
    })
  })

  describe('the home page', () => {
    it('normalizes what it keeps', () => {
      useBookmarks.getState().setHome('example.com')

      expect(useBookmarks.getState().homeUrl).toBe('https://example.com/')
      expect(saved(bridge).at(-1)).toMatchObject({ homeUrl: 'https://example.com/' })
    })

    it('is cleared by the empty string', () => {
      useBookmarks.getState().setHome('https://a.test/')
      useBookmarks.getState().setHome('')

      expect(useBookmarks.getState().homeUrl).toBe('')
    })

    it('refuses a url no view could load, rather than clearing itself', () => {
      useBookmarks.getState().setHome('https://a.test/')
      useBookmarks.getState().setHome('javascript:alert(1)')

      expect(useBookmarks.getState().homeUrl).toBe('https://a.test/')
    })

    it('writes nothing when it is already where it is being set', () => {
      useBookmarks.getState().setHome('https://a.test/')
      const before = saved(bridge).length
      useBookmarks.getState().setHome('a.test')

      expect(saved(bridge)).toHaveLength(before)
    })
  })

  describe('hydrate', () => {
    it('installs what main restored, and writes nothing back', () => {
      const bookmark = { id: 'bm-1', title: 'A', url: 'https://a.test/', addedAt: 1 }
      useBookmarks.getState().hydrate({ bookmarks: [bookmark], homeUrl: 'https://home.test/' })

      expect(useBookmarks.getState().items).toEqual([bookmark])
      expect(useBookmarks.getState().homeUrl).toBe('https://home.test/')
      expect(saved(bridge)).toEqual([])
    })
  })

  describe('selectBookmarkFor', () => {
    it('finds the page that is saved', () => {
      useBookmarks.getState().add('https://a.test/', 'A')

      expect(selectBookmarkFor(useBookmarks.getState(), 'https://a.test/')?.title).toBe('A')
    })

    it('answers null for one that is not', () => {
      expect(selectBookmarkFor(useBookmarks.getState(), 'https://b.test/')).toBeNull()
    })
  })

  it('degrades quietly outside Electron', () => {
    Reflect.deleteProperty(window, 'respo')

    expect(() => useBookmarks.getState().add('https://a.test/', 'A')).not.toThrow()
    expect(useBookmarks.getState().items).toHaveLength(1)
  })
})
