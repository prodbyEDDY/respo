/**
 * What each page is complaining about: console errors, uncaught exceptions,
 * and elements that stick out past the viewport (spec §5.1 "diagnostics",
 * research §C).
 *
 * Two questions a responsive check keeps asking — "did anything throw on the
 * phone?" and "why is there a horizontal scrollbar?" — answered on every
 * frame at once instead of by opening DevTools on each. Both ride the CDP
 * session every view already has (CLAUDE.md §3):
 *
 * - errors come from `Runtime.exceptionThrown` and `Runtime.consoleAPICalled`,
 *   which need `Runtime.enable` on the view. Counted per device since its
 *   last navigation (`Runtime.executionContextsCleared` is the reset), with
 *   only the last few messages kept: a page throwing in a loop costs a
 *   counter and one IPC per flush window, never one message per throw
 *   (CLAUDE.md §4).
 * - overflow is a one-off `Runtime.evaluate` after a load settles: does the
 *   document scroll sideways, and which elements are past the right edge.
 *   The answer is validated field by field — it is page text — and the
 *   selectors it names never leave main: the renderer highlights by index.
 *
 * Highlighting is a CSS layer (`webContents.insertCSS`), not the DevTools
 * overlay: the outline scrolls with the element, several can be shown at
 * once, and nothing is drawn over the native view by Respo.
 */

import type {
  DiagnosticMessage,
  DiagnosticsPayload,
  HighlightTarget,
  OverflowReport
} from '@shared/ipc'
import type { CdpTarget } from './cdp-controller'
import { immediateDeferrer, type Deferrer } from './load-state-batcher'

/** The slice of `CDPController` the diagnostics drive. */
export interface DiagnosticsCdp {
  enableRuntime(target: CdpTarget): Promise<boolean>
  evaluate<T>(target: CdpTarget, expression: string): Promise<T | null>
  onEvent(target: CdpTarget, listener: (method: string, params: unknown) => void): () => void
}

/** A stylesheet layer on one view: `insertCSS` / `removeInsertedCSS`. */
export interface CssLayer {
  insert(css: string): Promise<string>
  remove(key: string): Promise<void>
}

export type DiagnosticsDeviceRegistration = {
  deviceId: string
  target: CdpTarget
  css: CssLayer
}

/**
 * How a view backend tells the diagnostics which pages exist. Same shape as
 * the other registries: a view is created in one place, and everything that
 * needs a handle on it registers there.
 */
export interface DiagnosticsRegistry {
  registerDevice(registration: DiagnosticsDeviceRegistration): Promise<void>
  /** The view finished loading a document: scan it for overflow. */
  refresh(deviceId: string): void
  unregisterDevice(deviceId: string): void
}

export type DiagnosticsManagerOptions = {
  cdp: DiagnosticsCdp
  /** Told about changed devices, coalesced. One call may carry several. */
  onState?: (batch: DiagnosticsPayload[]) => void
  /** Deferral behind the coalescing. Injectable for tests. */
  deferrer?: Deferrer
  /** Timer behind the settle-delayed rescan. Injectable for tests. */
  setTimer?: (task: () => void, ms: number) => () => void
}

/** How many messages a device keeps. The count is unbounded; the text is not. */
export const MAX_MESSAGES = 20
/** Longest message text worth carrying to a chip's tooltip. */
export const MAX_MESSAGE_LENGTH = 200
/** How many offenders one scan reports. */
export const MAX_OVERFLOW_ITEMS = 10
const MAX_LABEL_LENGTH = 80
const MAX_SELECTOR_LENGTH = 400
/**
 * How long after a load settles the second scan runs: lazy images and fonts
 * arrive after `load`, and an overflow that appears with them is still one.
 */
export const RESCAN_DELAY_MS = 1000

/** What a selector main built in the page may contain. Anything else is refused. */
const SELECTOR_RE = /^[A-Za-z0-9_\-#:>() .\\]+$/

/** The colour of an offender's outline: ember orange, the design system's warning accent. */
const HIGHLIGHT_CSS = 'outline: 2px solid #ff3e00 !important; outline-offset: -2px !important;'

/**
 * The scan, as one self-contained expression.
 *
 * Reads only geometry — no text, no attributes beyond `id`/`class` for the
 * label — and returns plain data. Offenders are outermost-first: an element
 * inside one already listed is skipped, so a wide hero reports itself, not
 * its forty children. Selectors are built from tag, `#id` (escaped) and
 * `:nth-of-type`, which is what `insertCSS` can match again later.
 */
const OVERFLOW_SCAN = `(() => {
  const root = document.documentElement;
  if (!root) return null;
  const clientWidth = root.clientWidth;
  const scrollWidth = root.scrollWidth;
  const items = [];
  if (scrollWidth > clientWidth + 1 && document.body) {
    const flagged = [];
    const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\\w-]/g, '_'));
    const path = (el) => {
      const parts = [];
      let node = el;
      for (let depth = 0; node && node !== document.body && node.nodeType === 1 && depth < 6; depth += 1) {
        const tag = node.tagName.toLowerCase();
        if (node.id) { parts.unshift(tag + '#' + esc(node.id)); return parts.join(' > '); }
        let index = 1;
        let sibling = node;
        while ((sibling = sibling.previousElementSibling)) { if (sibling.tagName === node.tagName) index += 1; }
        parts.unshift(tag + ':nth-of-type(' + index + ')');
        node = node.parentElement;
      }
      parts.unshift('body');
      return parts.join(' > ');
    };
    const label = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      const classes = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
      for (const c of classes) s += '.' + c;
      return s;
    };
    const all = document.body.getElementsByTagName('*');
    for (let i = 0; i < all.length && items.length < ${MAX_OVERFLOW_ITEMS}; i += 1) {
      const el = all[i];
      if (flagged.some((f) => f.contains(el))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      const right = rect.right + window.scrollX;
      if (right <= clientWidth + 1) continue;
      flagged.push(el);
      items.push({ label: label(el), selector: path(el), width: Math.round(rect.width), right: Math.round(right) });
    }
  }
  return { clientWidth, scrollWidth, items };
})()`

type ScanItem = { label: string; width: number; right: number; selector: string }

/**
 * Turn whatever the page answered into a report, or nothing.
 *
 * Field by field and bounded: the page can return anything at all, and one
 * junk item must not cost the report — but it must not reach the renderer or
 * a stylesheet either. Exported for its unit test.
 */
export function parseScan(value: unknown): { report: OverflowReport; selectors: string[] } | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const clientWidth = raw['clientWidth']
  const scrollWidth = raw['scrollWidth']
  if (!isExtent(clientWidth) || !isExtent(scrollWidth)) return null

  const items: ScanItem[] = []
  if (Array.isArray(raw['items'])) {
    for (const entry of raw['items'].slice(0, MAX_OVERFLOW_ITEMS)) {
      if (typeof entry !== 'object' || entry === null) continue
      const item = entry as Record<string, unknown>
      const label = item['label']
      const selector = item['selector']
      const width = item['width']
      const right = item['right']
      if (typeof label !== 'string' || label === '' || typeof selector !== 'string') continue
      if (selector.length > MAX_SELECTOR_LENGTH || !SELECTOR_RE.test(selector)) continue
      if (!isExtent(width) || !isExtent(right)) continue
      items.push({ label: label.slice(0, MAX_LABEL_LENGTH), selector, width, right })
    }
  }

  return {
    report: {
      clientWidth,
      scrollWidth,
      items: items.map(({ label, width, right }) => ({ label, width, right }))
    },
    selectors: items.map((item) => item.selector)
  }
}

function isExtent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
}

/** The first line of a console argument, as text, bounded. */
function textOf(value: unknown): string {
  let text: string
  if (typeof value === 'string') text = value
  else if (typeof value === 'object' && value !== null) {
    const remote = value as Record<string, unknown>
    text =
      typeof remote['description'] === 'string'
        ? remote['description']
        : remote['value'] === undefined
          ? String(remote['className'] ?? remote['type'] ?? '')
          : String(remote['value'])
  } else text = String(value)
  const line = text.split('\n', 1)[0] ?? ''
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : line
}

type Entry = {
  deviceId: string
  target: CdpTarget
  css: CssLayer
  off: () => void
  errors: number
  messages: DiagnosticMessage[]
  overflow: OverflowReport | null
  /** The selectors behind `overflow.items`, by index. Never leave main. */
  selectors: string[]
  /** The stylesheet currently outlining offenders, if one is inserted. */
  highlightKey: string | null
  /** The delayed rescan, if one is armed. */
  cancelRescan: (() => void) | null
  /** Scans are serialized per device; a stale one is dropped. */
  scanToken: number
}

const defaultTimer = (task: () => void, ms: number): (() => void) => {
  const handle = setTimeout(task, ms)
  handle.unref?.()
  return () => clearTimeout(handle)
}

export class DiagnosticsManager implements DiagnosticsRegistry {
  private readonly cdp: DiagnosticsCdp
  private readonly onState: ((batch: DiagnosticsPayload[]) => void) | null
  private readonly deferrer: Deferrer
  private readonly setTimer: (task: () => void, ms: number) => () => void
  private readonly devices = new Map<string, Entry>()
  /** Devices with something new to say, flushed together. */
  private readonly dirty = new Set<string>()
  private cancelFlush: (() => void) | null = null
  private disposed = false

  constructor(options: DiagnosticsManagerOptions) {
    this.cdp = options.cdp
    this.onState = options.onState ?? null
    this.deferrer = options.deferrer ?? immediateDeferrer
    this.setTimer = options.setTimer ?? defaultTimer
  }

  /** Every device's state, for a renderer that has just started. */
  state(): DiagnosticsPayload[] {
    return [...this.devices.values()].map((entry) => this.payloadOf(entry))
  }

  /** Devices currently registered. Test seam. */
  deviceIds(): string[] {
    return [...this.devices.keys()]
  }

  async registerDevice(registration: DiagnosticsDeviceRegistration): Promise<void> {
    if (this.disposed) return
    this.unregisterDevice(registration.deviceId)

    const entry: Entry = {
      deviceId: registration.deviceId,
      target: registration.target,
      css: registration.css,
      off: () => undefined,
      errors: 0,
      messages: [],
      overflow: null,
      selectors: [],
      highlightKey: null,
      cancelRescan: null,
      scanToken: 0
    }
    entry.off = this.cdp.onEvent(entry.target, (method, params) =>
      this.onEvent(entry, method, params)
    )
    this.devices.set(entry.deviceId, entry)
    await this.cdp.enableRuntime(entry.target)
  }

  refresh(deviceId: string): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined || this.disposed) return
    void this.scan(entry)
    // Once more after the page has had a moment: lazy content arrives after
    // `load`, and an overflow it brings is still an overflow.
    entry.cancelRescan?.()
    entry.cancelRescan = this.setTimer(() => {
      entry.cancelRescan = null
      void this.scan(entry)
    }, RESCAN_DELAY_MS)
  }

  unregisterDevice(deviceId: string): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined) return
    this.devices.delete(deviceId)
    this.dirty.delete(deviceId)
    entry.cancelRescan?.()
    entry.off()
    // The stylesheet goes with the view; nothing to remove from a page that is
    // being torn down.
  }

  /** Drop every device outside `live`. Called after the device set changes. */
  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  /**
   * Outline one offender, all of them, or none.
   *
   * One stylesheet per device at a time: a new target replaces the previous
   * layer, and `none` removes it. An index the last report does not have is
   * treated as `none` — the report may have changed under the click.
   */
  async highlight(deviceId: string, target: HighlightTarget): Promise<void> {
    const entry = this.devices.get(deviceId)
    if (entry === undefined || this.disposed) return

    const selectors =
      target === 'none'
        ? []
        : target === 'all'
          ? entry.selectors
          : entry.selectors[target] === undefined
            ? []
            : [entry.selectors[target]]

    if (entry.highlightKey !== null) {
      const key = entry.highlightKey
      entry.highlightKey = null
      try {
        await entry.css.remove(key)
      } catch {
        // The document that held the layer is gone; so is the layer.
      }
    }
    if (selectors.length === 0) return

    try {
      const key = await entry.css.insert(`${selectors.join(', ')} { ${HIGHLIGHT_CSS} }`)
      // A `none` may have raced the insert; honour it.
      if (this.devices.get(deviceId) !== entry) {
        await entry.css.remove(key)
        return
      }
      entry.highlightKey = key
    } catch {
      // A view mid-navigation refuses; there is nothing to outline yet.
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelFlush?.()
    this.cancelFlush = null
    for (const deviceId of [...this.devices.keys()]) this.unregisterDevice(deviceId)
  }

  private onEvent(entry: Entry, method: string, params: unknown): void {
    if (this.disposed) return
    const details = (params ?? {}) as Record<string, unknown>

    if (method === 'Runtime.executionContextsCleared') {
      // A new document: whatever the old one said is no longer about this page.
      entry.errors = 0
      entry.messages = []
      entry.overflow = null
      entry.selectors = []
      entry.highlightKey = null
      this.markDirty(entry)
      return
    }

    if (method === 'Runtime.exceptionThrown') {
      const exception = (details['exceptionDetails'] ?? {}) as Record<string, unknown>
      const thrown = exception['exception'] as Record<string, unknown> | undefined
      const text =
        thrown !== undefined && typeof thrown['description'] === 'string'
          ? textOf(thrown['description'])
          : textOf(exception['text'] ?? 'Uncaught exception')
      this.record(entry, { level: 'exception', text })
      return
    }

    if (method === 'Runtime.consoleAPICalled') {
      const type = details['type']
      if (type !== 'error' && type !== 'assert') return
      const args = Array.isArray(details['args']) ? details['args'] : []
      const text = args
        .map(textOf)
        .filter((part) => part !== '')
        .join(' ')
      this.record(entry, {
        level: type,
        text: text === '' ? (type === 'assert' ? 'Assertion failed' : 'console.error') : text
      })
    }
  }

  private record(entry: Entry, message: DiagnosticMessage): void {
    entry.errors += 1
    entry.messages.push(message)
    if (entry.messages.length > MAX_MESSAGES) entry.messages.shift()
    this.markDirty(entry)
  }

  private async scan(entry: Entry): Promise<void> {
    const token = (entry.scanToken += 1)
    const answer = await this.cdp.evaluate<unknown>(entry.target, OVERFLOW_SCAN)
    // Superseded by a newer scan, or the device left meanwhile.
    if (entry.scanToken !== token || this.devices.get(entry.deviceId) !== entry) return
    const parsed = parseScan(answer)
    if (parsed === null) return

    const before = entry.overflow
    entry.overflow = parsed.report
    entry.selectors = parsed.selectors
    if (before === null || !sameReport(before, parsed.report)) this.markDirty(entry)
  }

  private markDirty(entry: Entry): void {
    this.dirty.add(entry.deviceId)
    this.cancelFlush ??= this.deferrer.defer(() => this.flush())
  }

  private flush(): void {
    this.cancelFlush = null
    if (this.disposed || this.dirty.size === 0) return
    const batch: DiagnosticsPayload[] = []
    for (const deviceId of this.dirty) {
      const entry = this.devices.get(deviceId)
      if (entry !== undefined) batch.push(this.payloadOf(entry))
    }
    this.dirty.clear()
    if (batch.length > 0) this.onState?.(batch)
  }

  private payloadOf(entry: Entry): DiagnosticsPayload {
    return {
      deviceId: entry.deviceId,
      errors: entry.errors,
      messages: entry.messages.map((message) => ({ ...message })),
      overflow:
        entry.overflow === null
          ? null
          : { ...entry.overflow, items: entry.overflow.items.map((item) => ({ ...item })) }
    }
  }
}

function sameReport(a: OverflowReport, b: OverflowReport): boolean {
  if (a.clientWidth !== b.clientWidth || a.scrollWidth !== b.scrollWidth) return false
  if (a.items.length !== b.items.length) return false
  return a.items.every((item, index) => {
    const other = b.items[index]
    return (
      other !== undefined &&
      item.label === other.label &&
      item.width === other.width &&
      item.right === other.right
    )
  })
}
