import { create } from 'zustand'
import type { AuthCredentials, AuthPrompt, MainEvent } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The renderer's half of HTTP authentication: which servers are asking.
 *
 * Note what this store does *not* hold. The username and password live in the
 * dialog's own component state for as long as it is open and are handed
 * straight to main on submit; nothing about them is kept here, and there is no
 * "remember me" to build on top of it. A development tool has no business
 * growing a password store, and a store is exactly what a state slice called
 * `credentials` would quietly become.
 */
export interface AuthState {
  /** Challenges waiting for an answer, oldest first. */
  prompts: AuthPrompt[]
  /**
   * Answer one challenge, or cancel it with `null`.
   *
   * The id is what makes this safe: a second challenge arriving while the
   * dialog is open must not be handed the credentials typed for the first.
   */
  respond: (id: string, credentials: AuthCredentials | null) => void
  /** Install the pending list main just reported. Idempotent. */
  apply: (prompts: readonly AuthPrompt[]) => void
}

export const useAuth = create<AuthState>((set, get) => ({
  prompts: [],

  respond: (id, credentials) => {
    // The dialog closes on the click: the answer is on its way, and a dialog
    // that lingered would invite a second submission of the same password.
    set({ prompts: get().prompts.filter((prompt) => prompt.id !== id) })

    const bridge = ipcBridge()
    // Absent outside Electron (unit tests, the dev server in a plain browser).
    if (bridge === null) return
    void bridge.invoke('auth:respond', id, credentials).catch(() => {
      // Deliberately no error object and no payload: this call carries a
      // password, and a rejection that printed its arguments would print it.
      console.error('auth:respond failed')
    })
  },

  apply: (prompts) => {
    const current = get().prompts
    const same =
      current.length === prompts.length &&
      current.every((prompt, index) => prompt.id === prompts[index]?.id)
    if (same) return
    set({ prompts: prompts.map((prompt) => ({ ...prompt })) })
  }
}))

/** The challenge the dialog is showing: the oldest one still unanswered. */
export function selectChallenge(state: AuthState): AuthPrompt | null {
  return state.prompts[0] ?? null
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's `auth-state` pushes.
 *
 * Reference-counted like the other bridges: React StrictMode mounts, tears down
 * and re-mounts in development, and the subscription must survive that without
 * ending up attached twice.
 */
export function attachAuthBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type === 'auth-state') useAuth.getState().apply(event.payload)
      }) ?? (() => undefined)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    subscribers -= 1
    if (subscribers > 0) return
    unsubscribe?.()
    unsubscribe = null
  }
}
