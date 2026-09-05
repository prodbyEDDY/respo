import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RespoApi } from '@shared/ipc'
import { hydrateDebug, useDebug } from '../debug'

const calls: { channel: string; args: unknown[] }[] = []

beforeEach(() => {
  calls.length = 0
  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(channel === 'debug:get' ? { outline: true } : undefined)
    },
    onMainEvent: () => () => undefined
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo
  useDebug.setState({ outline: false })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'respo')
})

describe('debug store', () => {
  it('toggles the outline and tells main once per change', () => {
    useDebug.getState().toggleOutline()
    useDebug.getState().setOutline(true)
    useDebug.getState().toggleOutline()
    expect(useDebug.getState().outline).toBe(false)
    expect(calls.map((c) => c.args)).toEqual([[true], [false]])
    expect(calls.every((c) => c.channel === 'debug:set-outline')).toBe(true)
  })

  it('takes what main says on start', async () => {
    hydrateDebug()
    await vi.waitFor(() => expect(useDebug.getState().outline).toBe(true))
    expect(calls).toEqual([{ channel: 'debug:get', args: [] }])
  })
})
