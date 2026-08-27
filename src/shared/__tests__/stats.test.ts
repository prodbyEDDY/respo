import { describe, expect, it } from 'vitest'
import { Samples } from '../stats'

describe('Samples', () => {
  it('reports zeros before anything is recorded', () => {
    expect(new Samples().snapshot()).toEqual({ count: 0, mean: 0, p50: 0, p99: 0, max: 0 })
  })

  it('computes nearest-rank percentiles regardless of insertion order', () => {
    const samples = new Samples()
    for (const value of [5, 1, 4, 2, 3]) samples.add(value)

    const snapshot = samples.snapshot()
    expect(snapshot.count).toBe(5)
    expect(snapshot.p50).toBe(3)
    expect(snapshot.max).toBe(5)
    expect(snapshot.mean).toBe(3)
  })

  it('puts p99 on the tail, which is what the budget is about', () => {
    const samples = new Samples()
    for (let value = 1; value <= 100; value += 1) samples.add(value)

    expect(samples.snapshot().p99).toBe(99)
  })

  it('ignores non-finite values instead of poisoning the percentiles', () => {
    const samples = new Samples()
    samples.add(Number.NaN)
    samples.add(Number.POSITIVE_INFINITY)
    samples.add(7)

    expect(samples.snapshot()).toMatchObject({ count: 1, p99: 7 })
  })

  it('drops the oldest sample once the ring is full', () => {
    const samples = new Samples(3)
    for (const value of [100, 1, 2, 3]) samples.add(value)

    expect(samples.snapshot()).toMatchObject({ count: 3, max: 3 })
  })

  it('resets back to empty', () => {
    const samples = new Samples()
    samples.add(1)
    samples.reset()

    expect(samples.snapshot().count).toBe(0)
  })
})
