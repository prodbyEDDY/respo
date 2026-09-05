import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RespoApi } from '@shared/ipc'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { __flushOverlaySaveForTests, useDesignOverlay } from '../design-overlay'

type InvokeCall = { channel: string; args: unknown[] }
const calls: InvokeCall[] = []
const ID = '0123456789abcdef'

/** A PNG-shaped file of `bytes` bytes, as an `<input type="file">` hands one over. */
function pngFile(bytes: number): File {
  return new File([new Uint8Array(bytes).fill(1)], 'mock.png', { type: 'image/png' })
}

beforeEach(() => {
  calls.length = 0
  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      if (channel === 'overlay:store-image') {
        return Promise.resolve({ ok: true, image: { id: ID, width: 393, height: 800, bytes: 64 } })
      }
      if (channel === 'overlay:image') {
        return Promise.resolve({
          id: ID,
          width: 393,
          height: 800,
          bytes: 64,
          dataUrl: 'data:image/png;base64,AA=='
        })
      }
      return Promise.resolve(undefined)
    },
    onMainEvent: () => () => undefined
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo
  useDesignOverlay.setState({ overlays: {}, images: {}, dialogDeviceId: null, error: null })
  savePersistedState.mockClear()
})

afterEach(() => {
  __flushOverlaySaveForTests()
  savePersistedState.mockClear()
  Reflect.deleteProperty(window, 'respo')
})

describe('design overlay store', () => {
  it('reads a picked file, sends it once, and keeps the answer as this size’s overlay', async () => {
    await useDesignOverlay.getState().chooseImage('393x852', pngFile(64))

    expect(calls.map((c) => c.channel)).toEqual(['overlay:store-image'])
    expect(String(calls[0]?.args[0])).toMatch(/^data:image\/png;base64,/)
    expect(useDesignOverlay.getState().overlays['393x852']).toEqual({
      imageId: ID,
      mode: 'overlay',
      opacity: 0.5,
      curtain: 0,
      enabled: true
    })
    expect(useDesignOverlay.getState().images[ID]?.width).toBe(393)
    __flushOverlaySaveForTests()
    expect(savePersistedState).toHaveBeenCalledWith({
      designOverlays: {
        '393x852': { imageId: ID, mode: 'overlay', opacity: 0.5, curtain: 0, enabled: true }
      }
    })
  })

  it('refuses a file past the cap before reading a byte of it', async () => {
    await useDesignOverlay.getState().chooseImage('393x852', pngFile(11 * 1024 * 1024))
    expect(calls).toEqual([])
    expect(useDesignOverlay.getState().error).toMatch(/up to 10 MB/)
    expect(useDesignOverlay.getState().overlays).toEqual({})
  })

  it('keeps the mode and opacity when the image is replaced', async () => {
    await useDesignOverlay.getState().chooseImage('393x852', pngFile(64))
    useDesignOverlay.getState().setMode('393x852', 'side-by-side')
    useDesignOverlay.getState().setOpacity('393x852', 0.8)
    await useDesignOverlay.getState().chooseImage('393x852', pngFile(65))
    expect(useDesignOverlay.getState().overlays['393x852']).toMatchObject({
      mode: 'side-by-side',
      opacity: 0.8,
      curtain: 0
    })
  })

  it('clamps the sliders and writes once they settle', () => {
    vi.useFakeTimers()
    try {
      useDesignOverlay.setState({
        overlays: {
          '393x852': { imageId: ID, mode: 'overlay', opacity: 0.5, curtain: 0, enabled: true }
        }
      })
      for (let i = 0; i <= 20; i += 1) useDesignOverlay.getState().setOpacity('393x852', i / 10)
      useDesignOverlay.getState().setCurtain('393x852', -1)
      expect(useDesignOverlay.getState().overlays['393x852']).toMatchObject({
        opacity: 1,
        curtain: 0
      })
      expect(savePersistedState).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(savePersistedState).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a size’s overlay, and the dialog state is its own', () => {
    useDesignOverlay.setState({
      overlays: {
        '393x852': { imageId: ID, mode: 'overlay', opacity: 0.5, curtain: 0, enabled: true }
      }
    })
    useDesignOverlay.getState().openDialog('pixel-8')
    expect(useDesignOverlay.getState().dialogDeviceId).toBe('pixel-8')
    useDesignOverlay.getState().remove('393x852')
    expect(useDesignOverlay.getState().overlays).toEqual({})
    useDesignOverlay.getState().closeDialog()
    expect(useDesignOverlay.getState().dialogDeviceId).toBeNull()
  })

  it('fetches an image once and remembers it', async () => {
    useDesignOverlay.getState().loadImage(ID)
    useDesignOverlay.getState().loadImage(ID)
    await vi.waitFor(() => expect(useDesignOverlay.getState().images[ID]?.dataUrl).toBeDefined())
    expect(calls.filter((c) => c.channel === 'overlay:image')).toHaveLength(1)
  })

  it('hydrate installs the document without writing it back', () => {
    useDesignOverlay.getState().hydrate({
      '393x852': { imageId: ID, mode: 'overlay', opacity: 1, curtain: 0.5, enabled: false }
    })
    __flushOverlaySaveForTests()
    expect(useDesignOverlay.getState().overlays['393x852']?.curtain).toBe(0.5)
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})
