import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InputEventPayload } from '@shared/ipc'
import type { CdpTarget, KeyInput, MouseInput, SyncDispatcher } from '../cdp-controller'
import { SyncEngine } from '../sync-engine'

type MouseCall = { id: number; params: MouseInput }
type KeyCall = { id: number; params: KeyInput }
type ScrollCall = { id: number; ratioX: number; ratioY: number }

function fakeTarget(id: number): CdpTarget {
  return {
    id,
    debugger: {
      isAttached: () => true,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: () => Promise.resolve(undefined),
      on: () => undefined
    },
    isDestroyed: () => false
  }
}

function harness(): {
  engine: SyncEngine
  mouse: MouseCall[]
  keys: KeyCall[]
  scrolls: ScrollCall[]
  runFrame: () => void
  frames: number
} {
  const mouse: MouseCall[] = []
  const keys: KeyCall[] = []
  const scrolls: ScrollCall[] = []
  let pending: (() => void) | null = null

  const dispatcher: SyncDispatcher = {
    dispatchMouse: (target, params) => mouse.push({ id: target.id, params }),
    dispatchKey: (target, params) => keys.push({ id: target.id, params }),
    scrollToRatio: (target, ratioX, ratioY) => scrolls.push({ id: target.id, ratioX, ratioY })
  }

  const state = {
    frames: 0,
    engine: new SyncEngine(dispatcher, {
      scheduleFrame: (task) => {
        state.frames += 1
        pending = task
        return () => {
          pending = null
        }
      }
    }),
    mouse,
    keys,
    scrolls,
    runFrame(): void {
      const task = pending
      pending = null
      task?.()
    }
  }

  // Three devices: a phone lead and two followers of different sizes. The
  // `mobile` flag is the emulation each one is under, and it decides how a
  // dispatched coordinate is read (see `SyncDeviceRegistration.mobile`).
  state.engine.registerDevice({
    deviceId: 'phone',
    target: fakeTarget(1),
    width: 400,
    height: 800,
    mobile: true
  })
  state.engine.registerDevice({
    deviceId: 'tablet',
    target: fakeTarget(2),
    width: 800,
    height: 1000,
    mobile: true
  })
  state.engine.registerDevice({
    deviceId: 'desktop',
    target: fakeTarget(3),
    width: 1920,
    height: 1080,
    mobile: false
  })
  state.engine.setLead('phone')

  return state
}

const scroll = (ratioY: number): InputEventPayload => ({ kind: 'scroll', ratioX: 0, ratioY })

const mouseDown = (xNorm: number, yNorm: number): InputEventPayload => ({
  kind: 'mouse',
  type: 'down',
  xNorm,
  yNorm,
  button: 'left'
})

describe('SyncEngine', () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
  })

  describe('coordinate denormalization', () => {
    it('scales a normalized position into each follower’s own viewport', () => {
      h.engine.handleInput(1, [mouseDown(0.5, 0.25)])

      const pressed = h.mouse.filter((c) => c.params.type === 'mousePressed')
      expect(pressed.map((c) => c.id).sort()).toEqual([2, 3])
      expect(pressed.find((c) => c.id === 2)?.params).toMatchObject({ x: 400, y: 250 })
      expect(pressed.find((c) => c.id === 3)?.params).toMatchObject({ x: 960, y: 270 })
    })

    it('rounds to whole device pixels', () => {
      h.engine.handleInput(1, [mouseDown(0.3333, 0.6667)])
      const onTablet = h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')
      expect(onTablet?.params.x).toBe(Math.round(0.3333 * 800))
      expect(onTablet?.params.y).toBe(Math.round(0.6667 * 1000))
    })

    it('clamps a position outside the viewport instead of dispatching off-screen', () => {
      h.engine.handleInput(1, [mouseDown(1.4, -0.2)])
      const onTablet = h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')
      expect(onTablet?.params).toMatchObject({ x: 800, y: 0 })
    })

    /**
     * A coordinate goes to a follower in the page's own CSS pixels whatever
     * the canvas zoom. A mobile view is painted small by its override's
     * `scale`, and Chromium maps a dispatched coordinate through that scale
     * itself; a desktop view's page zoom is cancelled by its pre-divided
     * override. `e2e/sync.spec.ts` (a mirrored click at 50%) is the proof; this
     * is the arithmetic.
     */
    it('hands a mobile follower the page’s own pixels at any zoom', () => {
      h.engine.setZoom('tablet', 0.5)
      h.engine.handleInput(1, [mouseDown(0.5, 0.25)])

      const onTablet = h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')
      // 0.5 × 800 device pixels, and nothing about the zoom.
      expect(onTablet?.params).toMatchObject({ x: 400, y: 250 })

      // The unzoomed follower is untouched by its neighbour's zoom.
      const onDesktop = h.mouse.find((c) => c.id === 3 && c.params.type === 'mousePressed')
      expect(onDesktop?.params).toMatchObject({ x: 960, y: 270 })
    })

    /**
     * The same rule for a desktop view: its metrics override is divided by the
     * zoom so the page still lays out at the device's own width, and the
     * coordinate goes in as page CSS pixels (`e2e/sync.spec.ts`, which mirrors
     * onto a desktop device at 50%).
     */
    it('leaves a desktop follower’s coordinates in the page’s own pixels', () => {
      h.engine.setZoom('desktop', 0.5)
      h.engine.handleInput(1, [mouseDown(0.5, 0.25)])

      const onDesktop = h.mouse.find((c) => c.id === 3 && c.params.type === 'mousePressed')
      expect(onDesktop?.params).toMatchObject({ x: 960, y: 270 })
    })

    it('takes the zoom a view registers with, and ignores a nonsensical one', () => {
      h.engine.registerDevice({
        deviceId: 'zoomed',
        target: fakeTarget(8),
        width: 400,
        height: 800,
        zoom: 2,
        mobile: true
      })
      h.engine.setZoom('desktop', 0)
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])

      // The zoom is bookkeeping now, and a coordinate is the page's own.
      expect(
        h.mouse.find((c) => c.id === 8 && c.params.type === 'mousePressed')?.params
      ).toMatchObject({ x: 200, y: 400 })
      // A zero (or a NaN) is not a scale; the coordinate stays as it was.
      expect(
        h.mouse.find((c) => c.id === 3 && c.params.type === 'mousePressed')?.params
      ).toMatchObject({ x: 960, y: 540 })
    })

    it('keeps the zoom when the same device registers a new view', () => {
      h.engine.setZoom('tablet', 0.5)
      h.engine.registerDevice({
        deviceId: 'tablet',
        target: fakeTarget(2),
        width: 800,
        height: 1000,
        mobile: true
      })

      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(
        h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')?.params
      ).toMatchObject({ x: 400, y: 500 })
    })

    it('follows a device that was resized', () => {
      h.engine.updateDevice('tablet', { width: 1000, height: 500 })
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      const onTablet = h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')
      expect(onTablet?.params).toMatchObject({ x: 500, y: 250 })
    })

    it('follows a device that stopped being mobile', () => {
      // Editing a custom device's type rewrites its user agent, and the tablet
      // above is now emulated as a desktop. Either way the coordinate is the
      // page's own; the flag is kept as the record of which space a view is in
      // (see `SyncDeviceRegistration.mobile`).
      h.engine.setZoom('tablet', 0.5)
      h.engine.updateDevice('tablet', { width: 800, height: 1000, mobile: false })

      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(
        h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')?.params
      ).toMatchObject({ x: 400, y: 500 })
    })

    it('leaves the mobile flag alone when an update does not mention it', () => {
      h.engine.setZoom('tablet', 0.5)
      h.engine.updateDevice('tablet', { width: 800, height: 1000 })

      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      // Still mobile, still the page's own pixels.
      expect(
        h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')?.params
      ).toMatchObject({ x: 400, y: 500 })
    })
  })

  describe('routing', () => {
    it('never echoes an event back at its source', () => {
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.some((c) => c.id === 1)).toBe(false)
    })

    it('ignores input from a view that is not the lead', () => {
      h.engine.handleInput(2, [mouseDown(0.5, 0.5), scroll(0.5)])
      h.runFrame()
      expect(h.mouse).toHaveLength(0)
      expect(h.scrolls).toHaveLength(0)
    })

    it('ignores input from a webContents it does not know', () => {
      h.engine.handleInput(99, [mouseDown(0.5, 0.5)])
      expect(h.mouse).toHaveLength(0)
    })

    it('drops everything while there is no lead', () => {
      h.engine.setLead(null)
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse).toHaveLength(0)
    })

    it('follows the lead when it moves to another device', () => {
      h.engine.setLead('desktop')
      h.engine.handleInput(3, [mouseDown(0.5, 0.5)])
      expect(h.mouse.map((c) => c.id)).not.toContain(3)
      expect(h.mouse.some((c) => c.id === 1)).toBe(true)
    })

    it('skips a device whose mirroring was switched off', () => {
      h.engine.setEnabled('tablet', false)
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.every((c) => c.id !== 2)).toBe(true)
      expect(h.mouse.some((c) => c.id === 3)).toBe(true)
    })

    it('re-enabling a device brings it back', () => {
      h.engine.setEnabled('tablet', false)
      h.engine.setEnabled('tablet', true)
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.some((c) => c.id === 2)).toBe(true)
    })

    it('ignores input from a disabled lead: it drives nothing', () => {
      h.engine.setEnabled('phone', false)
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse).toHaveLength(0)
    })

    it('the global switch turns the whole thing off', () => {
      h.engine.setGlobalEnabled(false)
      h.engine.handleInput(1, [mouseDown(0.5, 0.5), scroll(0.4)])
      h.runFrame()
      expect(h.mouse).toHaveLength(0)
      expect(h.scrolls).toHaveLength(0)
    })

    it('an unregistered device stops receiving', () => {
      h.engine.unregisterDevice('tablet')
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.every((c) => c.id !== 2)).toBe(true)
    })

    it('a removed lead stops driving, and the lead passes to a survivor', () => {
      h.engine.unregisterDevice('phone')
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse).toHaveLength(0)
      // Losing the lead device must not leave the canvas with no source.
      expect(h.engine.lead()).toBe('tablet')
    })

    it('refuses to elect a muted device: it would drive nothing', () => {
      h.engine.setEnabled('desktop', false)
      h.engine.setLead('desktop')

      // The election is ignored, so the canvas keeps the source it had.
      expect(h.engine.lead()).toBe('phone')
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.some((c) => c.id === 2)).toBe(true)
    })

    it('elects it again once it is un-muted', () => {
      h.engine.setEnabled('desktop', false)
      h.engine.setLead('desktop')
      h.engine.setEnabled('desktop', true)
      h.engine.setLead('desktop')
      expect(h.engine.lead()).toBe('desktop')
    })

    it('a muted device does not become the opening lead either', () => {
      const engine = new SyncEngine({
        dispatchMouse: () => undefined,
        dispatchKey: () => undefined,
        scrollToRatio: () => undefined
      })
      engine.setEnabled('a', false)
      engine.registerDevice({ deviceId: 'a', target: fakeTarget(1), width: 100, height: 100 })
      engine.registerDevice({ deviceId: 'b', target: fakeTarget(2), width: 100, height: 100 })
      expect(engine.lead()).toBe('b')
    })

    it('hands a removed lead to a device that is still mirroring', () => {
      h.engine.setEnabled('tablet', false)
      h.engine.unregisterDevice('phone')
      expect(h.engine.lead()).toBe('desktop')
    })

    it('the first device registered leads until the UI elects another', () => {
      const engine = new SyncEngine({
        dispatchMouse: () => undefined,
        dispatchKey: () => undefined,
        scrollToRatio: () => undefined
      })
      expect(engine.lead()).toBeNull()
      engine.registerDevice({ deviceId: 'a', target: fakeTarget(1), width: 100, height: 100 })
      engine.registerDevice({ deviceId: 'b', target: fakeTarget(2), width: 100, height: 100 })
      expect(engine.lead()).toBe('a')
    })
  })

  describe('mouse dispatch', () => {
    it('moves the cursor before pressing so hover-driven targets react', () => {
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      const onTablet = h.mouse.filter((c) => c.id === 2)
      expect(onTablet.map((c) => c.params.type)).toEqual(['mouseMoved', 'mousePressed'])
    })

    it('a press/release pair is what makes a link click on the followers', () => {
      h.engine.handleInput(1, [
        mouseDown(0.25, 0.25),
        { kind: 'mouse', type: 'up', xNorm: 0.25, yNorm: 0.25, button: 'left' }
      ])
      const onTablet = h.mouse.filter((c) => c.id === 2)
      expect(onTablet.map((c) => c.params.type)).toEqual([
        'mouseMoved',
        'mousePressed',
        'mouseReleased'
      ])
      expect(onTablet.at(-1)?.params).toMatchObject({
        button: 'left',
        buttons: 0,
        clickCount: 1,
        x: 200,
        y: 250
      })
    })

    it('carries the button identity and its pressed-buttons mask', () => {
      h.engine.handleInput(1, [
        { kind: 'mouse', type: 'down', xNorm: 0.5, yNorm: 0.5, button: 'right' }
      ])
      const pressed = h.mouse.find((c) => c.id === 2 && c.params.type === 'mousePressed')
      expect(pressed?.params).toMatchObject({ button: 'right', buttons: 2 })
    })
  })

  describe('key dispatch', () => {
    it('mirrors a key press with its code and modifiers', () => {
      h.engine.handleInput(1, [{ kind: 'key', type: 'down', key: 'a', code: 'KeyA', modifiers: 2 }])
      expect(h.keys.map((c) => c.id).sort()).toEqual([2, 3])
      expect(h.keys[0]?.params).toMatchObject({
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 2
      })
    })

    it('gives a printable key the text Chromium needs to insert it', () => {
      h.engine.handleInput(1, [{ kind: 'key', type: 'down', key: 'a', code: 'KeyA', modifiers: 0 }])
      expect(h.keys[0]?.params.text).toBe('a')
    })

    it('sends no text for a named key, but does send its virtual key code', () => {
      h.engine.handleInput(1, [
        { kind: 'key', type: 'down', key: 'Enter', code: 'Enter', modifiers: 0 }
      ])
      expect(h.keys[0]?.params.text).toBeUndefined()
      expect(h.keys[0]?.params.windowsVirtualKeyCode).toBe(13)
    })

    it('a key release is a keyUp', () => {
      h.engine.handleInput(1, [{ kind: 'key', type: 'up', key: 'a', code: 'KeyA', modifiers: 0 }])
      expect(h.keys[0]?.params.type).toBe('keyUp')
    })
  })

  describe('scroll coalescing', () => {
    it('holds the scroll until the frame, then applies the latest value', () => {
      h.engine.handleInput(1, [scroll(0.1)])
      h.engine.handleInput(1, [scroll(0.4)])
      h.engine.handleInput(1, [scroll(0.9)])
      expect(h.scrolls).toHaveLength(0)

      h.runFrame()
      expect(h.scrolls).toHaveLength(2)
      expect(h.scrolls.every((c) => c.ratioY === 0.9)).toBe(true)
    })

    it('arms exactly one frame for a burst', () => {
      h.engine.handleInput(1, [scroll(0.1), scroll(0.2)])
      h.engine.handleInput(1, [scroll(0.3)])
      expect(h.frames).toBe(1)
    })

    it('a later scroll arms a new frame', () => {
      h.engine.handleInput(1, [scroll(0.1)])
      h.runFrame()
      h.engine.handleInput(1, [scroll(0.7)])
      h.runFrame()
      expect(h.scrolls.filter((c) => c.id === 2).map((c) => c.ratioY)).toEqual([0.1, 0.7])
    })

    it('clamps a ratio outside 0..1', () => {
      h.engine.handleInput(1, [{ kind: 'scroll', ratioX: -3, ratioY: 5 }])
      h.runFrame()
      expect(h.scrolls[0]).toMatchObject({ ratioX: 0, ratioY: 1 })
    })

    it('a device unregistered before the frame is not scrolled', () => {
      h.engine.handleInput(1, [scroll(0.5)])
      h.engine.unregisterDevice('tablet')
      h.runFrame()
      expect(h.scrolls.map((c) => c.id)).toEqual([3])
    })

    it('a lead election drops what the outgoing lead had queued', () => {
      // The pointer left mid-gesture. Applying that scroll a frame later would
      // move the followers on behalf of a device that no longer drives them —
      // and, worse, on behalf of one the new lead is now scrolling itself.
      h.engine.handleInput(1, [scroll(0.5)])
      h.engine.setLead('tablet')
      h.runFrame()

      expect(h.scrolls).toHaveLength(0)
    })

    it('does not reorder a scroll ahead of the click that followed it', () => {
      // The click lands now; the scroll waits for the frame. That is the whole
      // point of the throttle, and it is what keeps a scroll storm cheap.
      h.engine.handleInput(1, [scroll(0.5), mouseDown(0.5, 0.5)])
      expect(h.mouse.length).toBeGreaterThan(0)
      expect(h.scrolls).toHaveLength(0)
    })
  })

  describe('capture notification', () => {
    /** A registry that records what each view was told about its own role. */
    function captureHarness(): {
      engine: SyncEngine
      told: Record<string, boolean[]>
      add: (deviceId: string, id: number) => void
    } {
      const told: Record<string, boolean[]> = {}
      const engine = new SyncEngine({
        dispatchMouse: () => undefined,
        dispatchKey: () => undefined,
        scrollToRatio: () => undefined
      })

      return {
        engine,
        told,
        add(deviceId, id) {
          told[deviceId] ??= []
          engine.registerDevice({
            deviceId,
            target: fakeTarget(id),
            width: 100,
            height: 100,
            setCapturing: (capturing) => told[deviceId]?.push(capturing)
          })
        }
      }
    }

    it('only the lead is asked to report input', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      h2.add('b', 2)

      expect(h2.told['a']).toEqual([true])
      expect(h2.told['b']).toEqual([false])
    })

    it('a new lead is switched on and the old one off', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      h2.add('b', 2)
      h2.engine.setLead('b')

      expect(h2.told['a']).toEqual([true, false])
      expect(h2.told['b']).toEqual([false, true])
    })

    it('says nothing when the lead did not actually change', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      h2.engine.setLead('a')
      h2.engine.setLead('a')
      expect(h2.told['a']).toEqual([true])
    })

    it('a muted lead stops reporting: main would drop it anyway', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      h2.add('b', 2)
      h2.engine.setEnabled('a', false)
      expect(h2.told['a']).toEqual([true, false])
    })

    it('the master switch silences every view', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      h2.add('b', 2)
      h2.engine.setGlobalEnabled(false)
      expect(h2.told['a']).toEqual([true, false])
      expect(h2.told['b']).toEqual([false])
    })

    it('refreshCapture re-states the flag, for a preload that just reloaded', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      h2.engine.refreshCapture('a')
      expect(h2.told['a']).toEqual([true, true])
    })

    it('refreshCapture on an unknown device is a no-op', () => {
      const h2 = captureHarness()
      h2.add('a', 1)
      expect(() => h2.engine.refreshCapture('nope')).not.toThrow()
      expect(h2.told['a']).toEqual([true])
    })
  })

  describe('restored switches', () => {
    it('a device muted before it had a view comes up muted', () => {
      // This is the boot order: main applies the saved switches, then the
      // first `WebContentsView` is created.
      h.engine.setEnabled('newcomer', false)
      h.engine.registerDevice({
        deviceId: 'newcomer',
        target: fakeTarget(9),
        width: 100,
        height: 100
      })

      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.every((c) => c.id !== 9)).toBe(true)
    })

    it('a muted device that leaves and comes back is still muted', () => {
      h.engine.setEnabled('tablet', false)
      h.engine.unregisterDevice('tablet')
      h.engine.registerDevice({
        deviceId: 'tablet',
        target: fakeTarget(2),
        width: 800,
        height: 1000,
        mobile: true
      })

      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.every((c) => c.id !== 2)).toBe(true)
    })
  })

  describe('lifecycle', () => {
    it('dispose cancels a pending frame and stops dispatching', () => {
      const cancel = vi.fn()
      const engine = new SyncEngine(
        {
          dispatchMouse: () => undefined,
          dispatchKey: () => undefined,
          scrollToRatio: () => undefined
        },
        { scheduleFrame: () => cancel }
      )
      engine.registerDevice({ deviceId: 'a', target: fakeTarget(1), width: 100, height: 100 })
      engine.registerDevice({ deviceId: 'b', target: fakeTarget(2), width: 100, height: 100 })
      engine.setLead('a')
      engine.handleInput(1, [scroll(0.5)])

      engine.dispose()
      expect(cancel).toHaveBeenCalledTimes(1)

      engine.handleInput(1, [mouseDown(0.5, 0.5)])
      // Nothing to assert on the sink beyond "it did not throw"; the registry
      // is empty, so there is no target left to reach.
      expect(engine.deviceIds()).toEqual([])
    })

    it('re-registering the same device id replaces its entry', () => {
      h.engine.registerDevice({
        deviceId: 'tablet',
        target: fakeTarget(7),
        width: 600,
        height: 600
      })
      h.engine.handleInput(1, [mouseDown(0.5, 0.5)])
      expect(h.mouse.some((c) => c.id === 7)).toBe(true)
      expect(h.mouse.some((c) => c.id === 2)).toBe(false)
    })
  })
})
