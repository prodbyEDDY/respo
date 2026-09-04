import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticsPayload } from '@shared/ipc'
import type { CdpTarget } from '../cdp-controller'
import {
  DiagnosticsManager,
  MAX_MESSAGES,
  parseScan,
  RESCAN_DELAY_MS,
  type CssLayer,
  type DiagnosticsCdp
} from '../diagnostics'
import type { Deferrer } from '../load-state-batcher'

type Listener = (method: string, params: unknown) => void

/** A `CDPController` that records, answers scans from a script, and lets a test fire events. */
function fakeCdp(): DiagnosticsCdp & {
  enabled: number[]
  evaluations: number
  answer: unknown
  fire: (id: number, method: string, params?: unknown) => void
} {
  const listeners = new Map<number, Set<Listener>>()
  const cdp = {
    enabled: [] as number[],
    evaluations: 0,
    answer: { clientWidth: 393, scrollWidth: 393, items: [] } as unknown,
    fire(id: number, method: string, params: unknown = {}): void {
      for (const listener of listeners.get(id) ?? []) listener(method, params)
    },
    async enableRuntime(target: CdpTarget): Promise<boolean> {
      cdp.enabled.push(target.id)
      return true
    },
    async evaluate<T>(): Promise<T | null> {
      cdp.evaluations += 1
      return cdp.answer as T
    },
    onEvent(target: CdpTarget, listener: Listener): () => void {
      const set = listeners.get(target.id) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(target.id, set)
      return () => {
        set.delete(listener)
      }
    }
  }
  return cdp
}

function fakeCss(): CssLayer & { inserted: string[]; removed: string[]; live: Set<string> } {
  let next = 1
  const layer = {
    inserted: [] as string[],
    removed: [] as string[],
    live: new Set<string>(),
    async insert(css: string): Promise<string> {
      layer.inserted.push(css)
      const key = `css-${next++}`
      layer.live.add(key)
      return key
    },
    async remove(key: string): Promise<void> {
      layer.removed.push(key)
      layer.live.delete(key)
    }
  }
  return layer
}

let nextId = 1
function target(): CdpTarget {
  return {
    id: nextId++,
    isDestroyed: () => false,
    debugger: {
      isAttached: () => true,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: async () => ({}),
      on: () => undefined
    }
  }
}

/** A deferrer driven by hand, so a test decides when a flush happens. */
function manualDeferrer(): Deferrer & { flush: () => void } {
  let task: (() => void) | null = null
  return {
    defer(next) {
      task = next
      return () => {
        task = null
      }
    },
    flush() {
      const run = task
      task = null
      run?.()
    }
  }
}

function manualTimer(): {
  set: (task: () => void, ms: number) => () => void
  fire: () => void
  pending: number
} {
  const timers: { task: () => void; ms: number }[] = []
  return {
    set(task, ms) {
      const entry = { task, ms }
      timers.push(entry)
      return () => {
        const index = timers.indexOf(entry)
        if (index >= 0) timers.splice(index, 1)
      }
    },
    fire() {
      const pending = timers.splice(0)
      for (const entry of pending) entry.task()
    },
    get pending() {
      return timers.length
    }
  }
}

const remote = (value: string): unknown => ({ type: 'string', value })

describe('parseScan', () => {
  it('reads a clean page', () => {
    expect(parseScan({ clientWidth: 393, scrollWidth: 393, items: [] })).toEqual({
      report: { clientWidth: 393, scrollWidth: 393, items: [] },
      selectors: []
    })
  })

  it('keeps labels and sizes for the renderer and selectors for main', () => {
    const parsed = parseScan({
      clientWidth: 393,
      scrollWidth: 1000,
      items: [{ label: 'div#wide.hero', selector: 'div#wide', width: 1000, right: 1000 }]
    })
    expect(parsed?.report.items).toEqual([{ label: 'div#wide.hero', width: 1000, right: 1000 }])
    expect(parsed?.selectors).toEqual(['div#wide'])
  })

  it('drops an item that could not become a stylesheet, and keeps the rest', () => {
    const parsed = parseScan({
      clientWidth: 393,
      scrollWidth: 1000,
      items: [
        { label: 'bad', selector: 'div { } body { display: none }', width: 1, right: 500 },
        { label: 'x'.repeat(200), selector: 'body > div:nth-of-type(2)', width: 1000, right: 1000 },
        { label: 'nan', selector: 'p', width: Number.NaN, right: 1 },
        { label: 'no selector', width: 1, right: 500 },
        'junk'
      ]
    })
    expect(parsed?.selectors).toEqual(['body > div:nth-of-type(2)'])
    expect(parsed?.report.items[0]?.label).toHaveLength(80)
  })

  it('caps the list at ten', () => {
    const items = Array.from({ length: 30 }, (_v, i) => ({
      label: `div${i}`,
      selector: `body > div:nth-of-type(${i + 1})`,
      width: 500,
      right: 500
    }))
    expect(parseScan({ clientWidth: 100, scrollWidth: 500, items })?.selectors).toHaveLength(10)
  })

  it.each([null, 'nope', { clientWidth: -1, scrollWidth: 1 }, { clientWidth: 1 }])(
    'refuses %j',
    (value) => {
      expect(parseScan(value)).toBeNull()
    }
  )
})

describe('DiagnosticsManager — console errors', () => {
  let cdp: ReturnType<typeof fakeCdp>
  let deferrer: ReturnType<typeof manualDeferrer>
  let batches: DiagnosticsPayload[][]
  let manager: DiagnosticsManager
  let a: CdpTarget

  beforeEach(async () => {
    cdp = fakeCdp()
    deferrer = manualDeferrer()
    batches = []
    manager = new DiagnosticsManager({ cdp, deferrer, onState: (batch) => batches.push(batch) })
    a = target()
    await manager.registerDevice({ deviceId: 'a', target: a, css: fakeCss() })
  })

  it('enables Runtime on a view as it registers', () => {
    expect(cdp.enabled).toEqual([a.id])
    expect(manager.deviceIds()).toEqual(['a'])
  })

  it('counts exceptions and error-level console calls, and keeps their text', () => {
    cdp.fire(a.id, 'Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'Error: boom\n    at x.js:1' } }
    })
    cdp.fire(a.id, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [remote('bad'), remote('thing')]
    })
    cdp.fire(a.id, 'Runtime.consoleAPICalled', { type: 'assert', args: [] })
    deferrer.flush()

    expect(batches).toHaveLength(1)
    expect(batches[0]?.[0]).toMatchObject({ deviceId: 'a', errors: 3 })
    expect(batches[0]?.[0]?.messages).toEqual([
      { level: 'exception', text: 'Error: boom' },
      { level: 'error', text: 'bad thing' },
      { level: 'assert', text: 'Assertion failed' }
    ])
  })

  it('ignores logs, warnings and info', () => {
    for (const type of ['log', 'warning', 'info', 'debug', 'table']) {
      cdp.fire(a.id, 'Runtime.consoleAPICalled', { type, args: [remote('x')] })
    }
    deferrer.flush()
    expect(batches).toEqual([])
  })

  it('coalesces a burst into one message carrying the count', () => {
    for (let i = 0; i < 500; i += 1) {
      cdp.fire(a.id, 'Runtime.consoleAPICalled', { type: 'error', args: [remote(`e${i}`)] })
    }
    deferrer.flush()

    expect(batches).toHaveLength(1)
    const payload = batches[0]?.[0]
    expect(payload?.errors).toBe(500)
    expect(payload?.messages).toHaveLength(MAX_MESSAGES)
    expect(payload?.messages.at(-1)?.text).toBe('e499')
  })

  it('starts over when the page navigates', () => {
    cdp.fire(a.id, 'Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught' } })
    deferrer.flush()
    cdp.fire(a.id, 'Runtime.executionContextsCleared')
    deferrer.flush()

    expect(batches).toHaveLength(2)
    expect(batches[1]?.[0]).toMatchObject({ errors: 0, messages: [], overflow: null })
  })

  it('truncates a long message to one bounded line', () => {
    cdp.fire(a.id, 'Runtime.consoleAPICalled', { type: 'error', args: [remote('x'.repeat(1000))] })
    deferrer.flush()
    expect(batches[0]?.[0]?.messages[0]?.text.length).toBeLessThanOrEqual(200)
  })

  it('stops listening once a device leaves', () => {
    manager.retain(new Set())
    cdp.fire(a.id, 'Runtime.exceptionThrown', { exceptionDetails: { text: 'late' } })
    deferrer.flush()
    expect(batches).toEqual([])
    expect(manager.deviceIds()).toEqual([])
  })
})

describe('DiagnosticsManager — overflow', () => {
  let cdp: ReturnType<typeof fakeCdp>
  let deferrer: ReturnType<typeof manualDeferrer>
  let timer: ReturnType<typeof manualTimer>
  let batches: DiagnosticsPayload[][]
  let manager: DiagnosticsManager
  let css: ReturnType<typeof fakeCss>
  let a: CdpTarget

  const overflowing = {
    clientWidth: 393,
    scrollWidth: 1000,
    items: [
      { label: 'div#wide', selector: 'div#wide', width: 1000, right: 1000 },
      { label: 'img.hero', selector: 'body > img:nth-of-type(1)', width: 600, right: 620 }
    ]
  }

  beforeEach(async () => {
    cdp = fakeCdp()
    deferrer = manualDeferrer()
    timer = manualTimer()
    batches = []
    css = fakeCss()
    manager = new DiagnosticsManager({
      cdp,
      deferrer,
      setTimer: timer.set,
      onState: (batch) => batches.push(batch)
    })
    a = target()
    await manager.registerDevice({ deviceId: 'a', target: a, css })
  })

  it('scans on refresh and reports the offenders without their selectors', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))
    deferrer.flush()

    const payload = batches[0]?.[0]
    expect(payload?.overflow).toEqual({
      clientWidth: 393,
      scrollWidth: 1000,
      items: [
        { label: 'div#wide', width: 1000, right: 1000 },
        { label: 'img.hero', width: 600, right: 620 }
      ]
    })
    expect(JSON.stringify(payload)).not.toContain('nth-of-type')
  })

  it('scans again after the settle delay, and says nothing when nothing changed', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))
    deferrer.flush()
    expect(timer.pending).toBe(1)

    timer.fire()
    await vi.waitFor(() => expect(cdp.evaluations).toBe(2))
    deferrer.flush()
    expect(batches).toHaveLength(1)
  })

  it('reports a page that stopped overflowing', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))
    deferrer.flush()

    cdp.answer = { clientWidth: 393, scrollWidth: 393, items: [] }
    timer.fire()
    await vi.waitFor(() => expect(cdp.evaluations).toBe(2))
    deferrer.flush()
    expect(batches[1]?.[0]?.overflow).toEqual({ clientWidth: 393, scrollWidth: 393, items: [] })
  })

  it('outlines one offender, all of them, and none — one stylesheet at a time', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))

    await manager.highlight('a', 0)
    expect(css.inserted).toEqual([
      'div#wide { outline: 2px solid #ff3e00 !important; outline-offset: -2px !important; }'
    ])
    expect(css.live.size).toBe(1)

    await manager.highlight('a', 'all')
    expect(css.inserted[1]).toContain('div#wide, body > img:nth-of-type(1) {')
    expect(css.live.size).toBe(1)

    await manager.highlight('a', 'none')
    expect(css.live.size).toBe(0)
  })

  it('treats an index the report does not have as none', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))

    await manager.highlight('a', 7)
    expect(css.inserted).toEqual([])
  })

  it('forgets the report and the outline key when the page navigates', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))
    await manager.highlight('a', 'all')

    cdp.fire(a.id, 'Runtime.executionContextsCleared')
    // The stylesheet died with the document; there is nothing to remove.
    await manager.highlight('a', 'all')
    expect(css.inserted).toHaveLength(1)
    expect(css.removed).toEqual([])
  })

  it('drops a scan whose answer arrived after a newer one', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    const first = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    let calls = 0
    cdp.evaluate = async <T>(): Promise<T | null> => {
      calls += 1
      if (calls === 1) return (await first) as T
      return overflowing as T
    }

    manager.refresh('a')
    timer.fire()
    await vi.waitFor(() => expect(calls).toBe(2))
    deferrer.flush()
    expect(batches[0]?.[0]?.overflow?.scrollWidth).toBe(1000)

    resolveFirst({ clientWidth: 393, scrollWidth: 393, items: [] })
    await Promise.resolve()
    deferrer.flush()
    expect(batches).toHaveLength(1)
  })

  it('answers state() for a renderer that has just started', async () => {
    cdp.answer = overflowing
    manager.refresh('a')
    await vi.waitFor(() => expect(cdp.evaluations).toBe(1))
    expect(manager.state()[0]?.overflow?.items).toHaveLength(2)
  })

  it('does nothing after dispose', async () => {
    manager.dispose()
    manager.refresh('a')
    await manager.highlight('a', 'all')
    expect(cdp.evaluations).toBe(0)
    expect(css.inserted).toEqual([])
    expect(RESCAN_DELAY_MS).toBeGreaterThan(0)
  })
})
