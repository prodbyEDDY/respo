import { describe, expect, it, vi } from 'vitest'
import type { AuthPrompt } from '@shared/ipc'
import {
  authHostLabel,
  authRealmLabel,
  createAuthManager,
  MAX_PENDING_AUTH,
  MAX_REALM_LENGTH,
  type AuthManager
} from '../auth'
import type { Deferrer } from '../load-state-batcher'

/** A deferrer under the test's control: nothing flushes until `run()` is called. */
function manualDeferrer(): Deferrer & { run: () => void } {
  let task: (() => void) | null = null
  return {
    defer(next) {
      task = next
      return () => {
        task = null
      }
    },
    run() {
      const current = task
      task = null
      current?.()
    }
  }
}

function harness(): { manager: AuthManager; states: AuthPrompt[][]; flush: () => void } {
  const states: AuthPrompt[][] = []
  const deferrer = manualDeferrer()
  const manager = createAuthManager({ onState: (prompts) => states.push(prompts), deferrer })
  return { manager, states, flush: deferrer.run }
}

/** The id of the challenge the dialog is showing. Throws rather than asserting. */
function challengeId(manager: AuthManager, index = 0): string {
  const prompt = manager.pending()[index]
  if (prompt === undefined) throw new Error(`expected a pending challenge at ${index}`)
  return prompt.id
}

describe('authHostLabel', () => {
  it('drops the port when it is the scheme’s own', () => {
    expect(authHostLabel('https', 'staging.dev', 443)).toBe('staging.dev')
    expect(authHostLabel('http', 'staging.dev', 80)).toBe('staging.dev')
  })

  it('keeps a port worth reading', () => {
    expect(authHostLabel('http', 'localhost', 8080)).toBe('localhost:8080')
    expect(authHostLabel('https', 'staging.dev', 8443)).toBe('staging.dev:8443')
  })

  it('degrades to something a person can read when the host is missing', () => {
    expect(authHostLabel('https', '', 443)).toBe('this server')
    expect(authHostLabel('https', '  ', 443)).toBe('this server')
  })

  it('leaves out a port that is not one', () => {
    expect(authHostLabel('https', 'a.dev', 0)).toBe('a.dev')
    expect(authHostLabel('https', 'a.dev', Number.NaN)).toBe('a.dev')
  })
})

describe('authRealmLabel', () => {
  it('passes a realm through', () => {
    expect(authRealmLabel('Staging')).toBe('Staging')
  })

  it('reads an empty or whitespace realm as none at all', () => {
    expect(authRealmLabel('')).toBeUndefined()
    expect(authRealmLabel('   ')).toBeUndefined()
    expect(authRealmLabel(undefined)).toBeUndefined()
  })

  it('flattens control characters — a realm is a label, not content', () => {
    const realm = `Staging${String.fromCharCode(10)}${String.fromCharCode(27)}[31mred`
    const label = authRealmLabel(realm)
    expect(label).toBe('Staging  [31mred')
    expect(label).not.toContain(String.fromCharCode(27))
  })

  it('truncates a realm long enough to be a payload', () => {
    expect(authRealmLabel('x'.repeat(500))).toHaveLength(MAX_REALM_LENGTH)
  })
})

describe('AuthManager', () => {
  it('asks once for five viewports and answers all of them', () => {
    const { manager } = harness()
    const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    for (const callback of callbacks) {
      expect(manager.challenge('staging.dev', false, 'Staging', callback)).toBe(true)
    }

    expect(manager.pending()).toHaveLength(1)
    for (const callback of callbacks) expect(callback).not.toHaveBeenCalled()

    manager.respond(challengeId(manager), { username: 'ada', password: 'hunter2' })
    for (const callback of callbacks) expect(callback).toHaveBeenCalledWith('ada', 'hunter2')
  })

  it('keeps two realms on one host as two questions', () => {
    const { manager } = harness()
    manager.challenge('staging.dev', false, 'Admin', vi.fn())
    manager.challenge('staging.dev', false, 'Reports', vi.fn())

    expect(manager.pending().map((prompt) => prompt.realm)).toEqual(['Admin', 'Reports'])
  })

  it('keeps a proxy challenge separate from the site’s', () => {
    const { manager } = harness()
    manager.challenge('proxy.dev', true, undefined, vi.fn())
    manager.challenge('proxy.dev', false, undefined, vi.fn())

    expect(manager.pending().map((prompt) => prompt.isProxy)).toEqual([true, false])
  })

  /**
   * The bug this feature is built to avoid: `ipcMain.once` without a filter
   * would hand the second challenge the credentials typed for the first.
   */
  it('answers the challenge the reply names, never the one that happens to be next', () => {
    const { manager } = harness()
    const first = vi.fn()
    const second = vi.fn()
    manager.challenge('one.dev', false, undefined, first)
    manager.challenge('two.dev', false, undefined, second)

    manager.respond(challengeId(manager, 1), { username: 'b', password: 'two' })

    expect(second).toHaveBeenCalledWith('b', 'two')
    expect(first).not.toHaveBeenCalled()
    expect(manager.pending().map((prompt) => prompt.host)).toEqual(['one.dev'])
  })

  it('cancels with no arguments at all — that is how Electron reads a refusal', () => {
    const { manager } = harness()
    const callback = vi.fn()
    manager.challenge('staging.dev', false, undefined, callback)

    manager.respond(challengeId(manager), null)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith()
  })

  it('drops a reply to a challenge that is already gone', () => {
    const { manager } = harness()
    const callback = vi.fn()
    manager.challenge('staging.dev', false, undefined, callback)
    const id = challengeId(manager)

    manager.respond(id, { username: 'ada', password: 'hunter2' })
    manager.respond(id, { username: 'mallory', password: 'x' })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('stops taking challenges over once there are too many to work through', () => {
    const { manager } = harness()
    for (let n = 0; n < MAX_PENDING_AUTH; n += 1) {
      expect(manager.challenge(`h${n}.dev`, false, undefined, vi.fn())).toBe(true)
    }

    const refused = vi.fn()
    expect(manager.challenge('one-too-many.dev', false, undefined, refused)).toBe(false)
    // Refused means cancelled, not left hanging.
    expect(refused).toHaveBeenCalledWith()
    expect(manager.pending()).toHaveLength(MAX_PENDING_AUTH)
  })

  it('cancels everything still waiting when it is disposed', () => {
    const { manager } = harness()
    const callback = vi.fn()
    manager.challenge('staging.dev', false, undefined, callback)

    manager.dispose()

    expect(callback).toHaveBeenCalledWith()
    // And a challenge arriving afterwards is cancelled rather than queued.
    const later = vi.fn()
    expect(manager.challenge('staging.dev', false, undefined, later)).toBe(false)
    expect(later).toHaveBeenCalledWith()
  })

  it('survives a callback that throws — one dead view must not silence four', () => {
    const { manager } = harness()
    const thrower = vi.fn(() => {
      throw new Error('view is gone')
    })
    const survivor = vi.fn()
    manager.challenge('staging.dev', false, undefined, thrower)
    manager.challenge('staging.dev', false, undefined, survivor)

    manager.respond(challengeId(manager), { username: 'ada', password: 'hunter2' })

    expect(survivor).toHaveBeenCalledWith('ada', 'hunter2')
  })

  it('coalesces a burst into one push, and says nothing when nothing changed', () => {
    const test = harness()
    for (let n = 0; n < 5; n += 1) {
      test.manager.challenge('staging.dev', false, undefined, vi.fn())
    }

    test.flush()
    expect(test.states).toHaveLength(1)
    expect(test.states[0]).toHaveLength(1)

    test.flush()
    expect(test.states).toHaveLength(1)
  })

  it('leaves the realm off a prompt when the server named none', () => {
    const { manager } = harness()
    manager.challenge('staging.dev', false, undefined, vi.fn())

    const prompt = manager.pending()[0]
    expect(prompt?.realm).toBeUndefined()
    expect(Object.keys(prompt ?? {})).toEqual(['id', 'host', 'isProxy'])
  })
})
