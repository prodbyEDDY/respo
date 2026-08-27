import { ms, Samples } from '@shared/stats'

export type LayoutTelemetry = {
  /** One completed `views:set-layout` round trip, in milliseconds. */
  record: (durationMs: number) => void
  stop: () => void
}

/**
 * Dev-only counterpart to the main-process perf monitor.
 *
 * Two numbers matter for the R1 spike. `sends` is the coalescing proof: under
 * continuous scroll it must stay at or below the display refresh rate no
 * matter how fast input arrives. The percentiles are how long the renderer
 * waits between asking for a layout and main having applied every bound —
 * the visible lag between a frame and its view.
 */
export function createLayoutTelemetry(
  intervalMs = 5_000,
  log: (line: string) => void = console.log
): LayoutTelemetry {
  const samples = new Samples()

  const timer = setInterval(() => {
    const snapshot = samples.snapshot()
    if (snapshot.count === 0) return
    samples.reset()

    const perSecond = snapshot.count / (intervalMs / 1000)
    log(
      `[perf/renderer] sends=${snapshot.count} (${perSecond.toFixed(1)}/s)` +
        ` roundtrip p50=${ms(snapshot.p50)}ms p99=${ms(snapshot.p99)}ms max=${ms(snapshot.max)}ms`
    )
  }, intervalMs)

  return {
    record: (durationMs) => samples.add(durationMs),
    stop: () => clearInterval(timer)
  }
}
