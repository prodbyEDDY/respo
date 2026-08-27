/** Summary of a measurement window. All values share the unit that was fed in. */
export type StatsSnapshot = {
  count: number
  mean: number
  p50: number
  p99: number
  max: number
}

const EMPTY: StatsSnapshot = { count: 0, mean: 0, p50: 0, p99: 0, max: 0 }

/**
 * Fixed-capacity sample ring for latency budgets (spec §8).
 *
 * Deliberately allocation-free per sample: it sits on the per-frame layout path
 * in both processes, so it must not be the thing that causes a long frame.
 */
export class Samples {
  private readonly values: Float64Array
  private cursor = 0
  private filled = 0

  constructor(capacity = 4096) {
    this.values = new Float64Array(Math.max(1, capacity))
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return
    this.values[this.cursor] = value
    this.cursor = (this.cursor + 1) % this.values.length
    if (this.filled < this.values.length) this.filled += 1
  }

  reset(): void {
    this.cursor = 0
    this.filled = 0
  }

  snapshot(): StatsSnapshot {
    if (this.filled === 0) return { ...EMPTY }

    const sorted = this.values.slice(0, this.filled).sort()
    let total = 0
    for (const value of sorted) total += value

    return {
      count: this.filled,
      mean: total / this.filled,
      p50: percentile(sorted, 50),
      p99: percentile(sorted, 99),
      max: sorted[this.filled - 1] ?? 0
    }
  }
}

/** Nearest-rank percentile over an ascending array. */
function percentile(sorted: Float64Array, p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index] ?? 0
}

/** `12.3456` -> `12.35`, for log lines that humans read. */
export function ms(value: number): string {
  return value.toFixed(2)
}
