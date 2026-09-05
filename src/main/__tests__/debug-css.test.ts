import { beforeEach, describe, expect, it } from 'vitest'
import { DebugCssManager, OUTLINE_CSS } from '../debug-css'
import type { CssLayer } from '../diagnostics'

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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('DebugCssManager', () => {
  let manager: DebugCssManager
  let a: ReturnType<typeof fakeCss>
  let b: ReturnType<typeof fakeCss>

  beforeEach(() => {
    manager = new DebugCssManager()
    a = fakeCss()
    b = fakeCss()
    manager.registerDevice({ deviceId: 'a', css: a })
    manager.registerDevice({ deviceId: 'b', css: b })
  })

  it('starts off and puts nothing on anyone', () => {
    expect(manager.state()).toEqual({ outline: false })
    expect(a.inserted).toEqual([])
  })

  it('outlines every device at once, and takes it off without a trace', async () => {
    manager.setOutline(true)
    await settle()
    expect(a.inserted).toEqual([OUTLINE_CSS])
    expect(b.inserted).toEqual([OUTLINE_CSS])
    expect(a.live.size).toBe(1)

    manager.setOutline(false)
    await settle()
    expect(a.live.size).toBe(0)
    expect(b.live.size).toBe(0)
    expect(a.inserted).toHaveLength(1)
  })

  it('is idempotent', async () => {
    manager.setOutline(true)
    manager.setOutline(true)
    await settle()
    expect(a.inserted).toHaveLength(1)
  })

  it('a device that joins while on gets the layer, and a new document gets it back', async () => {
    manager.setOutline(true)
    const c = fakeCss()
    manager.registerDevice({ deviceId: 'c', css: c })
    await settle()
    expect(c.inserted).toHaveLength(1)

    // The navigation takes the old document, and its layer, with it.
    c.live.clear()
    manager.refresh('c')
    await settle()
    expect(c.inserted).toHaveLength(2)
    expect(c.live.size).toBe(1)
  })

  it('does nothing on refresh while off, and forgets a device that left', async () => {
    manager.refresh('a')
    await settle()
    expect(a.inserted).toEqual([])
    manager.retain(new Set(['b']))
    manager.setOutline(true)
    await settle()
    expect(a.inserted).toEqual([])
    expect(b.inserted).toHaveLength(1)
  })
})
