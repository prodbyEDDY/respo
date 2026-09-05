import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainEvent, RespoApi } from '@shared/ipc'
import { __resetScrollTrackingForTests, attachScrollBridge, useScroll } from '../scroll'

type InvokeCall = { channel: string; args: unknown[] }
const calls: InvokeCall[] = []
const listeners = new Set<(event: MainEvent) => void>()

beforeEach(() => {
  calls.length = 0
  listeners.clear()
  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(
        channel === 'scroll:track' && args[1] === true ? { deviceId: args[0], x: 3, y: 40 } : null
      )
    },
    onMainEvent: (callback: (event: MainEvent) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo
  useScroll.setState({ positions: {} })
  __resetScrollTrackingForTests()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'respo')
})

describe('scroll store', () => {
  it('asks main once however many reasons follow one device, and stops with the last', () => {
    const store = useScroll.getState()
    store.track('a', 'rulers')
    store.track('a', 'overlay')
    expect(calls).toEqual([{ channel: 'scroll:track', args: ['a', true] }])

    store.untrack('a', 'rulers')
    expect(calls).toHaveLength(1)
    store.untrack('a', 'overlay')
    expect(calls).toEqual([
      { channel: 'scroll:track', args: ['a', true] },
      { channel: 'scroll:track', args: ['a', false] }
    ])
  })

  it('seeds the position main answers with, and follows batched events after', async () => {
    useScroll.getState().track('a', 'rulers')
    await vi.waitFor(() => expect(useScroll.getState().positions['a']).toEqual({ x: 3, y: 40 }))

    const release = attachScrollBridge()
    for (const listener of listeners) {
      listener({ type: 'scroll-state', payload: [{ deviceId: 'a', x: 0, y: 900 }] })
    }
    expect(useScroll.getState().positions['a']).toEqual({ x: 0, y: 900 })
    release()
  })

  it('ignores an untrack for a reason it never had', () => {
    useScroll.getState().untrack('ghost', 'rulers')
    expect(calls).toEqual([])
  })

  it('forgets a device that left, listeners and position alike', () => {
    useScroll.getState().track('a', 'rulers')
    useScroll.getState().apply([{ deviceId: 'a', x: 0, y: 10 }])
    useScroll.getState().pruneDevices(['b'])
    expect(useScroll.getState().positions).toEqual({})
    // A device that comes back is a fresh request, not a leftover count.
    useScroll.getState().track('a', 'rulers')
    expect(calls.filter((c) => c.args[1] === true)).toHaveLength(2)
  })
})
