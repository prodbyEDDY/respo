import { monitorEventLoopDelay } from 'node:perf_hooks'
import { ms, Samples } from '@shared/stats'

/** Spec §8: the main event loop must not block for longer than one frame. */
export const LOOP_DELAY_BUDGET_MS = 16

export type PerfMonitor = {
  /** Time spent inside one synchronous `applyLayout` pass, in ms. */
  recordLayoutApply: (durationMs: number) => void
  stop: () => void
}

const NS_PER_MS = 1e6

/**
 * Dev-only instrumentation for the perf budget.
 *
 * `monitorEventLoopDelay` is the measurement spec §8 names: it samples how late
 * the loop is, which is exactly "did main block long enough to drop a frame".
 * Reported every `intervalMs` and reset, so each line describes its own window
 * rather than the whole session.
 */
export function startPerfMonitor(
  log: (line: string) => void = console.log,
  intervalMs = 5_000
): PerfMonitor {
  const histogram = monitorEventLoopDelay({ resolution: 1 })
  histogram.enable()

  const layout = new Samples()

  const timer = setInterval(() => {
    const loopP50 = histogram.percentile(50) / NS_PER_MS
    const loopP99 = histogram.percentile(99) / NS_PER_MS
    const loopMax = histogram.max / NS_PER_MS
    const applies = layout.snapshot()

    log(
      `[perf] loop p50=${ms(loopP50)}ms p99=${ms(loopP99)}ms max=${ms(loopMax)}ms` +
        ` | applyLayout n=${applies.count} p50=${ms(applies.p50)}ms p99=${ms(applies.p99)}ms max=${ms(applies.max)}ms` +
        ` | budget(p99<${LOOP_DELAY_BUDGET_MS}ms)=${loopP99 < LOOP_DELAY_BUDGET_MS ? 'ok' : 'MISS'}`
    )

    histogram.reset()
    layout.reset()
  }, intervalMs)
  timer.unref()

  return {
    recordLayoutApply: (durationMs) => layout.add(durationMs),
    stop: () => {
      clearInterval(timer)
      histogram.disable()
    }
  }
}
