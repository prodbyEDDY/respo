import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthPrompt, RespoApi } from '@shared/ipc'
import { selectChallenge, useAuth } from '../auth'

function installBridge(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(() => Promise.resolve(undefined))
  ;(window as unknown as { respo?: Partial<RespoApi> }).respo = {
    invoke: invoke as unknown as RespoApi['invoke']
  }
  return invoke
}

const one: AuthPrompt = { id: 'auth-1', host: 'one.dev', isProxy: false, realm: 'Staging' }
const two: AuthPrompt = { id: 'auth-2', host: 'two.dev', isProxy: true }

describe('auth store', () => {
  beforeEach(() => {
    useAuth.setState({ prompts: [] })
  })

  afterEach(() => {
    delete (window as unknown as { respo?: unknown }).respo
    vi.restoreAllMocks()
  })

  it('shows the oldest challenge and nothing when there is none', () => {
    expect(selectChallenge(useAuth.getState())).toBeNull()

    useAuth.getState().apply([one, two])
    expect(selectChallenge(useAuth.getState())?.id).toBe('auth-1')
  })

  it('answers the challenge the reply names and takes only that one away', () => {
    const invoke = installBridge()
    useAuth.getState().apply([one, two])

    useAuth.getState().respond('auth-2', { username: 'ada', password: 'hunter2' })

    expect(invoke).toHaveBeenCalledWith('auth:respond', 'auth-2', {
      username: 'ada',
      password: 'hunter2'
    })
    expect(useAuth.getState().prompts.map((prompt) => prompt.id)).toEqual(['auth-1'])
  })

  it('cancels with null, which is a decision rather than an error', () => {
    const invoke = installBridge()
    useAuth.getState().apply([one])

    useAuth.getState().respond('auth-1', null)

    expect(invoke).toHaveBeenCalledWith('auth:respond', 'auth-1', null)
    expect(useAuth.getState().prompts).toEqual([])
  })

  /**
   * The store is the one place credentials could accidentally be kept, so this
   * is the assertion that says they are not: nothing in the state names a
   * password, before or after an answer.
   */
  it('keeps no credentials of its own', () => {
    installBridge()
    useAuth.getState().apply([one])
    useAuth.getState().respond('auth-1', { username: 'ada', password: 'hunter2' })

    expect(JSON.stringify(useAuth.getState())).not.toContain('hunter2')
  })

  it('ignores a list identical to the one it already holds', () => {
    useAuth.getState().apply([one])
    const before = useAuth.getState().prompts

    useAuth.getState().apply([{ ...one }])

    expect(useAuth.getState().prompts).toBe(before)
  })

  it('clones what it installs, so main’s payload cannot be mutated through it', () => {
    useAuth.getState().apply([one])
    expect(useAuth.getState().prompts[0]).not.toBe(one)
  })

  it('degrades quietly outside Electron', () => {
    useAuth.getState().apply([one])
    expect(() => useAuth.getState().respond('auth-1', null)).not.toThrow()
    expect(useAuth.getState().prompts).toEqual([])
  })
})
