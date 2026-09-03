import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { HistorySuggestion, RespoApi } from '@shared/ipc'
import { SUGGEST_DEBOUNCE_MS, useHistory } from '../history'

type BridgeMock = { invoke: Mock<RespoApi['invoke']>; answer: (rows: HistorySuggestion[]) => void }

/**
 * A bridge whose `history:query` answers are resolved by the test, so the "a
 * slow answer must not overwrite a newer one" case can actually be staged.
 */
function installBridge(): BridgeMock {
  const pending: ((rows: HistorySuggestion[]) => void)[] = []

  const invoke = vi.fn((channel: string) => {
    if (channel !== 'history:query') return Promise.resolve(undefined)
    return new Promise((resolve) => pending.push(resolve as (rows: HistorySuggestion[]) => void))
  }) as unknown as Mock<RespoApi['invoke']>

  const respo: RespoApi = {
    invoke: invoke as unknown as RespoApi['invoke'],
    onMainEvent: () => () => undefined
  }
  ;(window as Window & { respo?: RespoApi }).respo = respo

  return {
    invoke,
    answer: (rows) => {
      const resolve = pending.shift()
      resolve?.(rows)
    }
  }
}

function row(url: string): HistorySuggestion {
  return { url, title: url, ts: 1 }
}

/** Let a resolved answer land in the store. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('history store', () => {
  let bridge: BridgeMock

  beforeEach(() => {
    vi.useFakeTimers()
    bridge = installBridge()
    useHistory.setState({ query: '', suggestions: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'respo')
  })

  it('takes the query straight away and asks a beat later', () => {
    useHistory.getState().setQuery('exa')

    expect(useHistory.getState().query).toBe('exa')
    // A keystroke is not a message (CLAUDE.md §4).
    expect(bridge.invoke).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)
    expect(bridge.invoke).toHaveBeenCalledWith('history:query', 'exa')
  })

  it('spends one round trip on a word typed at speed', () => {
    for (const query of ['e', 'ex', 'exa', 'exam']) useHistory.getState().setQuery(query)
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)

    expect(bridge.invoke).toHaveBeenCalledTimes(1)
    expect(bridge.invoke).toHaveBeenCalledWith('history:query', 'exam')
  })

  it('installs the answer', async () => {
    useHistory.getState().setQuery('exa')
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)
    bridge.answer([row('https://example.com/')])
    await settle()

    expect(useHistory.getState().suggestions).toEqual([row('https://example.com/')])
  })

  it('never lets a slow answer overwrite a newer one', async () => {
    useHistory.getState().setQuery('a')
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)
    useHistory.getState().setQuery('b')
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)

    // The second question is answered first, then the first one arrives late.
    bridge.answer([row('https://a.test/')])
    await settle()
    bridge.answer([row('https://b.test/')])
    await settle()

    expect(useHistory.getState().suggestions).toEqual([row('https://b.test/')])
  })

  it('asks now when the address bar takes focus', () => {
    useHistory.getState().refresh('')

    expect(bridge.invoke).toHaveBeenCalledWith('history:query', '')
  })

  it('cancels a question the closing list will never see answered', async () => {
    useHistory.getState().setQuery('exa')
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)
    useHistory.getState().reset()
    bridge.answer([row('https://example.com/')])
    await settle()

    expect(useHistory.getState().suggestions).toEqual([])
    expect(useHistory.getState().query).toBe('')
  })

  it('never sends a question the list was closed before asking', () => {
    useHistory.getState().setQuery('exa')
    useHistory.getState().reset()
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)

    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('forgets everything and stops offering it', () => {
    useHistory.setState({ suggestions: [row('https://a.test/')] })
    useHistory.getState().clear()

    expect(useHistory.getState().suggestions).toEqual([])
    expect(bridge.invoke).toHaveBeenCalledWith('history:clear')
  })

  it('degrades quietly outside Electron', () => {
    Reflect.deleteProperty(window, 'respo')

    expect(() => {
      useHistory.getState().refresh('exa')
      useHistory.getState().clear()
    }).not.toThrow()
  })
})
