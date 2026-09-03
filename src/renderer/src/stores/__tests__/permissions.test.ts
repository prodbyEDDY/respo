import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PERMISSION_DECISIONS,
  type PermissionStatePayload,
  type RespoApi
} from '@shared/ipc'
import { nextDecision, selectPrompt, usePermissions } from '../permissions'

type Invoke = ReturnType<typeof vi.fn>

/**
 * Install a fake `window.respo`. The store degrades to a no-op without one, so
 * the calls it *makes* are only observable with a bridge in place.
 */
function installBridge(answer: PermissionStatePayload | null = null): Invoke {
  const invoke = vi.fn(() => Promise.resolve(answer))
  const bridge: Partial<RespoApi> = { invoke: invoke as unknown as RespoApi['invoke'] }
  ;(window as unknown as { respo?: Partial<RespoApi> }).respo = bridge
  return invoke
}

function state(patch: Partial<PermissionStatePayload> = {}): PermissionStatePayload {
  return {
    origin: 'https://a.dev',
    decisions: { ...DEFAULT_PERMISSION_DECISIONS },
    prompts: [],
    ...patch
  }
}

describe('permissions store', () => {
  beforeEach(() => {
    usePermissions.setState({
      origin: null,
      decisions: { ...DEFAULT_PERMISSION_DECISIONS },
      prompts: [],
      changed: false
    })
  })

  afterEach(() => {
    delete (window as unknown as { respo?: unknown }).respo
    vi.restoreAllMocks()
  })

  it('cycles a decision Allow -> Block -> Ask -> Allow', () => {
    expect(nextDecision('allow')).toBe('block')
    expect(nextDecision('block')).toBe('ask')
    expect(nextDecision('ask')).toBe('allow')
  })

  it('shows the oldest unanswered question', () => {
    usePermissions.setState({
      prompts: [
        { id: 'perm-1', origin: 'https://a.dev', types: ['camera'] },
        { id: 'perm-2', origin: 'https://a.dev', types: ['geolocation'] }
      ]
    })

    expect(selectPrompt(usePermissions.getState())?.id).toBe('perm-1')
  })

  it('answers a question by id and takes it away', () => {
    const invoke = installBridge()
    usePermissions.setState({
      prompts: [
        { id: 'perm-1', origin: 'https://a.dev', types: ['camera'] },
        { id: 'perm-2', origin: 'https://a.dev', types: ['geolocation'] }
      ]
    })

    usePermissions.getState().respond('perm-1', true)

    expect(invoke).toHaveBeenCalledWith('permissions:respond', 'perm-1', true)
    expect(usePermissions.getState().prompts.map((p) => p.id)).toEqual(['perm-2'])
    expect(usePermissions.getState().changed).toBe(true)
  })

  it('dismisses without deciding — nothing to apply afterwards', () => {
    const invoke = installBridge()
    usePermissions.setState({
      prompts: [{ id: 'perm-1', origin: 'https://a.dev', types: ['camera'] }]
    })

    usePermissions.getState().dismiss('perm-1')

    expect(invoke).toHaveBeenCalledWith('permissions:dismiss', 'perm-1')
    expect(usePermissions.getState().prompts).toEqual([])
    expect(usePermissions.getState().changed).toBe(false)
  })

  it('names a capability and a decision, never an origin', () => {
    const invoke = installBridge()

    usePermissions.getState().setDecision('camera', 'block')

    expect(invoke).toHaveBeenCalledWith('permissions:set', 'camera', 'block')
    expect(invoke.mock.calls[0]).toHaveLength(3)
  })

  it('says nothing when the decision is already what it would be', () => {
    const invoke = installBridge()

    // Fullscreen starts allowed.
    usePermissions.getState().setDecision('fullscreen', 'allow')

    expect(invoke).not.toHaveBeenCalled()
  })

  it('installs the state main answers with', async () => {
    installBridge(state({ decisions: { ...DEFAULT_PERMISSION_DECISIONS, camera: 'block' } }))

    usePermissions.getState().setDecision('camera', 'block')
    await Promise.resolve()
    await Promise.resolve()

    expect(usePermissions.getState().origin).toBe('https://a.dev')
    expect(usePermissions.getState().decisions.camera).toBe('block')
  })

  it('stops asking for a reload once the views have been reloaded', () => {
    const invoke = installBridge()
    usePermissions.setState({ changed: true })

    usePermissions.getState().reload()

    expect(invoke).toHaveBeenCalledWith('nav:reload')
    expect(usePermissions.getState().changed).toBe(false)
  })

  it('forgets a pending reload when the canvas moves to another site', () => {
    usePermissions.setState({ origin: 'https://a.dev', changed: true })

    usePermissions.getState().apply(state({ origin: 'https://b.dev' }))

    expect(usePermissions.getState().origin).toBe('https://b.dev')
    expect(usePermissions.getState().changed).toBe(false)
  })

  it('ignores a state identical to the one it already holds', () => {
    usePermissions.getState().apply(state())
    const before = usePermissions.getState().decisions

    usePermissions.getState().apply(state())

    // Same object: nothing re-rendered.
    expect(usePermissions.getState().decisions).toBe(before)
  })

  it('degrades quietly outside Electron', () => {
    expect(() => {
      usePermissions.getState().respond('perm-1', true)
      usePermissions.getState().setDecision('camera', 'block')
      usePermissions.getState().resetAll()
      usePermissions.getState().refresh()
    }).not.toThrow()
  })
})
