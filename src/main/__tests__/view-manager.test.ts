import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LoadStatePayload, ViewRect } from '@shared/ipc'
import type { DeviceSpec, Rect } from '@shared/types'
import { ViewManager, type ReportLoadState, type ViewBackend } from '../view-manager'

type FakeView = {
  device: DeviceSpec
  /** What the backend would call when its `webContents` fires a load event. */
  report: ReportLoadState
  setBounds: Mock<(bounds: Rect) => void>
  setVisible: Mock<(visible: boolean) => void>
  setZoomFactor: Mock<(zoom: number) => void>
  applyDevice: Mock<(device: DeviceSpec) => void>
  loadUrl: Mock<(url: string) => void>
  goBack: Mock<() => void>
  goForward: Mock<() => void>
  reload: Mock<() => void>
  dispose: Mock<() => void>
}

type FakeBackend = ViewBackend & {
  views: Map<string, FakeView>
  order: string[]
  setCanvas: Mock<(viewport: Rect) => void>
  dispose: Mock<() => void>
}

function fakeBackend(clipsToCanvas = false): FakeBackend {
  const views = new Map<string, FakeView>()
  const order: string[] = []

  return {
    views,
    order,
    clipsToCanvas,
    create(device: DeviceSpec, report: ReportLoadState): FakeView {
      const view: FakeView = {
        device,
        report,
        setBounds: vi.fn<(bounds: Rect) => void>(),
        setVisible: vi.fn<(visible: boolean) => void>(),
        setZoomFactor: vi.fn<(zoom: number) => void>(),
        applyDevice: vi.fn<(device: DeviceSpec) => void>(),
        loadUrl: vi.fn<(url: string) => void>(),
        goBack: vi.fn<() => void>(),
        goForward: vi.fn<() => void>(),
        reload: vi.fn<() => void>(),
        dispose: vi.fn<() => void>()
      }
      views.set(device.id, view)
      order.push(device.id)
      return view
    },
    setCanvas: vi.fn<(viewport: Rect) => void>(),
    dispose: vi.fn<() => void>()
  }
}

function device(id: string): DeviceSpec {
  return {
    id,
    name: id.toUpperCase(),
    width: 390,
    height: 844,
    dpr: 3,
    userAgent: 'ua',
    touch: true
  }
}

function rect(deviceId: string, partial: Partial<ViewRect> = {}): ViewRect {
  return { deviceId, x: 0, y: 0, width: 390, height: 844, zoom: 1, ...partial }
}

const CANVAS: Rect = { x: 0, y: 0, width: 1200, height: 800 }

describe('ViewManager.syncDevices', () => {
  let backend: FakeBackend
  let manager: ViewManager

  beforeEach(() => {
    backend = fakeBackend()
    manager = new ViewManager(backend)
  })

  it('creates one view per device', () => {
    manager.syncDevices([device('a'), device('b')])

    expect(backend.order).toEqual(['a', 'b'])
  })

  it('reuses views for devices that are still present', () => {
    manager.syncDevices([device('a'), device('b')])
    manager.syncDevices([device('a'), device('b'), device('c')])

    expect(backend.order).toEqual(['a', 'b', 'c'])
    expect(backend.views.get('a')?.dispose).not.toHaveBeenCalled()
  })

  it('disposes views for devices that went away', () => {
    manager.syncDevices([device('a'), device('b')])
    const removed = backend.views.get('b')
    manager.syncDevices([device('a')])

    expect(removed?.dispose).toHaveBeenCalledTimes(1)
    expect(manager.deviceIds()).toEqual(['a'])
  })

  it('emulates a new device before the page is ever loaded', () => {
    manager.syncDevices([device('a')])
    const view = backend.views.get('a')

    expect(view?.applyDevice).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(view?.applyDevice.mock.invocationCallOrder[0]).toBeLessThan(
      view?.loadUrl.mock.invocationCallOrder[0] ?? Infinity
    )
  })

  it('re-emulates a device whose metrics changed', () => {
    manager.syncDevices([device('a')])
    manager.syncDevices([{ ...device('a'), width: 1440, dpr: 1 }])

    expect(backend.views.get('a')?.applyDevice).toHaveBeenCalledTimes(2)
  })

  it('does not re-emulate a device that only got renamed', () => {
    manager.syncDevices([device('a')])
    manager.syncDevices([{ ...device('a'), name: 'Renamed' }])

    expect(backend.views.get('a')?.applyDevice).toHaveBeenCalledTimes(1)
  })

  it('loads the current url into a device that joins later', () => {
    manager.syncDevices([device('a')])
    manager.navigateAll('example.com')
    manager.syncDevices([device('a'), device('b')])

    expect(backend.views.get('b')?.loadUrl).toHaveBeenCalledWith('https://example.com/')
    // The device that was already there is not reloaded behind the user's back.
    expect(backend.views.get('a')?.loadUrl).toHaveBeenCalledTimes(1)
  })
})

describe('ViewManager.applyLayout', () => {
  let backend: FakeBackend
  let manager: ViewManager

  beforeEach(() => {
    backend = fakeBackend()
    manager = new ViewManager(backend)
    manager.syncDevices([device('a'), device('b')])
  })

  it('applies window bounds to every device in one pass', () => {
    manager.applyLayout([rect('a', { x: 20, y: 60 }), rect('b', { x: 460, y: 500 })], {
      x: 0,
      y: 48,
      width: 1200,
      height: 800
    })

    expect(backend.setCanvas).toHaveBeenCalledWith({ x: 0, y: 48, width: 1200, height: 800 })
    expect(backend.views.get('a')?.setBounds).toHaveBeenCalledWith({
      x: 20,
      y: 60,
      width: 390,
      height: 844
    })
    expect(backend.views.get('b')?.setBounds).toHaveBeenCalledWith({
      x: 460,
      y: 500,
      width: 390,
      height: 844
    })
  })

  it('rebases bounds onto the canvas when the backend nests views in a layer', () => {
    const nested = fakeBackend(true)
    const nestedManager = new ViewManager(nested)
    nestedManager.syncDevices([device('a')])

    nestedManager.applyLayout([rect('a', { x: 20, y: 60 })], {
      x: 0,
      y: 48,
      width: 1200,
      height: 800
    })

    expect(nested.views.get('a')?.setBounds).toHaveBeenCalledWith({
      x: 20,
      y: 12,
      width: 390,
      height: 844
    })
  })

  it('skips redundant native calls when nothing moved', () => {
    const rects = [rect('a'), rect('b')]
    manager.applyLayout(rects, CANVAS)
    const before = backend.views.get('a')?.setBounds.mock.calls.length

    manager.applyLayout(
      rects.map((r) => ({ ...r })),
      CANVAS
    )

    expect(backend.views.get('a')?.setBounds.mock.calls.length).toBe(before)
    expect(backend.setCanvas).toHaveBeenCalledTimes(1)
  })

  it('re-applies bounds as soon as a frame actually moves', () => {
    manager.applyLayout([rect('a')], CANVAS)
    manager.applyLayout([rect('a', { y: 1 })], CANVAS)

    expect(backend.views.get('a')?.setBounds).toHaveBeenCalledTimes(2)
  })

  it('hides views scrolled fully out of the canvas and shows them again', () => {
    manager.applyLayout([rect('a', { y: -2000 }), rect('b')], CANVAS)

    expect(backend.views.get('a')?.setVisible).toHaveBeenLastCalledWith(false)
    expect(backend.views.get('b')?.setVisible).toHaveBeenLastCalledWith(true)

    manager.applyLayout([rect('a'), rect('b')], CANVAS)
    expect(backend.views.get('a')?.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('does not move a culled view, so offscreen frames cost nothing', () => {
    manager.applyLayout([rect('a', { y: -2000 })], CANVAS)

    expect(backend.views.get('a')?.setBounds).not.toHaveBeenCalled()
  })

  it('hides a device the renderer stopped reporting', () => {
    manager.applyLayout([rect('a'), rect('b')], CANVAS)
    manager.applyLayout([rect('a')], CANVAS)

    expect(backend.views.get('b')?.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('ignores rects for devices it does not own', () => {
    expect(() => manager.applyLayout([rect('ghost')], CANVAS)).not.toThrow()
  })

  it('sets the zoom factor only when the canvas zoom changes', () => {
    manager.applyLayout([rect('a', { zoom: 0.5 })], CANVAS)
    manager.applyLayout([rect('a', { zoom: 0.5, y: 1 })], CANVAS)
    manager.applyLayout([rect('a', { zoom: 1, y: 1 })], CANVAS)

    expect(backend.views.get('a')?.setZoomFactor.mock.calls).toEqual([[0.5], [1]])
  })

  /**
   * The zoom is not only how big a frame is painted: a desktop view's CDP
   * metrics override is divided by it, so a view that misses a zoom change is
   * left emulating the wrong viewport — and it is still a live page that
   * "screenshot every device" will photograph. Bounds may go stale off screen;
   * the zoom may not.
   */
  it('still tells a culled view about a zoom change', () => {
    manager.applyLayout([rect('a', { zoom: 0.5 })], CANVAS)
    // Scrolled far off the canvas: hidden, and not worth a `setBounds`.
    manager.applyLayout([rect('a', { zoom: 1, x: 9000 })], CANVAS)

    const view = backend.views.get('a')
    expect(view?.setZoomFactor.mock.calls).toEqual([[0.5], [1]])
    expect(view?.setVisible.mock.calls.at(-1)).toEqual([false])
  })
})

describe('ViewManager.navigateAll', () => {
  let backend: FakeBackend
  let manager: ViewManager

  beforeEach(() => {
    backend = fakeBackend()
    manager = new ViewManager(backend)
    manager.syncDevices([device('a'), device('b')])
  })

  it('normalizes the url once and loads it everywhere', () => {
    manager.navigateAll('  example.com/path  ')

    expect(backend.views.get('a')?.loadUrl).toHaveBeenCalledWith('https://example.com/path')
    expect(backend.views.get('b')?.loadUrl).toHaveBeenCalledWith('https://example.com/path')
  })

  it('rejects a url no view is allowed to load', () => {
    expect(() => manager.navigateAll('javascript:alert(1)')).toThrow(/url/i)
    expect(backend.views.get('a')?.loadUrl).not.toHaveBeenCalled()
  })
})

describe('ViewManager history controls', () => {
  let backend: FakeBackend
  let manager: ViewManager

  beforeEach(() => {
    backend = fakeBackend()
    manager = new ViewManager(backend)
    manager.syncDevices([device('a'), device('b')])
  })

  it('drives back, forward and reload on every view', () => {
    manager.goBack()
    manager.goForward()
    manager.reload()

    for (const id of ['a', 'b']) {
      expect(backend.views.get(id)?.goBack).toHaveBeenCalledTimes(1)
      expect(backend.views.get(id)?.goForward).toHaveBeenCalledTimes(1)
      expect(backend.views.get(id)?.reload).toHaveBeenCalledTimes(1)
    }
  })
})

describe('ViewManager load state', () => {
  function failure(deviceId: string): LoadStatePayload {
    return {
      deviceId,
      state: 'failed',
      url: 'https://nope.invalid/',
      errorCode: -105,
      errorDesc: 'ERR_NAME_NOT_RESOLVED'
    }
  }

  function loading(deviceId: string): LoadStatePayload {
    return { deviceId, state: 'loading', url: 'https://example.com/' }
  }

  it('forwards what a view reports to the sink, one payload at a time', () => {
    const onLoadState = vi.fn<ReportLoadState>()
    const backend = fakeBackend()
    const manager = new ViewManager(backend, { onLoadState })
    manager.syncDevices([device('a')])

    backend.views.get('a')?.report(loading('a'))

    expect(onLoadState).toHaveBeenCalledWith(loading('a'))
  })

  it('hides a view whose main frame failed, so the renderer overlay is visible', () => {
    const backend = fakeBackend()
    const manager = new ViewManager(backend)
    manager.syncDevices([device('a')])
    manager.applyLayout([rect('a')], CANVAS)
    const view = backend.views.get('a')
    expect(view?.setVisible).toHaveBeenLastCalledWith(true)

    view?.report(failure('a'))

    expect(view?.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('brings a failed view back as soon as it starts loading again', () => {
    const backend = fakeBackend()
    const manager = new ViewManager(backend)
    manager.syncDevices([device('a')])
    manager.applyLayout([rect('a')], CANVAS)
    const view = backend.views.get('a')

    view?.report(failure('a'))
    view?.report(loading('a'))

    expect(view?.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('keeps a failed view hidden even when a later layout frame wants it shown', () => {
    const backend = fakeBackend()
    const manager = new ViewManager(backend)
    manager.syncDevices([device('a')])
    manager.applyLayout([rect('a')], CANVAS)
    const view = backend.views.get('a')

    view?.report(failure('a'))
    manager.applyLayout([rect('a', { y: 4 })], CANVAS)

    expect(view?.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('clears the failed latch on an explicit navigation', () => {
    const backend = fakeBackend()
    const manager = new ViewManager(backend)
    manager.syncDevices([device('a')])
    manager.applyLayout([rect('a')], CANVAS)
    const view = backend.views.get('a')

    view?.report(failure('a'))
    manager.navigateAll('example.com')

    expect(view?.setVisible).toHaveBeenLastCalledWith(true)
  })
})

describe('ViewManager.destroy', () => {
  it('tears every view down and turns later calls into no-ops', () => {
    const backend = fakeBackend()
    const manager = new ViewManager(backend)
    manager.syncDevices([device('a')])
    const view = backend.views.get('a')

    manager.destroy()

    expect(view?.dispose).toHaveBeenCalledTimes(1)
    expect(backend.dispose).toHaveBeenCalledTimes(1)
    expect(manager.deviceIds()).toEqual([])

    manager.applyLayout([rect('a')], CANVAS)
    manager.syncDevices([device('a')])
    expect(backend.order).toEqual(['a'])
  })
})
