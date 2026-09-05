import { beforeEach, describe, expect, it } from 'vitest'
import type { CdpTarget } from '../cdp-controller'
import {
  DesignOverlayManager,
  imageIdOf,
  OVERLAY_IMAGES_KEY,
  overlayCss,
  type ImageDecoder
} from '../design-overlay'
import type { CssLayer } from '../diagnostics'
import type { PersistenceBackend } from '../persistence'

function fakeBackend(): PersistenceBackend & { data: Map<string, unknown>; writes: number } {
  const data = new Map<string, unknown>()
  const backend = {
    data,
    writes: 0,
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      backend.writes += 1
      data.set(key, JSON.parse(JSON.stringify(value)))
    }
  }
  return backend
}

function fakeCss(): CssLayer & { inserted: string[]; live: Set<string> } {
  let next = 1
  const layer = {
    inserted: [] as string[],
    live: new Set<string>(),
    async insert(css: string): Promise<string> {
      layer.inserted.push(css)
      const key = `css-${next++}`
      layer.live.add(key)
      return key
    },
    async remove(key: string): Promise<void> {
      layer.live.delete(key)
    }
  }
  return layer
}

let nextId = 1
function target(): CdpTarget {
  return {
    id: nextId++,
    isDestroyed: () => false,
    debugger: {
      isAttached: () => true,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: async () => ({}),
      on: () => undefined
    }
  }
}

/** A "png" of `bytes` bytes: the decoder here reads the size out of the first byte. */
function dataUrl(bytes: number, marker = 1): string {
  const buffer = Buffer.alloc(bytes, marker)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

const decode: ImageDecoder = (bytes) =>
  bytes[0] === 0 ? null : { width: 100 * bytes[0]!, height: 200 }

describe('overlayCss', () => {
  it('paints the image centred at the document origin with opacity and curtain', () => {
    const css = overlayCss(
      { width: 393, height: 800, dataUrl: 'data:image/png;base64,AAAA' },
      { imageId: 'x', opacity: 0.4, curtain: 0.25 }
    )
    expect(css).toContain('html::before')
    expect(css).toContain('left: 50% !important; transform: translateX(-50%)')
    expect(css).toContain('width: 393px !important; max-width: 100%')
    expect(css).toContain('aspect-ratio: 393 / 800')
    expect(css).toContain('url("data:image/png;base64,AAAA")')
    expect(css).toContain('opacity: 0.4 !important')
    expect(css).toContain('clip-path: inset(0 0 0 25%)')
    expect(css).toContain('pointer-events: none')
  })
})

describe('DesignOverlayManager — the image store', () => {
  let backend: ReturnType<typeof fakeBackend>
  let manager: DesignOverlayManager
  let clock: number

  beforeEach(() => {
    backend = fakeBackend()
    clock = 1000
    manager = new DesignOverlayManager({
      backend,
      decode,
      now: () => (clock += 1),
      maxStoreBytes: 1000
    })
  })

  it('keeps a decodable image under its content id, with its size', () => {
    const url = dataUrl(300)
    const result = manager.storeImage(url)
    expect(result).toEqual({
      ok: true,
      image: { id: imageIdOf(Buffer.alloc(300, 1)), width: 100, height: 200, bytes: 300 }
    })
    if (!result.ok) return
    expect(manager.image(result.image.id)).toMatchObject({ dataUrl: url, width: 100 })
    // Reading touches the LRU stamp in memory only: no store write per read.
    expect(backend.writes).toBe(1)
    expect(backend.data.has(OVERLAY_IMAGES_KEY)).toBe(true)
  })

  it('refuses what does not decode, and what is too large', () => {
    expect(manager.storeImage(dataUrl(10, 0))).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(manager.storeImage(dataUrl(11 * 1024 * 1024))).toMatchObject({
      ok: false,
      reason: 'too-large'
    })
    expect(manager.inventory()).toEqual([])
  })

  it('storing the same bytes twice is one image', () => {
    manager.storeImage(dataUrl(100))
    manager.storeImage(dataUrl(100))
    expect(manager.inventory()).toHaveLength(1)
  })

  it('drops the least recently used images once the store is past its cap', () => {
    const a = manager.storeImage(dataUrl(400, 1))
    const b = manager.storeImage(dataUrl(400, 2))
    if (!a.ok || !b.ok) throw new Error('store failed')
    // Touch `a`, so `b` is the one that has not been looked at.
    manager.image(a.image.id)

    const c = manager.storeImage(dataUrl(400, 3))
    if (!c.ok) throw new Error('store failed')

    const ids = manager.inventory().map((entry) => entry.id)
    expect(ids).toContain(a.image.id)
    expect(ids).toContain(c.image.id)
    expect(ids).not.toContain(b.image.id)
    expect(manager.image(b.image.id)).toBeNull()
  })

  it('never evicts the image just stored, even when it alone is past the cap', () => {
    manager.storeImage(dataUrl(400, 1))
    const big = manager.storeImage(dataUrl(900, 2))
    if (!big.ok) throw new Error('store failed')
    expect(manager.inventory().map((e) => e.id)).toEqual([big.image.id])
  })

  it('reads a store written by a previous session and ignores junk in it', () => {
    backend.data.set(OVERLAY_IMAGES_KEY, {
      '0123456789abcdef': {
        dataUrl: 'data:image/png;base64,AAAA',
        width: 1,
        height: 1,
        bytes: 3,
        usedAt: 1
      },
      junk: { dataUrl: 'nope' },
      fedcba9876543210: 'not an image'
    })
    const fresh = new DesignOverlayManager({ backend, decode })
    expect(fresh.inventory().map((e) => e.id)).toEqual(['0123456789abcdef'])
    expect(fresh.image('junk')).toBeNull()
  })
})

describe('DesignOverlayManager — the layer on the page', () => {
  let backend: ReturnType<typeof fakeBackend>
  let manager: DesignOverlayManager
  let css: ReturnType<typeof fakeCss>
  let id: string

  beforeEach(() => {
    backend = fakeBackend()
    manager = new DesignOverlayManager({ backend, decode })
    css = fakeCss()
    manager.registerDevice({ deviceId: 'a', target: target(), css })
    const stored = manager.storeImage(dataUrl(64))
    if (!stored.ok) throw new Error('store failed')
    id = stored.image.id
  })

  it('inserts one layer, replaces it on change, and removes it on null', async () => {
    await manager.set('a', { imageId: id, opacity: 0.5, curtain: 0 })
    expect(css.live.size).toBe(1)
    expect(css.inserted[0]).toContain('opacity: 0.5')

    await manager.set('a', { imageId: id, opacity: 0.8, curtain: 0.5 })
    expect(css.live.size).toBe(1)
    expect(css.inserted[1]).toContain('opacity: 0.8')
    expect(css.inserted[1]).toContain('inset(0 0 0 50%)')

    await manager.set('a', null)
    expect(css.live.size).toBe(0)
  })

  it('shows nothing for an image the store no longer has', async () => {
    await manager.set('a', { imageId: 'ffffffffffffffff', opacity: 1, curtain: 0 })
    expect(css.inserted).toEqual([])
  })

  it('puts the overlay back on a new document', async () => {
    await manager.set('a', { imageId: id, opacity: 0.5, curtain: 0 })
    manager.refresh('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(css.inserted).toHaveLength(2)
  })

  it('serialises a slider burst so one layer remains', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_v, i) =>
        manager.set('a', { imageId: id, opacity: i / 20, curtain: 0 })
      )
    )
    expect(css.live.size).toBe(1)
    expect(css.inserted.at(-1)).toContain('opacity: 0.95')
  })

  it('forgets a device that left', async () => {
    manager.retain(new Set())
    await manager.set('a', { imageId: id, opacity: 1, curtain: 0 })
    expect(css.inserted).toEqual([])
  })

  it('keeps an overlay that arrived before the view registered, and applies it then', async () => {
    const early = new DesignOverlayManager({ backend, decode })
    await early.set('later', { imageId: id, opacity: 1, curtain: 0 })
    const layer = fakeCss()
    early.registerDevice({ deviceId: 'later', target: target(), css: layer })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(layer.inserted).toHaveLength(1)
  })
})
