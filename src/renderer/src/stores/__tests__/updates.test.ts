import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MainEvent, RespoApi, UpdateStatePayload } from '@shared/ipc'
import { attachUpdatesBridge, emptyUpdateStatus, selectChipVisible, useUpdates } from '../updates'

type InvokeCall = { channel: string; args: unknown[] }

const calls: InvokeCall[] = []
let listeners: ((event: MainEvent) => void)[] = []
/** What the next `updates:*` invoke resolves with. */
let reply: UpdateStatePayload = emptyUpdateStatus()

function status(patch: Partial<UpdateStatePayload>): UpdateStatePayload {
  return { ...emptyUpdateStatus(), enabled: true, current: '0.1.0', ...patch }
}

/** The store installs what main answers, so a test has to let that land. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  calls.length = 0
  listeners = []
  reply = status({})

  const respo = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      return Promise.resolve(channel === 'updates:install' ? undefined : reply)
    },
    onMainEvent: (listener: (event: MainEvent) => void) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    }
  } as unknown as RespoApi
  ;(window as Window & { respo?: RespoApi }).respo = respo

  useUpdates.setState({ status: emptyUpdateStatus() })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'respo')
})

describe('updates store', () => {
  it('starts with nothing known and nothing to show', () => {
    expect(useUpdates.getState().status).toEqual(emptyUpdateStatus())
    expect(selectChipVisible(useUpdates.getState())).toBe(false)
  })

  it('asks main and installs the answer', async () => {
    reply = status({ stage: 'available', version: '0.1.1' })
    useUpdates.getState().check()
    await settle()

    expect(calls).toEqual([{ channel: 'updates:check', args: [] }])
    expect(useUpdates.getState().status).toMatchObject({ stage: 'available', version: '0.1.1' })
  })

  it('downloads and installs through their own channels', async () => {
    reply = status({ stage: 'downloading', version: '0.1.1', percent: 0 })
    useUpdates.getState().download()
    await settle()
    expect(calls).toEqual([{ channel: 'updates:download', args: [] }])
    expect(useUpdates.getState().status.stage).toBe('downloading')

    calls.length = 0
    useUpdates.getState().install()
    await settle()
    expect(calls).toEqual([{ channel: 'updates:install', args: [] }])
  })

  it('moves the checkbox on the click, then tells main', async () => {
    useUpdates.setState({ status: status({ autoCheck: true }) })
    reply = status({ autoCheck: false })

    useUpdates.getState().setAutoCheck(false)
    expect(useUpdates.getState().status.autoCheck).toBe(false)
    await settle()
    expect(calls).toEqual([{ channel: 'updates:set-auto-check', args: [false] }])

    // Already off: nothing to send.
    useUpdates.getState().setAutoCheck(false)
    expect(calls).toHaveLength(1)
  })

  it('installs a pushed state without re-rendering for an identical one', () => {
    const before = useUpdates.getState().status
    useUpdates.getState().applyState({ ...before })
    expect(useUpdates.getState().status).toBe(before)

    const next = status({ stage: 'downloading', version: '0.1.1', percent: 42 })
    useUpdates.getState().applyState(next)
    expect(useUpdates.getState().status).toBe(next)
  })
})

describe('selectChipVisible', () => {
  it.each([
    ['available', status({ stage: 'available', version: '0.1.1' }), true],
    ['downloading', status({ stage: 'downloading', version: '0.1.1', percent: 3 }), true],
    ['downloaded', status({ stage: 'downloaded', version: '0.1.1' }), true],
    ['a failed download', status({ stage: 'error', version: '0.1.1', error: 'x' }), true],
    ['a failed check', status({ stage: 'error', version: null, error: 'x' }), false],
    ['idle', status({ stage: 'idle' }), false],
    ['checking', status({ stage: 'checking' }), false],
    ['up to date', status({ stage: 'up-to-date' }), false]
  ])('shows the chip for %s: %s', (_label, value, visible) => {
    useUpdates.setState({ status: value })
    expect(selectChipVisible(useUpdates.getState())).toBe(visible)
  })
})

describe('attachUpdatesBridge', () => {
  it('subscribes once, asks for the current picture, and applies pushes', async () => {
    reply = status({ stage: 'up-to-date', lastCheckAt: 5 })
    const releaseA = attachUpdatesBridge()
    const releaseB = attachUpdatesBridge()
    expect(listeners).toHaveLength(1)
    await settle()
    expect(calls).toEqual([{ channel: 'updates:get', args: [] }])
    expect(useUpdates.getState().status.stage).toBe('up-to-date')

    listeners[0]?.({
      type: 'update-state',
      payload: status({ stage: 'available', version: '0.1.1' })
    })
    expect(useUpdates.getState().status).toMatchObject({ stage: 'available', version: '0.1.1' })

    // Other events are not ours.
    listeners[0]?.({ type: 'inspect-mode', payload: { active: true } })
    expect(useUpdates.getState().status.stage).toBe('available')

    releaseA()
    expect(listeners).toHaveLength(1)
    releaseB()
    releaseB()
    expect(listeners).toHaveLength(0)
  })
})
