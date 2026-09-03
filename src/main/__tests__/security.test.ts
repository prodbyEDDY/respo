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

type RequestHandler = (
  wc: { getURL(): string } | null,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl?: string; mediaTypes?: string[] }
) => void

type CheckHandler = (
  wc: unknown,
  permission: string,
  requestingOrigin: string,
  details: { mediaType?: string }
) => boolean

function handlers(): { request: RequestHandler; check: CheckHandler } {
  const request = setPermissionRequestHandler.mock.calls[0]?.[0] as RequestHandler | undefined
  const check = setPermissionCheckHandler.mock.calls[0]?.[0] as CheckHandler | undefined
  if (request === undefined || check === undefined) throw new Error('handlers were not installed')
  return { request, check }
}

describe('installDevicePermissionHandlers', () => {
  beforeEach(() => {
    fromPartition.mockReset()
    setPermissionRequestHandler.mockReset()
    setPermissionCheckHandler.mockReset()
    fromPartition.mockReturnValue({ setPermissionRequestHandler, setPermissionCheckHandler })
  })

  it('installs both handlers on the device partition', () => {
    installDevicePermissionHandlers()
    expect(fromPartition).toHaveBeenCalledWith(DEVICE_PARTITION)
    expect(setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(setPermissionCheckHandler).toHaveBeenCalledTimes(1)
  })

  it('denies everything when there is no policy to consult', () => {
    installDevicePermissionHandlers(null)

    const { request, check } = handlers()
    const granted = vi.fn()
    request(null, 'media', granted, { requestingUrl: 'https://a.dev/' })

    expect(granted).toHaveBeenCalledWith(false)
    expect(check(null, 'media', 'https://a.dev', {})).toBe(false)
  })

  it('hands a request to the policy with the origin Chromium reported', () => {
    const gate = { request: vi.fn(), check: vi.fn(() => true) }
    installDevicePermissionHandlers(gate)

    const callback = vi.fn()
    handlers().request({ getURL: () => 'https://page.dev/' }, 'media', callback, {
      requestingUrl: 'https://frame.dev/embed',
      mediaTypes: ['video']
    })

    // The *requesting* url, not the page the toolbar happens to show: a
    // third-party frame asks on its own behalf.
    expect(gate.request).toHaveBeenCalledWith(
      'https://frame.dev/embed',
      'media',
      ['video'],
      callback
    )
  })

  it('falls back to the view’s own url when no requesting url is reported', () => {
    const gate = { request: vi.fn(), check: vi.fn(() => false) }
    installDevicePermissionHandlers(gate)

    handlers().request({ getURL: () => 'https://page.dev/' }, 'geolocation', vi.fn(), {
      requestingUrl: ''
    })

    expect(gate.request).toHaveBeenCalledWith(
      'https://page.dev/',
      'geolocation',
      undefined,
      expect.any(Function)
    )
  })

  it('passes a check through, dropping Chromium’s “unknown” media type', () => {
    const gate = { request: vi.fn(), check: vi.fn(() => true) }
    installDevicePermissionHandlers(gate)

    expect(handlers().check(null, 'media', 'https://a.dev', { mediaType: 'unknown' })).toBe(true)
    expect(gate.check).toHaveBeenCalledWith('https://a.dev', 'media', undefined)

    handlers().check(null, 'media', 'https://a.dev', { mediaType: 'audio' })
    expect(gate.check).toHaveBeenLastCalledWith('https://a.dev', 'media', 'audio')
  })
})
