/**
 * HTTP authentication: the `WWW-Authenticate` dialog, done once.
 *
 * A protected page loaded into five viewports produces five `login` events, and
 * a browser that put five password dialogs on screen for that would be unusable
 * — so the challenges coalesce and one answer resolves all of them.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * - **Every reply names the challenge it answers.** The obvious shape for this
 *   is `ipcMain.once('auth:respond')` — take the next reply, whatever it is —
 *   and it is a bug with a password in it: a second challenge arriving between
 *   the dialog rendering and the user clicking Sign in would be handed the
 *   credentials meant for the first. Ids, always, and an id nobody is waiting
 *   for is dropped.
 * - **Nothing is kept.** Credentials pass through `respond` into the Electron
 *   callbacks and are not stored, not written to disk, and never logged — not
 *   in an error path either. Respo has no password store and is not growing
 *   one.
 *
 * Electron is nowhere in this file: it takes a host, a realm and a callback, so
 * the coalescing and the correlation — the parts that have to be right — are
 * reachable from a unit test.
 */

import type { AuthCredentials, AuthPrompt } from '@shared/ipc'
import { immediateDeferrer, type Deferrer } from './load-state-batcher'

/** What Electron's `login` event hands over. No arguments means "cancel". */
export type AuthCallback = (username?: string, password?: string) => void

/**
 * The most challenges worth showing at once.
 *
 * A page pulling protected assets from four hosts is already a strange page,
 * and past this the honest answer is to stop asking and let the requests fail
 * — a queue of password dialogs is not something anyone works through.
 */
export const MAX_PENDING_AUTH = 4

/**
 * Server-controlled text, shown to a person. Long enough for any real realm,
 * short enough that a hostile one cannot be a payload in the dialog.
 */
export const MAX_REALM_LENGTH = 80

export type AuthManagerOptions = {
  /** Push the pending list to the renderer. Called at most once per turn. */
  onState: (prompts: AuthPrompt[]) => void
  /** Coalescing primitive. Injectable so tests need no timers. */
  deferrer?: Deferrer
}

export interface AuthManager {
  /**
   * A server is asking. Answers with `true` when the challenge was taken over
   * — the caller has already prevented Electron's default and must not do
   * anything else with the callback — and `false` when it was refused outright,
   * in which case the callback has been cancelled here.
   */
  challenge(
    host: string,
    isProxy: boolean,
    realm: string | undefined,
    callback: AuthCallback
  ): boolean
  /** Answer one challenge, or cancel it with `null`. Unknown ids are dropped. */
  respond(id: string, credentials: AuthCredentials | null): void
  /** The challenges waiting for an answer, oldest first. */
  pending(): AuthPrompt[]
  dispose(): void
}

/**
 * How a challenge is named to the user.
 *
 * The port is included only when it is not the scheme's own: `staging.dev` is
 * what someone recognises, and `staging.dev:443` is the same thing said in a
 * way that makes them wonder whether it is.
 *
 * Exported for its unit test; production code reaches it through `index.ts`.
 */
export function authHostLabel(scheme: string, host: string, port: number): string {
  const normalized = host.trim()
  if (normalized === '') return 'this server'
  if (!Number.isInteger(port) || port <= 0) return normalized

  const implied = scheme.toLowerCase() === 'https' ? 443 : 80
  return port === implied ? normalized : `${normalized}:${port}`
}

/**
 * Replace every control character with a space.
 *
 * Written as a code-point walk rather than a regex on purpose: the escapes for
 * this range are exactly the kind of thing that gets mangled by a careless edit
 * into a class that matches something else entirely, and this cannot be.
 */
function stripControls(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? ' ' : character
  }
  return out
}

/** Trim a server-supplied realm to something that can be shown in a dialog. */
export function authRealmLabel(realm: string | undefined): string | undefined {
  if (realm === undefined) return undefined
  // Control characters in a string that is about to be rendered are never
  // content; a realm is a label.
  const cleaned = stripControls(realm).trim()
  if (cleaned === '') return undefined
  return cleaned.slice(0, MAX_REALM_LENGTH)
}

type Pending = {
  id: string
  host: string
  isProxy: boolean
  realm: string | undefined
  callbacks: AuthCallback[]
}

/**
 * What makes two challenges the same question.
 *
 * Host and realm both: one server can protect two areas with two sets of
 * credentials, and answering for `/admin` must not silently be an answer for
 * `/reports`. A proxy challenge is never the same question as a site's.
 */
function challengeKey(host: string, isProxy: boolean, realm: string | undefined): string {
  return `${isProxy ? 'proxy' : 'site'} ${host} ${realm ?? ''}`
}

export function createAuthManager(options: AuthManagerOptions): AuthManager {
  const { onState } = options
  const deferrer = options.deferrer ?? immediateDeferrer

  const byKey = new Map<string, Pending>()
  const byId = new Map<string, Pending>()
  let sequence = 0
  let cancelPush: (() => void) | null = null
  let pushed: string | null = null
  let disposed = false

  const prompts = (): AuthPrompt[] =>
    [...byKey.values()].map((entry) => ({
      id: entry.id,
      host: entry.host,
      isProxy: entry.isProxy,
      ...(entry.realm === undefined ? {} : { realm: entry.realm })
    }))

  const flush = (): void => {
    cancelPush = null
    if (disposed) return
    const next = prompts()
    const stamp = next.map((prompt) => prompt.id).join(' ')
    if (stamp === pushed) return
    pushed = stamp
    onState(next)
  }

  const schedule = (): void => {
    if (disposed) return
    cancelPush ??= deferrer.defer(flush)
  }

  const drop = (entry: Pending): void => {
    byId.delete(entry.id)
    byKey.delete(challengeKey(entry.host, entry.isProxy, entry.realm))
  }

  /**
   * Hand one answer to everyone waiting behind a challenge.
   *
   * `credentials` is `null` for a cancel, which Electron reads as "no
   * arguments". Nothing in here is logged: an error path that printed its
   * arguments would print a password.
   */
  const settle = (entry: Pending, credentials: AuthCredentials | null): void => {
    for (const callback of entry.callbacks) {
      try {
        if (credentials === null) callback()
        else callback(credentials.username, credentials.password)
      } catch {
        // A view torn down mid-challenge leaves a callback that throws. One of
        // those must not take the other four answers down with it — and there
        // is deliberately nothing to log here.
      }
    }
  }

  return {
    challenge(host, isProxy, realm, callback): boolean {
      if (disposed) {
        callback()
        return false
      }

      const key = challengeKey(host, isProxy, realm)
      const existing = byKey.get(key)
      if (existing !== undefined) {
        // The coalescing that makes five viewports one dialog.
        existing.callbacks.push(callback)
        return true
      }
      if (byKey.size >= MAX_PENDING_AUTH) {
        callback()
        return false
      }

      sequence += 1
      const entry: Pending = { id: `auth-${sequence}`, host, isProxy, realm, callbacks: [callback] }
      byKey.set(key, entry)
      byId.set(entry.id, entry)
      schedule()
      return true
    },

    respond(id, credentials): void {
      const entry = byId.get(id)
      // An answer to a challenge that is already gone. Dropped, never guessed
      // at: guessing here would send a password to the wrong server.
      if (entry === undefined) return

      drop(entry)
      settle(entry, credentials)
      schedule()
    },

    pending: prompts,

    dispose(): void {
      if (disposed) return
      disposed = true
      cancelPush?.()
      cancelPush = null
      const entries = [...byKey.values()]
      byKey.clear()
      byId.clear()
      // Cancelled, not left hanging: a request whose callback is never called
      // holds its connection open for as long as the process lives.
      for (const entry of entries) settle(entry, null)
    }
  }
}
