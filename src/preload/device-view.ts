/**
 * The device views' preload — input capture for `SyncEngine`, and nothing else.
 *
 * This script runs inside pages Respo does not control, so its security posture
 * is the design:
 *
 * - **it exposes nothing.** No `contextBridge.exposeInMainWorld`, no globals,
 *   no properties on `window`. The page cannot see it, call it, or reach
 *   `ipcRenderer` through it; it only listens and reports upward.
 * - **it reads nothing.** What travels to main is where the cursor was as a
 *   fraction of the viewport, how far down the document the page is scrolled,
 *   and which key was pressed. No text content, no urls, no element identity —
 *   there is nothing in a payload to leak, and nothing to correlate.
 * - **it is sandbox-safe.** `sandbox: true` stays on the device views
 *   (spec §7a), so this file may only touch `ipcRenderer` and the DOM. No Node.
 *
 * Traffic discipline (CLAUDE.md §4): every listener is passive, and events are
 * coalesced into at most one `send` per animation frame. A scroll gesture fires
 * hundreds of times a second and collapses here into one message per frame with
 * one scroll sample in it.
 */

import { ipcRenderer } from 'electron'
import type { InputEventPayload, SyncCaptureChannel, SyncInputChannel } from '@shared/ipc'

/**
 * The channel, restated rather than imported.
 *
 * A sandboxed preload's `require` resolves `electron` and essentially nothing
 * else, so this file has to bundle to one self-contained script — importing the
 * constant would make rollup factor `@shared/ipc` into a chunk that neither
 * preload could load. The `SyncInputChannel` annotation is what keeps the copy
 * honest: rename the channel in `@shared/ipc` and this stops compiling.
 */
const SYNC_INPUT_CHANNEL: SyncInputChannel = 'sync:input'

/** Same restated-constant contract as above. */
const SYNC_CAPTURE_CHANNEL: SyncCaptureChannel = 'sync:capture'

/**
 * Ceiling on one frame's batch. A page firing synthetic events in a loop must
 * not be able to grow this without bound between frames.
 */
const MAX_BATCH = 64

/** CDP's modifier bitmask, which is also what the engine passes straight on. */
const ALT = 1
const CTRL = 2
const META = 4
const SHIFT = 8

const BUTTONS: Record<number, 'left' | 'middle' | 'right'> = {
  0: 'left',
  1: 'middle',
  2: 'right'
}

let batch: InputEventPayload[] = []
/** Index of this frame's scroll sample, so a newer one replaces it in place. */
let scrollAt = -1
let scheduled = false

/**
 * Whether this view is the one driving the others right now.
 *
 * Starts `true` on purpose. Main decides who leads and drops input from anyone
 * else, so reporting is always *safe*; this flag exists only to stop the eight
 * followers paying for a message per frame that will be discarded on arrival.
 * A view that never hears from main — the message raced this document's load,
 * or main is an older build — therefore behaves exactly as it did before.
 */
let capturing = true

ipcRenderer.on(SYNC_CAPTURE_CHANNEL, (_event, next: unknown) => {
  capturing = next !== false
  if (capturing) return
  // Whatever this frame had collected is no longer anybody's input.
  batch = []
  scrollAt = -1
})

function flush(): void {
  scheduled = false
  scrollAt = -1
  if (batch.length === 0) return

  const payload = batch
  batch = []
  try {
    ipcRenderer.send(SYNC_INPUT_CHANNEL, payload)
  } catch {
    // Main is gone or the view is being torn down. Losing an input event in
    // that moment is correct; throwing inside a page's event listener is not.
  }
}

function schedule(): void {
  if (scheduled) return
  scheduled = true
  window.requestAnimationFrame(flush)
}

function push(event: InputEventPayload): void {
  if (!capturing || batch.length >= MAX_BATCH) return
  batch.push(event)
  schedule()
}

function ratio(offset: number, max: number): number {
  if (max <= 0 || !Number.isFinite(offset)) return 0
  const value = offset / max
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Where the document is, as a fraction of how far it *can* go.
 *
 * A ratio rather than a pixel offset because the same page is a different
 * height in every viewport — proportion is the only thing they share.
 */
function sampleScroll(): void {
  if (!capturing) return
  const el = document.scrollingElement ?? document.documentElement
  if (el === null) return

  const sample: InputEventPayload = {
    kind: 'scroll',
    ratioX: ratio(el.scrollLeft, el.scrollWidth - el.clientWidth),
    ratioY: ratio(el.scrollTop, el.scrollHeight - el.clientHeight)
  }

  // Latest wins: every earlier position in this frame is already stale.
  if (scrollAt >= 0) {
    batch[scrollAt] = sample
    return
  }
  if (batch.length >= MAX_BATCH) return
  scrollAt = batch.length
  batch.push(sample)
  schedule()
}

function modifiers(event: KeyboardEvent | MouseEvent): number {
  return (
    (event.altKey ? ALT : 0) |
    (event.ctrlKey ? CTRL : 0) |
    (event.metaKey ? META : 0) |
    (event.shiftKey ? SHIFT : 0)
  )
}

function onMouse(type: 'down' | 'up'): (event: MouseEvent) => void {
  return (event) => {
    // Only what the *user* did. A page can synthesize a `mousedown` at will,
    // and mirroring it would hand the page control of every other view.
    if (!event.isTrusted) return
    const button = BUTTONS[event.button]
    if (button === undefined) return

    push({
      kind: 'mouse',
      type,
      xNorm: ratio(event.clientX, window.innerWidth),
      yNorm: ratio(event.clientY, window.innerHeight),
      button
    })
  }
}

function onKey(type: 'down' | 'up'): (event: KeyboardEvent) => void {
  return (event) => {
    if (!event.isTrusted) return
    if (event.key === '' || event.key.length > 32 || event.code.length > 32) return

    push({
      kind: 'key',
      type,
      key: event.key,
      code: event.code,
      modifiers: modifiers(event)
    })
  }
}

// Capture phase and `passive: true` throughout: the page must not be able to
// hide an interaction from the mirror by stopping propagation, and Respo must
// never be the reason a scroll janks.
const options: AddEventListenerOptions = { capture: true, passive: true }

window.addEventListener('scroll', sampleScroll, options)
// A wheel that the page consumes still changes nothing to report, but a wheel
// that scrolls does — sampling on both is free, since the frame keeps one.
window.addEventListener('wheel', sampleScroll, options)

// `mousedown` + `mouseup` is deliberately the whole story: replaying that pair
// through CDP is what produces a real click (and a real navigation) on the
// followers, so there is nothing for a separate `click` payload to add.
window.addEventListener('mousedown', onMouse('down'), options)
window.addEventListener('mouseup', onMouse('up'), options)

window.addEventListener('keydown', onKey('down'), options)
window.addEventListener('keyup', onKey('up'), options)

// The click that navigates is also the last thing this document will report.
// Without this, the frame that would have carried it never runs and the
// followers never make the same jump.
window.addEventListener('pagehide', flush, options)
