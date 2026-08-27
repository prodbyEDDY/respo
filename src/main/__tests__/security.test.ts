import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openExternal, fromPartition, setPermissionRequestHandler, setPermissionCheckHandler } =
  vi.hoisted(() => ({
    openExternal: vi.fn(() => Promise.resolve()),
    fromPartition: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn()
  }))

vi.mock('electron', () => ({
  shell: { openExternal },
  session: { fromPartition }
}))

import { DEVICE_PARTITION, installDevicePermissionHandlers, openExternalSafe } from '../security'

describe('openExternalSafe', () => {
  beforeEach(() => {
    openExternal.mockClear()
  })

  it.each([
    'https://example.com/',
    'http://localhost:5173/index.html',
    'https://example.com/a?b=c#d'
  ])('opens %s', (url) => {
    openExternalSafe(url)
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(new URL(url).href)
  })

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'smb://attacker.example/share/payload.exe',
    'ms-msdt:-id PCWDiagnostic',
    'javascript:alert(1)',
    'mailto:someone@example.com',
    'data:text/html,<script>alert(1)</script>',
    'not a url at all',
    ''
  ])('drops %s', (url) => {
    openExternalSafe(url)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('installDevicePermissionHandlers', () => {
  beforeEach(() => {
    fromPartition.mockReset()
    setPermissionRequestHandler.mockReset()
    setPermissionCheckHandler.mockReset()
    fromPartition.mockReturnValue({ setPermissionRequestHandler, setPermissionCheckHandler })
  })

  it('denies every request on the device partition', () => {
    installDevicePermissionHandlers()

    expect(fromPartition).toHaveBeenCalledWith(DEVICE_PARTITION)

    const request = setPermissionRequestHandler.mock.calls[0]?.[0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void
    const granted = vi.fn()
    request(null, 'media', granted)
    expect(granted).toHaveBeenCalledWith(false)
  })

  it('denies every check on the device partition', () => {
    installDevicePermissionHandlers()

    const check = setPermissionCheckHandler.mock.calls[0]?.[0] as () => boolean
    expect(check()).toBe(false)
  })
})
