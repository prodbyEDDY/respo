import type { BrowserWindow } from 'electron'
import { captureWindow } from './capture'

/**
 * Dev-only driver for the R1 acceptance run (spec §9a).
 *
 * Injects trusted wheel events into the app window for 30 seconds — the "10
 * viewports, continuous scroll" scenario of spec §8 — so the perf numbers come
 * from the real input path instead of a synthetic `scrollTop` loop. Synthetic
 * DOM `wheel` events would not scroll anything: only trusted input reaches the
 * compositor.
 *
 * Enabled with `RESPO_SPIKE=1`; never runs in a packaged build.
 */
export type SpikeOptions = {
  durationMs?: number
  /** Gap between injected wheel events. 8ms ≈ 125 Hz, faster than 60fps frames. */
  intervalMs?: number
  /** Wheel notches per event. */
  deltaY?: number
  /** How long to scroll one way before turning around. */
  reverseEveryMs?: number
  /** Delay before starting, to let ten pages finish loading. */
  warmupMs?: number
  /** When set, window grabs are written here: idle, mid-scroll, and settled. */
  captureDir?: string
  log?: (line: string) => void
}

/** Fractions of the run at which a mid-scroll grab is taken. */
const CAPTURE_AT = [0.3, 0.55, 0.8]

export function runScrollSpike(window: BrowserWindow, options: SpikeOptions = {}): () => void {
  const {
    durationMs = 30_000,
    intervalMs = 8,
    // 12px per event at 125Hz ≈ 1500 px/s — a brisk trackpad flick.
    deltaY = 12,
    reverseEveryMs = 3_000,
    warmupMs = 8_000,
    captureDir,
    log = console.log
  } = options

  let timer: NodeJS.Timeout | null = null
  let stopped = false

  const capture = async (name: string): Promise<void> => {
    if (captureDir === undefined) return
    try {
      const file = await captureWindow(window, captureDir, name)
      log(`[spike] capture ${name}: ${file ?? 'unavailable'}`)
    } catch (error) {
      log(`[spike] capture ${name} failed: ${String(error)}`)
    }
  }

  const stop = (): void => {
    stopped = true
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  const start = async (): Promise<void> => {
    if (stopped || window.isDestroyed()) return

    const [width = 0, height = 0] = window.getContentSize()
    const x = Math.round(width / 2)
    const y = Math.round(height / 2)
    let injected = 0
    let direction = -1

    // Grab the still canvas *before* any wheel event, so the idle shot really
    // shows an idle canvas.
    await capture('01-idle')
    if (stopped || window.isDestroyed()) return

    log(`[spike] scrolling for ${durationMs}ms at ${intervalMs}ms intervals (${x}, ${y})`)
    const startedAt = Date.now()
    let captured = 0

    timer = setInterval(() => {
      if (window.isDestroyed()) return stop()

      const elapsed = Date.now() - startedAt
      if (elapsed >= durationMs) {
        log(`[spike] done: ${injected} wheel events over ${elapsed}ms`)
        stop()
        // Once the canvas is still again, frames and views must agree exactly.
        setTimeout(() => void capture('03-settled'), 500)
        return
      }

      // Mid-flight, wheel events still arriving: this is where tearing shows.
      // Three grabs at different phases of the zigzag, so one unlucky moment
      // at a scroll limit cannot pass for "no jitter".
      while (captured < CAPTURE_AT.length && elapsed > (CAPTURE_AT[captured] ?? 1) * durationMs) {
        void capture(`02-scrolling-${captured + 1}`)
        captured += 1
      }

      direction = Math.floor(elapsed / reverseEveryMs) % 2 === 0 ? -1 : 1
      window.webContents.sendInputEvent({
        type: 'mouseWheel',
        x,
        y,
        deltaX: 0,
        deltaY: direction * deltaY,
        canScroll: true
      })
      injected += 1
    }, intervalMs)
  }

  const warmup = setTimeout(() => void start(), warmupMs)
  warmup.unref()

  return () => {
    clearTimeout(warmup)
    stop()
  }
}
