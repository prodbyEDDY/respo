import { beforeEach, describe, expect, it } from 'vitest'
import type { CdpTarget } from '../cdp-controller'
import type { CssLayer } from '../diagnostics'
import { guidesCss, GuidesManager, type GuidesCdp } from '../guides'

function fakeCdp(): GuidesCdp & { measure: unknown; evaluations: number } {
  const cdp = {
    measure: { width: 393, height: 4000, x: 0, y: 120 } as unknown,
    evaluations: 0,
    async evaluate<T>(): Promise<T | null> {
      cdp.evaluations += 1
      return cdp.measure as T
    }
  }
  return cdp
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

describe('guidesCss', () => {
  it('draws one gradient per guide on a layer the size of the document', () => {
    const css = guidesCss({ h: [50], v: [100, 200] }, { width: 393, height: 4000 })
    expect(css).toContain('html::after')
    expect(css).toContain('width: 393px !important; height: 4000px !important')
    expect(css).toContain('linear-gradient(to right, transparent 100px')
    expect(css).toContain('linear-gradient(to right, transparent 200px')
    expect(css).toContain('linear-gradient(to bottom, transparent 50px')
    expect(css).toContain('pointer-events: none !important')
    expect(css).toContain('position: absolute !important')
  })
})

describe('GuidesManager', () => {
  let cdp: ReturnType<typeof fakeCdp>
  let css: ReturnType<typeof fakeCss>
  let manager: GuidesManager

  beforeEach(() => {
    cdp = fakeCdp()
    css = fakeCss()
    manager = new GuidesManager({ cdp })
    manager.registerDevice({ deviceId: 'a', target: target(), css })
  })

  it('measures the page and inserts the layer; an empty set removes it', async () => {
    await manager.set('a', { h: [], v: [100] })
    expect(cdp.evaluations).toBe(1)
    expect(css.inserted).toHaveLength(1)
    expect(css.inserted[0]).toContain('height: 4000px')
    expect(css.live.size).toBe(1)

    await manager.set('a', { h: [], v: [] })
    expect(css.live.size).toBe(0)
    expect(css.inserted).toHaveLength(1)
  })

  it('replaces the layer rather than stacking one per change', async () => {
    await manager.set('a', { h: [], v: [100] })
    await manager.set('a', { h: [], v: [150] })
    await manager.set('a', { h: [10], v: [150] })
    expect(css.inserted).toHaveLength(3)
    expect(css.live.size).toBe(1)
  })

  it('serialises a burst of changes so the last one wins and one layer remains', async () => {
    const changes = Array.from({ length: 20 }, (_v, i) => manager.set('a', { h: [], v: [i] }))
    await Promise.all(changes)
    expect(css.live.size).toBe(1)
    expect(css.inserted.at(-1)).toContain('transparent 19px')
  })

  it('puts the guides back on a new document, sized to that document', async () => {
    await manager.set('a', { h: [], v: [100] })
    cdp.measure = { width: 393, height: 9000, x: 0, y: 0 }
    manager.refresh('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(css.inserted).toHaveLength(2)
    expect(css.inserted[1]).toContain('height: 9000px')
  })

  it('does nothing on refresh when there are no guides', async () => {
    manager.refresh('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cdp.evaluations).toBe(0)
  })

  it('answers where the page is scrolled to', async () => {
    expect(await manager.scrollOf('a')).toEqual({ deviceId: 'a', x: 0, y: 120 })
    expect(await manager.scrollOf('ghost')).toBeNull()
  })

  it('refuses a junk measurement rather than sizing a layer by it', async () => {
    cdp.measure = { width: -1, height: 'tall' }
    await manager.set('a', { h: [], v: [100] })
    expect(css.inserted).toEqual([])
    expect(await manager.scrollOf('a')).toBeNull()
  })

  it('forgets a device that left', async () => {
    manager.retain(new Set())
    await manager.set('a', { h: [], v: [1] })
    expect(css.inserted).toEqual([])
    expect(manager.deviceIds()).toEqual([])
  })

  it('keeps a set that arrived before the view registered, and applies it then', async () => {
    const early = new GuidesManager({ cdp })
    await early.set('later', { h: [], v: [100] })
    expect(cdp.evaluations).toBe(0)

    const layer = fakeCss()
    early.registerDevice({ deviceId: 'later', target: target(), css: layer })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(layer.inserted).toHaveLength(1)
    expect(layer.inserted[0]).toContain('transparent 100px')
  })
})
