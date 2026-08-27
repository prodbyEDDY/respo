import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, isIpcChannel, MAIN_EVENT_CHANNEL, normalizeUrl } from '../ipc'

describe('normalizeUrl', () => {
  it('adds https by default', () =>
    expect(normalizeUrl('example.com')).toBe('https://example.com/'))
  it('adds http for localhost', () =>
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000/'))
  it('keeps explicit scheme', () => expect(normalizeUrl('http://a.dev')).toBe('http://a.dev/'))
  it('allows file:', () => expect(normalizeUrl('file:///C:/x.html')).toBe('file:///C:/x.html'))
  it('rejects javascript:', () => expect(normalizeUrl('javascript:alert(1)')).toBeNull())

  it('adds http for 127.0.0.1 with a port', () =>
    expect(normalizeUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/'))
  it('keeps paths and query strings', () =>
    expect(normalizeUrl('example.com/a/b?c=1#d')).toBe('https://example.com/a/b?c=1#d'))
  it('trims surrounding whitespace', () =>
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com/'))

  it.each(['', '   ', 'data:text/html,<h1>x', 'vbscript:msgbox', 'about:blank', 'ftp://a.dev/x'])(
    'rejects %j',
    (input) => {
      expect(normalizeUrl(input)).toBeNull()
    }
  )
})

describe('ipc channel registry', () => {
  it('lists every invoke channel', () => {
    expect(IPC_CHANNELS).toContain('app:get-version')
    expect(IPC_CHANNELS).toContain('views:set-layout')
    expect(IPC_CHANNELS).toContain('nav:navigate')
  })

  it('recognises known channels only', () => {
    expect(isIpcChannel('app:get-version')).toBe(true)
    expect(isIpcChannel('app:rm-rf')).toBe(false)
    expect(isIpcChannel('toString')).toBe(false)
    expect(isIpcChannel(42)).toBe(false)
  })

  it('keeps main->renderer events off the invoke map', () => {
    expect(isIpcChannel(MAIN_EVENT_CHANNEL)).toBe(false)
  })
})
