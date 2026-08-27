import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { LoadStatePayload } from '@shared/ipc'

// `view-backend` reaches for Electron at import time; none of it is touched by
// `watchLoadState`, which is all this suite drives.
vi.mock('electron', () => ({
  View: class {},
  WebContentsView: class {},
  shell: { openExternal: vi.fn() },
  session: { fromPartition: vi.fn() }
}))

import { watchLoadState } from '../view-backend'

type Listener = (...args: unknown[]) => void

/** The slice of `WebContents` `watchLoadState` uses, driven by hand. */
function fakeWebContents(): {
  wc: WebContents
  emit: (event: string, ...args: unknown[]) => void
  url: string
  title: string
  loading: boolean
  destroyed: boolean
} {
  const listeners = new Map<string, Listener[]>()

  const state = {
    url: '',
    title: '',
    loading: false,
    destroyed: false,
    emit(event: string, ...args: unknown[]): void {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    wc: null as unknown as WebContents
  }

  state.wc = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return state.wc
    },
    isDestroyed: () => state.destroyed,
    isLoading: () => state.loading,
    getURL: () => state.url,
    getTitle: () => state.title
  } as unknown as WebContents

  return state
}

describe('watchLoadState', () => {
  let fake: ReturnType<typeof fakeWebContents>
  let reported: LoadStatePayload[]

  beforeEach(() => {
    fake = fakeWebContents()
    reported = []
    watchLoadState(fake.wc, 'iphone-15', (payload) => {
      reported.push(payload)
    })
  })

  it('reports a title update as loading while the page is still fetching', () => {
    fake.url = 'https://example.com/'
    fake.loading = true

    fake.emit('page-title-updated', null, 'Example')

    expect(reported).toEqual([
      { deviceId: 'iphone-15', state: 'loading', url: 'https://example.com/', title: 'Example' }
    ])
  })

  it('reports a title update as ready once the page has settled', () => {
    fake.url = 'https://example.com/'
    fake.loading = false

    fake.emit('page-title-updated', null, 'Example')

    expect(reported).toEqual([
      { deviceId: 'iphone-15', state: 'ready', url: 'https://example.com/', title: 'Example' }
    ])
  })

  it('reports a same-document navigation as loading while the page is still fetching', () => {
    fake.loading = true

    fake.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: true,
      url: 'https://example.com/#anchor'
    })

    expect(reported).toEqual([
      { deviceId: 'iphone-15', state: 'loading', url: 'https://example.com/#anchor' }
    ])
  })

  it('reports a same-document navigation as ready once the page has settled', () => {
    fake.loading = false

    fake.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: true,
      url: 'https://example.com/#anchor'
    })

    expect(reported).toEqual([
      { deviceId: 'iphone-15', state: 'ready', url: 'https://example.com/#anchor' }
    ])
  })

  it('keeps a failed navigation failed across a same-document change', () => {
    fake.emit('did-fail-load', null, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.example/', true)
    reported.length = 0
    fake.loading = false

    fake.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: true,
      url: 'https://nope.example/#x'
    })

    expect(reported).toEqual([
      { deviceId: 'iphone-15', state: 'failed', url: 'https://nope.example/#x' }
    ])
  })

  it('still reports a finished load as ready', () => {
    fake.url = 'https://example.com/'
    fake.title = 'Example'
    fake.loading = false

    fake.emit('did-finish-load')

    expect(reported).toEqual([
      { deviceId: 'iphone-15', state: 'ready', url: 'https://example.com/', title: 'Example' }
    ])
  })
})
