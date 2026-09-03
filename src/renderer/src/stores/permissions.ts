import { create } from 'zustand'
import {
  DEFAULT_PERMISSION_DECISIONS,
  type MainEvent,
  type PermissionDecision,
  type PermissionPrompt,
  type PermissionStatePayload,
  type PermissionType,
  type RespoApi
} from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

/**
 * The renderer's half of site permissions: what this site may do, and what it
 * is currently asking for.
 *
 * Main is the authority on all of it — it is the side that hears the questions,
 * knows which site asked, and owns the file the answers live in — so nothing
 * here is guessed. Every mutation forwards to main and installs the state that
 * comes back, and main pushes the same shape whenever something changes without
 * being asked (a page asking for a camera, the canvas moving to another site).
 *
 * The renderer never names an origin. It answers a *question* by id and sets a
 * *capability* by type; which site that is, is main's answer.
 */
export interface PermissionsState {
  /** The site the canvas is on, as main computed it. `null` when there is none. */
  origin: string | null
  /** What this site may do, defaults already applied. */
  decisions: Record<PermissionType, PermissionDecision>
  /** Questions waiting for an answer, oldest first. */
  prompts: PermissionPrompt[]
  /**
   * Whether a decision changed since the page was loaded.
   *
   * A permission is read by a page when it *asks*, so a site that already tried
   * and was refused does not notice being allowed afterwards. The panel says so
   * — "Reload to apply" — rather than reloading on its own: a reload throws away
   * whatever state the page is in, and that is the user's call to make.
   */
  changed: boolean

  /** Answer one prompt. Allow or block, remembered for the site either way. */
  respond: (id: string, allow: boolean) => void
  /**
   * Put one prompt away without answering it — what clicking outside the bubble
   * means. Nothing is remembered and the site may ask again.
   */
  dismiss: (id: string) => void
  /** Set one capability for the site the canvas is on. */
  setDecision: (type: PermissionType, decision: PermissionDecision) => void
  /** Allow -> Block -> Ask -> Allow. What a click on a row does. */
  cycle: (type: PermissionType) => void
  /** Forget every decision for this site. */
  resetAll: () => void
  /** Ask main for the current picture. For a panel that has just opened. */
  refresh: () => void
  /** Reload every view, and stop saying the page is out of date. */
  reload: () => void
  /** Install a state main just reported. Idempotent. */
  apply: (state: PermissionStatePayload) => void
}

function withBridge<T>(run: (bridge: RespoApi) => Promise<T>, install?: (answer: T) => void): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(
    (answer) => install?.(answer),
    (error: unknown) => {
      console.error('permissions ipc failed', error)
    }
  )
}

/** Allow -> Block -> Ask -> Allow. Three states, one control. */
export function nextDecision(decision: PermissionDecision): PermissionDecision {
  if (decision === 'allow') return 'block'
  if (decision === 'block') return 'ask'
  return 'allow'
}

export const usePermissions = create<PermissionsState>((set, get) => ({
  origin: null,
  decisions: { ...DEFAULT_PERMISSION_DECISIONS },
  prompts: [],
  changed: false,

  respond: (id, allow) => {
    // Optimistic only in the sense that the prompt goes away on the click: the
    // question has been answered, and leaving it up for a round trip would
    // invite a second click on an answer that is already on its way.
    set({ prompts: get().prompts.filter((prompt) => prompt.id !== id), changed: true })
    withBridge((bridge) => bridge.invoke('permissions:respond', id, allow))
  },

  dismiss: (id) => {
    // No `changed`: nothing was decided, so there is nothing a reload would
    // apply.
    set({ prompts: get().prompts.filter((prompt) => prompt.id !== id) })
    withBridge((bridge) => bridge.invoke('permissions:dismiss', id))
  },

  setDecision: (type, decision) => {
    if (get().decisions[type] === decision) return
    // Optimistic for the row, authoritative from main: the click has to land on
    // the control immediately, and the answer that comes back is the truth.
    set({ decisions: { ...get().decisions, [type]: decision }, changed: true })
    withBridge(
      (bridge) => bridge.invoke('permissions:set', type, decision),
      (state) => get().apply(state)
    )
  },

  cycle: (type) => {
    get().setDecision(type, nextDecision(get().decisions[type]))
  },

  resetAll: () => {
    set({ decisions: { ...DEFAULT_PERMISSION_DECISIONS }, changed: true })
    withBridge(
      (bridge) => bridge.invoke('permissions:reset'),
      (state) => get().apply(state)
    )
  },

  refresh: () => {
    withBridge(
      (bridge) => bridge.invoke('permissions:get'),
      (state) => get().apply(state)
    )
  },

  reload: () => {
    set({ changed: false })
    withBridge((bridge) => bridge.invoke('nav:reload'))
  },

  apply: (state) => {
    const current = get()
    // A new site is a new set of decisions, and nothing about the last one is
    // still pending application.
    const movedSite = current.origin !== state.origin
    if (
      !movedSite &&
      samePrompts(current.prompts, state.prompts) &&
      sameDecisions(current.decisions, state.decisions)
    ) {
      return
    }
    set({
      origin: state.origin,
      decisions: { ...state.decisions },
      prompts: state.prompts.map((prompt) => ({ ...prompt, types: [...prompt.types] })),
      ...(movedSite ? { changed: false } : {})
    })
  }
}))

function sameDecisions(
  a: Record<PermissionType, PermissionDecision>,
  b: Record<PermissionType, PermissionDecision>
): boolean {
  return (Object.keys(a) as PermissionType[]).every((type) => a[type] === b[type])
}

function samePrompts(a: readonly PermissionPrompt[], b: readonly PermissionPrompt[]): boolean {
  return a.length === b.length && a.every((prompt, index) => prompt.id === b[index]?.id)
}

/** The question the prompt is showing: the oldest one still unanswered. */
export function selectPrompt(state: PermissionsState): PermissionPrompt | null {
  return state.prompts[0] ?? null
}

let unsubscribe: (() => void) | null = null
let subscribers = 0

/**
 * Subscribe the store to main's permission pushes.
 *
 * Reference-counted like the other bridges: React StrictMode mounts, tears down
 * and re-mounts in development, and the subscription must survive that without
 * ending up attached twice.
 */
export function attachPermissionsBridge(): () => void {
  subscribers += 1

  if (unsubscribe === null) {
    const bridge = ipcBridge()
    unsubscribe =
      bridge?.onMainEvent((event: MainEvent) => {
        if (event.type === 'permission-state') usePermissions.getState().apply(event.payload)
      }) ?? (() => undefined)
    // A window that just started has been pushed nothing yet.
    usePermissions.getState().refresh()
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
