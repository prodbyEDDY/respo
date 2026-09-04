import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RespoApi } from '@shared/ipc'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { __flushGuidesSaveForTests, selectGuides, useGuides } from '../guides'

type InvokeCall = { channel: string; args: unknown[] }
const calls: InvokeCall[] = []
let scrollAnswer: { deviceId: string; x: number; y: number } | null = null

beforeEach(() => {
  calls.length = 0
  scrollAnswer = null
  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(channel === 'rulers:set' ? scrollAnswer : undefined)
    },
    onMainEvent: () => () => undefined
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo
  useGuides.setState({ rulers: {}, guides: {}, scroll: {} })
  savePersistedState.mockClear()
})

afterEach(() => {
  __flushGuidesSaveForTests()
  savePersistedState.mockClear()
  Reflect.deleteProperty(window, 'respo')
})

describe('guides store — rulers', () => {
  it('tells main when a device shows its rulers, and seeds the scroll offset it answers with', async () => {
    scrollAnswer = { deviceId: 'a', x: 0, y: 420 }
    useGuides.getState().setRulers('a', true)

    expect(useGuides.getState().rulers).toEqual({ a: true })
    expect(calls).toEqual([{ channel: 'rulers:set', args: ['a', true] }])
    await vi.waitFor(() => expect(useGuides.getState().scroll['a']).toEqual({ x: 0, y: 420 }))
  })

  it('toggles, and says nothing when the state is already what it is', () => {
    useGuides.getState().toggleRulers('a')
    useGuides.getState().setRulers('a', true)
    useGuides.getState().toggleRulers('a')
    expect(calls.map((c) => c.args)).toEqual([
      ['a', true],
      ['a', false]
    ])
    expect(useGuides.getState().rulers).toEqual({})
  })

  it('setRulersAll covers every device named', () => {
    useGuides.getState().setRulersAll(['a', 'b'], true)
    expect(useGuides.getState().rulers).toEqual({ a: true, b: true })
  })

  it('rulers are a view mode: never written to the document', () => {
    useGuides.getState().setRulers('a', true)
    __flushGuidesSaveForTests()
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('guides store — guides', () => {
  it('adds, moves and removes guides per viewport size, sorted and whole', () => {
    const store = useGuides.getState()
    store.addGuide('393x852', 'v', 200.4)
    store.addGuide('393x852', 'v', 100)
    store.addGuide('393x852', 'h', 50)
    expect(selectGuides(useGuides.getState(), '393x852')).toEqual({ h: [50], v: [100, 200] })

    useGuides.getState().moveGuide('393x852', 'v', 0, 150)
    expect(selectGuides(useGuides.getState(), '393x852').v).toEqual([150, 200])

    useGuides.getState().removeGuide('393x852', 'v', 1)
    useGuides.getState().removeGuide('393x852', 'h', 0)
    expect(selectGuides(useGuides.getState(), '393x852')).toEqual({ h: [], v: [150] })
    expect(selectGuides(useGuides.getState(), '1440x900')).toEqual({ h: [], v: [] })
  })

  it('drops the size from the document once its last guide goes', () => {
    useGuides.getState().addGuide('393x852', 'v', 10)
    useGuides.getState().removeGuide('393x852', 'v', 0)
    expect(useGuides.getState().guides).toEqual({})
  })

  it('writes the document once the changes have settled, not per change', () => {
    vi.useFakeTimers()
    try {
      const store = useGuides.getState()
      for (let x = 0; x < 30; x += 1) store.moveGuide('393x852', 'v', 0, x)
      store.addGuide('393x852', 'v', 30)
      expect(savePersistedState).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(savePersistedState).toHaveBeenCalledTimes(1)
      expect(savePersistedState).toHaveBeenCalledWith({ guides: { '393x852': { h: [], v: [30] } } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('hydrate installs the document without writing it back', () => {
    useGuides.getState().hydrate({ '393x852': { h: [1], v: [] } })
    __flushGuidesSaveForTests()
    expect(selectGuides(useGuides.getState(), '393x852').h).toEqual([1])
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('guides store — scroll and pruning', () => {
  it('installs a scroll batch per device', () => {
    useGuides.getState().applyScroll([
      { deviceId: 'a', x: 0, y: 10 },
      { deviceId: 'b', x: 5, y: 0 }
    ])
    expect(useGuides.getState().scroll).toEqual({ a: { x: 0, y: 10 }, b: { x: 5, y: 0 } })
  })

  it('forgets the rulers and scroll of a device that left, and keeps the guides', () => {
    useGuides.getState().setRulers('a', true)
    useGuides.getState().applyScroll([{ deviceId: 'a', x: 0, y: 10 }])
    useGuides.getState().addGuide('393x852', 'v', 10)

    useGuides.getState().pruneDevices(['b'])

    expect(useGuides.getState().rulers).toEqual({})
    expect(useGuides.getState().scroll).toEqual({})
    expect(useGuides.getState().guides['393x852']).toEqual({ h: [], v: [10] })
  })
})
