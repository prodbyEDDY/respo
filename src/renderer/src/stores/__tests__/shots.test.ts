import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainEvent, RespoApi, ShotStatePayload } from '@shared/ipc'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import {
  attachShotsBridge,
  DEFAULT_SHOT_SETTINGS,
  selectIsBusy,
  selectProgress,
  useShots
} from '../shots'

type InvokeCall = { channel: string; args: unknown[] }

const calls: InvokeCall[] = []
let listeners: ((event: MainEvent) => void)[] = []
/** What the next invoke resolves with, by channel. */
let replies: Record<string, unknown> = {}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** One `shot-state` payload, with the fields a test does not care about filled. */
function event(
  over: Partial<ShotStatePayload> & Pick<ShotStatePayload, 'state'>
): ShotStatePayload {
  return {
    id: over.id ?? 'shot-1-0',
    batchId: over.batchId ?? 'shot-1',
    batchSize: over.batchSize ?? 1,
    deviceId: over.deviceId ?? 'phone',
    deviceName: over.deviceName ?? 'iPhone 15 Pro',
    state: over.state,
    ...(over.path === undefined ? {} : { path: over.path }),
    ...(over.error === undefined ? {} : { error: over.error })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  listeners = []
  replies = {
    'shot:device': { batchId: 'shot-1', queued: 1 },
    'shot:all': { batchId: 'shot-1', queued: 5 },
    'shot:copy': true,
    'shot:reveal': true,
    'shot:get-dir': 'C:\\Users\\me\\Pictures\\Respo',
    'shot:choose-dir': 'C:\\Users\\me\\Desktop\\shots'
  }

  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(replies[channel])
    },
    onMainEvent: (listener: (e: MainEvent) => void) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    }
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo

  useShots.setState({
    settings: { ...DEFAULT_SHOT_SETTINGS },
    directory: '',
    busy: {},
    jobs: {},
    flash: {},
    batches: {},
    notice: null
  })
  savePersistedState.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'respo')
})

describe('shots store — starting a capture', () => {
  it('screenshots one device’s viewport by default', async () => {
    useShots.getState().capture('phone')
    await settle()
    expect(calls).toEqual([{ channel: 'shot:device', args: ['phone', { fullPage: false }] }])
  })

  it('passes the full-page request through', async () => {
    useShots.getState().capture('phone', { fullPage: true })
    await settle()
    expect(calls[0]?.args[1]).toEqual({ fullPage: true })
  })

  it('says so when there is nothing on the canvas to photograph', async () => {
    replies['shot:all'] = { batchId: 'shot-2', queued: 0 }
    useShots.getState().captureAll()
    await settle()

    expect(useShots.getState().notice).toMatchObject({ tone: 'error' })
  })

  it('copies to the clipboard, and flashes the frame it copied', async () => {
    useShots.getState().copy('phone')
    await settle()

    expect(calls).toEqual([{ channel: 'shot:copy', args: ['phone'] }])
    expect(useShots.getState().notice).toMatchObject({ tone: 'ok' })
    expect(useShots.getState().flash['phone']).toBe(1)
  })

  it('reports a copy main could not make', async () => {
    replies['shot:copy'] = false
    useShots.getState().copy('phone')
    await settle()

    expect(useShots.getState().notice?.tone).toBe('error')
    expect(useShots.getState().flash['phone']).toBeUndefined()
  })
})

describe('shots store — progress', () => {
  it('marks a device busy while its job is queued or running, and free after', () => {
    const shots = useShots.getState()

    shots.apply([event({ state: 'queued' })])
    expect(selectIsBusy(useShots.getState(), 'phone')).toBe(true)

    shots.apply([event({ state: 'active' })])
    expect(selectIsBusy(useShots.getState(), 'phone')).toBe(true)

    shots.apply([event({ state: 'done', path: '/shots/a.png' })])
    expect(selectIsBusy(useShots.getState(), 'phone')).toBe(false)
  })

  it('keeps a device busy while another batch still has a job for it', () => {
    const shots = useShots.getState()

    // The camera on one frame, then "screenshot every device" before it lands:
    // two jobs, one device, two different batches.
    shots.apply([event({ state: 'queued', id: 'shot-1-0', batchId: 'shot-1' })])
    shots.apply([event({ state: 'queued', id: 'shot-2-0', batchId: 'shot-2', batchSize: 5 })])

    shots.apply([event({ state: 'done', id: 'shot-1-0', batchId: 'shot-1', path: '/shots/a.png' })])
    // The first job finished; the second one is still queued, so the spinner on
    // that frame stays.
    expect(selectIsBusy(useShots.getState(), 'phone')).toBe(true)

    shots.apply([
      event({
        state: 'done',
        id: 'shot-2-0',
        batchId: 'shot-2',
        batchSize: 5,
        path: '/shots/b.png'
      })
    ])
    expect(selectIsBusy(useShots.getState(), 'phone')).toBe(false)
  })

  it('counts a batch as it lands, and forgets it when it is whole', () => {
    const jobs = (state: ShotStatePayload['state'], index: number): ShotStatePayload =>
      event({
        state,
        batchSize: 3,
        id: `shot-1-${index}`,
        deviceId: `device-${index}`,
        ...(state === 'done' ? { path: `/shots/${index}.png` } : {})
      })

    useShots.getState().apply([jobs('queued', 0), jobs('queued', 1), jobs('queued', 2)])
    expect(selectProgress(useShots.getState())).toEqual({ done: 0, total: 3 })

    useShots.getState().apply([jobs('done', 0)])
    expect(selectProgress(useShots.getState())).toEqual({ done: 1, total: 3 })

    useShots.getState().apply([jobs('done', 1), jobs('done', 2)])
    // The batch is finished, so there is nothing in flight any more.
    expect(selectProgress(useShots.getState())).toBeNull()
  })

  it('flashes a frame once per screenshot that lands on it', () => {
    useShots.getState().apply([event({ state: 'done', path: '/shots/a.png' })])
    expect(useShots.getState().flash['phone']).toBe(1)

    useShots
      .getState()
      .apply([event({ state: 'done', path: '/shots/b.png', batchId: 'shot-2', id: 'shot-2-0' })])
    expect(useShots.getState().flash['phone']).toBe(2)
  })

  it('does not flash a frame whose screenshot failed', () => {
    useShots.getState().apply([event({ state: 'failed', error: 'no' })])
    expect(useShots.getState().flash['phone']).toBeUndefined()
  })
})

describe('shots store — what it says afterwards', () => {
  const batch = (index: number, state: ShotStatePayload['state'], size = 5): ShotStatePayload =>
    event({
      state,
      batchSize: size,
      id: `shot-1-${index}`,
      deviceId: `device-${index}`,
      ...(state === 'done' ? { path: `C:\\shots\\device-${index}.png` } : { error: 'nope' })
    })

  it('names the file when exactly one was saved, and offers to reveal it', () => {
    useShots.getState().apply([batch(0, 'done', 1)])

    const notice = useShots.getState().notice
    expect(notice?.tone).toBe('ok')
    expect(notice?.text).toContain('device-0.png')
    expect(notice?.path).toBe('C:\\shots\\device-0.png')
  })

  it('counts them when there were several — the folder is the answer, not a path', () => {
    useShots.getState().apply([0, 1, 2, 3, 4].map((i) => batch(i, 'done')))

    expect(useShots.getState().notice).toMatchObject({ tone: 'ok', text: 'Saved 5 screenshots' })
    expect(useShots.getState().notice?.path).toBeUndefined()
  })

  it('reports a partial failure as N of M', () => {
    useShots
      .getState()
      .apply([batch(0, 'done'), batch(1, 'done'), batch(2, 'done'), batch(3, 'failed')])
    // Four of five are in; the batch is not finished, so nothing is claimed yet.
    expect(useShots.getState().notice).toBeNull()

    useShots.getState().apply([batch(4, 'failed')])
    expect(useShots.getState().notice).toMatchObject({
      tone: 'error',
      text: 'Saved 3 of 5 screenshots'
    })
  })

  it('says so plainly when nothing was saved at all', () => {
    useShots.getState().apply([0, 1, 2, 3, 4].map((i) => batch(i, 'failed')))
    expect(useShots.getState().notice).toMatchObject({
      tone: 'error',
      text: 'Every screenshot failed'
    })
  })

  it('takes the notice away on its own', () => {
    useShots.getState().apply([batch(0, 'done', 1)])
    expect(useShots.getState().notice).not.toBeNull()

    vi.advanceTimersByTime(6000)
    expect(useShots.getState().notice).toBeNull()
  })

  it('ignores a dismissal aimed at a notice that has already been replaced', () => {
    useShots.getState().apply([batch(0, 'done', 1)])
    const first = useShots.getState().notice?.id as number

    useShots.getState().apply([batch(1, 'done', 1)])
    useShots.getState().dismiss(first)
    expect(useShots.getState().notice).not.toBeNull()

    useShots.getState().dismiss()
    expect(useShots.getState().notice).toBeNull()
  })

  it('reveals a path through main, which is the side that checks it', async () => {
    useShots.getState().reveal('C:\\shots\\a.png')
    await settle()
    expect(calls).toEqual([{ channel: 'shot:reveal', args: ['C:\\shots\\a.png'] }])
  })
})

describe('shots store — settings', () => {
  it('writes a format change back to the document', () => {
    useShots.getState().setFormat('jpeg')

    expect(useShots.getState().settings.format).toBe('jpeg')
    expect(savePersistedState).toHaveBeenCalledWith({
      screenshots: { directory: '', format: 'jpeg', dpr: 'device' }
    })
  })

  it('writes a density change back, and ignores a no-op', () => {
    useShots.getState().setDpr(1)
    useShots.getState().setDpr(1)

    expect(useShots.getState().settings.dpr).toBe(1)
    expect(savePersistedState).toHaveBeenCalledTimes(1)
  })

  it('reflects the folder main reported, and writes nothing back', async () => {
    await useShots.getState().chooseDirectory()

    expect(useShots.getState().settings.directory).toBe('C:\\Users\\me\\Desktop\\shots')
    expect(useShots.getState().directory).toBe('C:\\Users\\me\\Desktop\\shots')
    // Main ran the dialog and the write: the folder is its field, and a patch
    // carrying one is ignored on arrival (`validateScreenshotSettings`).
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('never sends a folder of its own in an ordinary settings patch', () => {
    useShots.getState().hydrate({ directory: 'C:\\shots', format: 'png', dpr: 'device' })
    useShots.getState().setFormat('jpeg')

    // It still restates what it hydrated with — main drops it — but nothing the
    // renderer does can *move* the folder.
    expect(savePersistedState).toHaveBeenCalledWith({
      screenshots: { directory: 'C:\\shots', format: 'jpeg', dpr: 'device' }
    })
  })

  it('changes nothing when the dialog is dismissed', async () => {
    replies['shot:choose-dir'] = null
    await useShots.getState().chooseDirectory()

    expect(useShots.getState().settings.directory).toBe('')
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('asks main where screenshots are actually going', async () => {
    useShots.getState().refreshDirectory()
    await settle()
    expect(useShots.getState().directory).toBe('C:\\Users\\me\\Pictures\\Respo')
  })

  it('installs what main restored without writing it back', () => {
    useShots.getState().hydrate({ directory: 'C:\\shots', format: 'jpeg', dpr: 1 })

    expect(useShots.getState().settings).toEqual({
      directory: 'C:\\shots',
      format: 'jpeg',
      dpr: 1
    })
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})

describe('attachShotsBridge', () => {
  it('feeds `shot-state` messages into the store, once, however many mounts', () => {
    const release = attachShotsBridge()
    const releaseAgain = attachShotsBridge()
    expect(listeners).toHaveLength(1)

    listeners[0]?.({
      type: 'shot-state',
      payload: [event({ state: 'done', path: '/shots/a.png' })]
    })
    expect(useShots.getState().flash['phone']).toBe(1)

    // Reference-counted: StrictMode's unmount must not deafen the store.
    release()
    expect(listeners).toHaveLength(1)
    releaseAgain()
    expect(listeners).toHaveLength(0)
  })

  it('ignores the other batched messages that share the channel', () => {
    attachShotsBridge()
    listeners[0]?.({ type: 'inspect-mode', payload: { active: true } })
    expect(useShots.getState().notice).toBeNull()
  })
})
