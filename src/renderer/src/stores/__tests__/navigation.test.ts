import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LoadStatePayload, MainEvent, RespoApi } from '@shared/ipc'
import { attachNavigationBridge, useNavigation } from '../navigation'

type BridgeMock = {
  invoke: Mock<RespoApi['invoke']>
  onMainEvent: Mock<RespoApi['onMainEvent']>
  emit: (event: MainEvent) => void
  unsubscribe: Mock<() => void>
}

function installBridge(): BridgeMock {
  const listeners = new Set<(event: MainEvent) => void>()
  const unsubscribe = vi.fn<() => void>()

  const invoke = vi.fn(() => Promise.resolve(undefined)) as unknown as Mock<RespoApi['invoke']>
  const onMainEvent = vi.fn((callback: (event: MainEvent) => void) => {
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
      unsubscribe()
    }
  }) as unknown as Mock<RespoApi['onMainEvent']>

  const respo: RespoApi = {
    invoke: invoke as unknown as RespoApi['invoke'],
    onMainEvent: onMainEvent as unknown as RespoApi['onMainEvent']
  }
  ;(window as Window & { respo?: RespoApi }).respo = respo

  return {
    invoke,
    onMainEvent,
    unsubscribe,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event)
    }
  }
}

function payload(deviceId: string, over: Partial<LoadStatePayload> = {}): LoadStatePayload {
  return { deviceId, state: 'loading', url: 'https://example.com/', ...over }
}

describe('navigation store', () => {
  let bridge: BridgeMock

  beforeEach(() => {
    bridge = installBridge()
    useNavigation.setState({ url: '', perDevice: {}, leadDeviceId: null })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'respo')
  })

  it('normalizes address bar input before handing it to main', () => {
    useNavigation.getState().navigate('example.com')

    expect(bridge.invoke).toHaveBeenCalledWith('nav:navigate', 'https://example.com/')
    expect(useNavigation.getState().url).toBe('https://example.com/')
  })

  it('keeps http for a loopback host', () => {
    useNavigation.getState().navigate('localhost:5173')

    expect(bridge.invoke).toHaveBeenCalledWith('nav:navigate', 'http://localhost:5173/')
  })

  it('refuses input no view is allowed to load', () => {
    useNavigation.getState().navigate('javascript:alert(1)')
    useNavigation.getState().navigate('   ')

    expect(bridge.invoke).not.toHaveBeenCalled()
    expect(useNavigation.getState().url).toBe('')
  })

  it('sends back, forward and reload on their own channels', () => {
    useNavigation.getState().back()
    useNavigation.getState().forward()
    useNavigation.getState().reload()

    expect(bridge.invoke.mock.calls.map((call) => call[0])).toEqual([
      'nav:back',
      'nav:forward',
      'nav:reload'
    ])
  })

  it('applies a load-state batch to perDevice in one update', () => {
    useNavigation
      .getState()
      .applyLoadStates([payload('a'), payload('b', { state: 'ready', title: 'Example' })])

    const { perDevice } = useNavigation.getState()
    expect(perDevice['a']?.state).toBe('loading')
    expect(perDevice['b']).toMatchObject({ state: 'ready', title: 'Example' })
  })

  it('overwrites a device it already knows and leaves the others alone', () => {
    useNavigation.getState().applyLoadStates([payload('a'), payload('b')])
    useNavigation
      .getState()
      .applyLoadStates([payload('a', { state: 'failed', errorCode: -105, errorDesc: 'ERR' })])

    const { perDevice } = useNavigation.getState()
    expect(perDevice['a']).toMatchObject({ state: 'failed', errorCode: -105 })
    expect(perDevice['b']?.state).toBe('loading')
  })

  it('follows the leading view in the address bar', () => {
    useNavigation.getState().navigate('example.com')
    // The user clicked a link inside the leading device; the bar follows it.
    useNavigation.getState().applyLoadStates([payload('a', { url: 'https://example.com/docs' })])
    useNavigation.getState().applyLoadStates([payload('b', { url: 'https://other.test/' })])

    expect(useNavigation.getState().url).toBe('https://example.com/docs')
  })

  it('routes batched main events into the store while attached', () => {
    const detach = attachNavigationBridge()

    bridge.emit({ type: 'load-state', payload: [payload('a', { state: 'ready' })] })
    expect(useNavigation.getState().perDevice['a']?.state).toBe('ready')

    detach()
    bridge.emit({ type: 'load-state', payload: [payload('a', { state: 'failed' })] })
    expect(useNavigation.getState().perDevice['a']?.state).toBe('ready')
  })

  it('subscribes once no matter how many times it is attached (StrictMode)', () => {
    const first = attachNavigationBridge()
    const second = attachNavigationBridge()

    expect(bridge.onMainEvent).toHaveBeenCalledTimes(1)

    first()
    expect(bridge.unsubscribe).not.toHaveBeenCalled()
    second()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
