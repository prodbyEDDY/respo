import { describe, expect, it } from 'vitest'
import type { HistorySuggestion } from '@shared/ipc'
import type { Bookmark } from '@shared/persistence-types'
import { MAX_ADDRESS_SUGGESTIONS, MAX_BOOKMARK_SUGGESTIONS, mergeSuggestions } from '../suggestions'

function bookmark(url: string, title = url): Bookmark {
  return { id: `bm-${url}`, title, url, addedAt: 1 }
}

function visited(url: string, over: Partial<HistorySuggestion> = {}): HistorySuggestion {
  return { url, title: url, ts: 1, ...over }
}

describe('mergeSuggestions', () => {
  it('puts the pages the user kept first', () => {
    const merged = mergeSuggestions(
      '',
      [bookmark('https://saved.test/')],
      [visited('https://been.test/')]
    )

    expect(merged.map((item) => [item.kind, item.url])).toEqual([
      ['bookmark', 'https://saved.test/'],
      ['history', 'https://been.test/']
    ])
  })

  it('shows a page that is both saved and visited once, as a bookmark', () => {
    const merged = mergeSuggestions(
      '',
      [bookmark('https://a.test/')],
      [visited('https://a.test/'), visited('https://b.test/')]
    )

    expect(merged.map((item) => item.url)).toEqual(['https://a.test/', 'https://b.test/'])
    expect(merged[0]?.kind).toBe('bookmark')
  })

  it('filters bookmarks by url and title, case-insensitively', () => {
    const bookmarks = [bookmark('https://example.com/', 'Docs'), bookmark('https://other.test/')]

    expect(mergeSuggestions('DOC', bookmarks, []).map((item) => item.url)).toEqual([
      'https://example.com/'
    ])
    expect(mergeSuggestions('other', bookmarks, []).map((item) => item.url)).toEqual([
      'https://other.test/'
    ])
  })

  it('leaves history alone — main already filtered it', () => {
    // Whatever came back is the answer to the query that was asked.
    const merged = mergeSuggestions('nothing matches this', [], [visited('https://a.test/')])

    expect(merged.map((item) => item.url)).toEqual(['https://a.test/'])
  })

  it('never lets bookmarks push out the page from five minutes ago', () => {
    const bookmarks = Array.from({ length: 10 }, (_value, n) => bookmark(`https://s${n}.test/`))
    const merged = mergeSuggestions('', bookmarks, [visited('https://recent.test/')])

    expect(merged.filter((item) => item.kind === 'bookmark')).toHaveLength(MAX_BOOKMARK_SUGGESTIONS)
    expect(merged.at(-1)?.url).toBe('https://recent.test/')
  })

  it('stops at the number of rows the bar shows', () => {
    const history = Array.from({ length: 20 }, (_value, n) => visited(`https://h${n}.test/`))
    const merged = mergeSuggestions('', [bookmark('https://a.test/')], history)

    expect(merged).toHaveLength(MAX_ADDRESS_SUGGESTIONS)
  })

  it('carries the icon main cached, and only that', () => {
    const icon = 'data:image/png;base64,AAAA'
    const merged = mergeSuggestions('', [], [visited('https://a.test/', { favicon: icon })])

    expect(merged[0]).toEqual({
      kind: 'history',
      url: 'https://a.test/',
      title: 'https://a.test/',
      favicon: icon
    })
  })

  it('offers nothing when there is nothing to offer', () => {
    expect(mergeSuggestions('anything', [], [])).toEqual([])
  })

  it('honours a smaller limit', () => {
    const merged = mergeSuggestions(
      '',
      [bookmark('https://a.test/')],
      [visited('https://b.test/')],
      1
    )

    expect(merged).toHaveLength(1)
  })
})
