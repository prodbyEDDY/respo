import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle } }))

import { registerHandler, __resetHandlersForTests } from '../ipc'

describe('registerHandler', () => {
  beforeEach(() => {
    handle.mockClear()
    __resetHandlersForTests()
  })

  it('registers a known channel on ipcMain', () => {
    registerHandler('app:get-version', () => '1.2.3')
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0]?.[0]).toBe('app:get-version')
  })

  it('rejects a channel missing from the shared map', () => {
    // @ts-expect-error — the point of the guard is unsafe callers at runtime.
    expect(() => registerHandler('app:rm-rf', () => undefined)).toThrow(/unknown ipc channel/i)
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects a duplicate registration', () => {
    registerHandler('nav:navigate', () => undefined)
    expect(() => registerHandler('nav:navigate', () => undefined)).toThrow(/already registered/i)
    expect(handle).toHaveBeenCalledTimes(1)
  })
})
