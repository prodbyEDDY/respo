import { describe, expect, it, vi } from 'vitest'

// `favicons` imports the size cap from `history`, which reaches its store
// through the module that pulls in electron-store. Nothing here touches either.
vi.mock('electron-store', () => ({ default: class {} }))
vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() } }))

import { createFaviconFetcher, encodeFavicon, MAX_FAVICON_BYTES } from '../favicons'

const PNG = new Uint8Array([137, 80, 78, 71])

function response(
  over: Partial<{ ok: boolean; type: string | null; length: string | null; body: Uint8Array }> = {}
): {
  ok: boolean
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
} {
  const { ok = true, type = 'image/png', length = null, body = PNG } = over
  return {
    ok,
    headers: {
      get: (name) => (name === 'content-type' ? type : name === 'content-length' ? length : null)
    },
    arrayBuffer: async () => {
      const copy = new ArrayBuffer(body.byteLength)
      new Uint8Array(copy).set(body)
      return copy
    }
  }
}

describe('encodeFavicon', () => {
  it('turns an image into a data url', () => {
    expect(encodeFavicon('image/png', PNG)).toBe(
      `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`
    )
  })

  it('ignores the parameters after the type', () => {
    expect(encodeFavicon('image/png; charset=binary', PNG)).toMatch(/^data:image\/png;base64,/)
  })

  it('accepts the two names an .ico goes by', () => {
    expect(encodeFavicon('image/x-icon', PNG)).not.toBeNull()
    expect(encodeFavicon('image/vnd.microsoft.icon', PNG)).not.toBeNull()
  })

  it('refuses SVG, which is a document and not a picture', () => {
    expect(encodeFavicon('image/svg+xml', PNG)).toBeNull()
  })

  it.each([
    ['a page pretending to be an icon', 'text/html'],
    ['no type at all', null],
    ['something that is not an image', 'application/octet-stream']
  ])('refuses %s', (_label, type) => {
    expect(encodeFavicon(type, PNG)).toBeNull()
  })

  it('refuses an empty body', () => {
    expect(encodeFavicon('image/png', new Uint8Array(0))).toBeNull()
  })

  it('refuses more bytes than an icon is worth', () => {
    expect(encodeFavicon('image/png', new Uint8Array(MAX_FAVICON_BYTES + 1))).toBeNull()
  })
})

describe('createFaviconFetcher', () => {
  it('downloads and encodes', async () => {
    const fetch = vi.fn(async () => response())
    const dataUrl = await createFaviconFetcher(fetch)('https://example.com/favicon.ico')

    expect(fetch).toHaveBeenCalledWith('https://example.com/favicon.ico')
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('gives up on a response that is not one', async () => {
    const fetch = vi.fn(async () => response({ ok: false }))

    expect(await createFaviconFetcher(fetch)('https://example.com/favicon.ico')).toBeNull()
  })

  it('refuses a body it was told would be huge, before reading it', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const fetch = vi.fn(async () => ({
      ...response({ length: String(MAX_FAVICON_BYTES + 1) }),
      arrayBuffer
    }))

    expect(await createFaviconFetcher(fetch)('https://example.com/favicon.ico')).toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('is quiet when a site will not serve its own icon', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })

    expect(await createFaviconFetcher(fetch)('https://example.com/favicon.ico')).toBeNull()
  })
})
