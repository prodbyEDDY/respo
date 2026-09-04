import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DiagnosticsPayload, MainEvent, RespoApi } from '@shared/ipc'
import { attachDiagnosticsBridge, useDiagnostics } from '../diagnostics'

type BridgeMock = {
  invoke: Mock<RespoApi['invoke']>
  emit: (event: MainEvent) => void
}

function installBridge(initial: DiagnosticsPayload[] = []): BridgeMock {
  const listeners = new Set<(event: MainEvent) => void>()
  const invoke = vi.fn((channel: string) =>
    Promise.resolve(channel === 'diagnostics:get' ? initial : undefined)
  ) as unknown as Mock<RespoApi['invoke']>
  const respo: RespoApi = {
    invoke: invoke as unknown as RespoApi['invoke'],
    onMainEvent: ((callback: (event: MainEvent) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }) as RespoApi['onMainEvent']
  }
  ;(window as Window & { respo?: RespoApi }).respo = respo
  return {
    invoke,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event)
    }
  }
}

function payload(deviceId: string, over: Partial<DiagnosticsPayload> = {}): DiagnosticsPayload {
  return { deviceId, errors: 0, messages: [], overflow: null, ...over }
}

describe('diagnostics store', () => {
  beforeEach(() => {
    useDiagnostics.setState({ perDevice: {} })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'respo')
  })

  it('installs a batch per device and keeps the others', () => {
    useDiagnostics.getState().apply([payload('a', { errors: 2 }), payload('b')])
    useDiagnostics.getState().apply([payload('a', { errors: 3 })])
    expect(useDiagnostics.getState().perDevice['a']?.errors).toBe(3)
    expect(useDiagnostics.getState().perDevice['b']?.errors).toBe(0)
  })

  it('forgets a device that left the canvas', () => {
    useDiagnostics.getState().apply([payload('a'), payload('b')])
    useDiagnostics.getState().pruneDevices(['b'])
    expect(Object.keys(useDiagnostics.getState().perDevice)).toEqual(['b'])
  })

  it('forwards a highlight request with the device and the target', () => {
    const bridge = installBridge()
    useDiagnostics.getState().highlight('a', 3)
    useDiagnostics.getState().highlight('a', 'all')
    useDiagnostics.getState().highlight('a', 'none')
    expect(bridge.invoke.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['diagnostics:highlight', 'a', 3],
      ['diagnostics:highlight', 'a', 'all'],
      ['diagnostics:highlight', 'a', 'none']
    ])
  })

  it('asks main for what it already knows when attached, then follows events', async () => {
    const bridge = installBridge([payload('a', { errors: 4 })])
    const release = attachDiagnosticsBridge()
    await vi.waitFor(() => expect(useDiagnostics.getState().perDevice['a']?.errors).toBe(4))

    bridge.emit({ type: 'diagnostics', payload: [payload('a', { errors: 5 })] })
    expect(useDiagnostics.getState().perDevice['a']?.errors).toBe(5)
    release()
  })
})
