import { describe, expect, it } from 'vitest'
import type { ShotStatePayload } from '@shared/ipc'
import type { CaptureOptions, CdpTarget } from '../cdp-controller'
import type { Deferrer } from '../load-state-batcher'
import {
  isInsideDirectory,
  ScreenshotQueue,
  sanitizeDeviceName,
  shotFileName,
  type ShotCdp,
  type ShotFileSystem
} from '../screenshot-queue'

/** A device view, as far as the queue is concerned: an id and a debugger. */
function fakeTarget(id: number): CdpTarget {
  return {
    id,
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

type Capture = { targetId: number; options: CaptureOptions }

type FakeCdp = ShotCdp & {
  calls: Capture[]
  /** Highest number of captures that were in flight at the same moment. */
  peak: number
  /** Release the capture for this target. Until then it hangs. */
  settle(targetId: number, answer: Buffer | Error): void
  inFlight(): number[]
}

/**
 * A CDP double whose captures do not finish until the test says so — the only
 * way to observe the concurrency limit, which is a statement about what is
 * happening *at once*.
 */
function fakeCdp(): FakeCdp {
  const waiting = new Map<number, (result: Buffer | Error) => void>()
  const cdp: FakeCdp = {
    calls: [],
    peak: 0,
    inFlight: () => [...waiting.keys()],
    settle: (targetId, answer) => {
      const resolve = waiting.get(targetId)
      if (resolve === undefined) throw new Error(`nothing in flight for target ${targetId}`)
      waiting.delete(targetId)
      resolve(answer)
    },
    capture: (target, options) => {
      cdp.calls.push({ targetId: target.id, options })
      return new Promise<Buffer | null>((resolve, reject) => {
        waiting.set(target.id, (answer) => {
          if (answer instanceof Error) reject(answer)
          else resolve(answer)
        })
        cdp.peak = Math.max(cdp.peak, waiting.size)
      })
    }
  }
  return cdp
}

type FakeFs = ShotFileSystem & {
  files: Map<string, Buffer>
  made: string[]
  /** Paths whose write should blow up, simulating a full or read-only disk. */
  failWrites: Set<string>
}

function fakeFs(): FakeFs {
  const fs: FakeFs = {
    files: new Map(),
    made: [],
    failWrites: new Set(),
    join: (directory, name) => `${directory}/${name}`,
    mkdir: async (directory) => {
      fs.made.push(directory)
    },
    exists: async (path) => fs.files.has(path),
    write: async (path, data) => {
      if (fs.failWrites.has(path)) throw new Error('disk is full')
      fs.files.set(path, data)
    },
    contains: (directory, path) => path.startsWith(`${directory}/`)
  }
  return fs
}

/** Flushes on demand, so a test can assert what one turn actually sent. */
function manualDeferrer(): Deferrer & { run(): void } {
  let task: (() => void) | null = null
  return {
    defer(next) {
      task = next
      return () => {
        task = null
      }
    },
    run() {
      const pending = task
      task = null
      pending?.()
    }
  }
}

const NOW = new Date(2026, 7, 28, 14, 30, 5)
const DIRECTORY = '/shots'

type Harness = {
  queue: ScreenshotQueue
  cdp: FakeCdp
  fs: FakeFs
  deferrer: Deferrer & { run(): void }
  /** Every payload the renderer would have received, newest last. */
  events: ShotStatePayload[]
  /** Flush the batcher and read what it sent. */
  flush(): ShotStatePayload[]
  copied: Buffer[]
  revealed: string[]
}

function harness(options: { concurrency?: number; devices?: number } = {}): Harness {
  const cdp = fakeCdp()
  const fs = fakeFs()
  const deferrer = manualDeferrer()
  const events: ShotStatePayload[] = []
  const copied: Buffer[] = []
  const revealed: string[] = []

  const queue = new ScreenshotQueue({
    cdp,
    fs,
    directory: () => DIRECTORY,
    defaults: () => ({ format: 'png', dpr: 'device' }),
    onState: (batch) => events.push(...batch),
    copyImage: (png) => {
      copied.push(png)
    },
    revealFile: (path) => {
      revealed.push(path)
    },
    now: () => NOW,
    deferrer,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency })
  })

  for (let i = 0; i < (options.devices ?? 0); i += 1) {
    queue.registerDevice({
      deviceId: `device-${i}`,
      name: `Device ${i}`,
      width: 400 + i,
      height: 800,
      target: fakeTarget(i + 1)
    })
  }

  return {
    queue,
    cdp,
    fs,
    deferrer,
    events,
    copied,
    revealed,
    flush(): ShotStatePayload[] {
      const before = events.length
      deferrer.run()
      return events.slice(before)
    }
  }
}

/** Let every already-settled promise run its continuations. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('shotFileName', () => {
  it('names a file after the device, its viewport and the moment', () => {
    expect(
      shotFileName({
        deviceName: 'iPhone 15 Pro',
        width: 393,
        height: 852,
        now: NOW,
        format: 'png',
        attempt: 1
      })
    ).toBe('iphone-15-pro-393x852-20260828-143005.png')
  })

  it('appends the collision suffix from the second attempt on', () => {
    const name = shotFileName({
      deviceName: 'Pixel 8',
      width: 412,
      height: 915,
      now: NOW,
      format: 'jpeg',
      attempt: 3
    })
    // `jpeg` is the codec CDP is asked for; `.jpg` is what the file is called.
    expect(name).toBe('pixel-8-412x915-20260828-143005-3.jpg')
  })

  it('rounds a fractional viewport rather than putting a dot in the name', () => {
    const name = shotFileName({
      deviceName: 'Custom',
      width: 412.4,
      height: 914.6,
      now: NOW,
      format: 'png',
      attempt: 1
    })
    expect(name).toBe('custom-412x915-20260828-143005.png')
  })
})

describe('sanitizeDeviceName', () => {
  it('reduces a name to something a filesystem will take', () => {
    expect(sanitizeDeviceName('iPad Pro 11"')).toBe('ipad-pro-11')
    expect(sanitizeDeviceName('  My/Device: v2  ')).toBe('my-device-v2')
  })

  it('falls back rather than producing an empty name', () => {
    expect(sanitizeDeviceName('📱')).toBe('device')
    expect(sanitizeDeviceName('...')).toBe('device')
  })

  it('never ends on the dash a truncation left behind', () => {
    const name = sanitizeDeviceName('a'.repeat(38) + ' bbbb')
    expect(name.endsWith('-')).toBe(false)
  })
})

describe('isInsideDirectory', () => {
  it('accepts a file in the folder', () => {
    expect(isInsideDirectory('/shots', '/shots/a.png')).toBe(true)
    expect(isInsideDirectory('/shots', '/shots/nested/a.png')).toBe(true)
  })

  it('refuses a walk out of it', () => {
    expect(isInsideDirectory('/shots', '/shots/../secrets/id_rsa')).toBe(false)
    expect(isInsideDirectory('/shots', '/etc/passwd')).toBe(false)
  })

  it('refuses a sibling whose name merely starts the same way', () => {
    expect(isInsideDirectory('/shots', '/shots-private/a.png')).toBe(false)
  })

  it('refuses the folder itself, and anything empty', () => {
    expect(isInsideDirectory('/shots', '/shots')).toBe(false)
    expect(isInsideDirectory('', '/shots/a.png')).toBe(false)
    expect(isInsideDirectory('/shots', '')).toBe(false)
  })
})

describe('ScreenshotQueue', () => {
  it('captures every device and writes one file each', async () => {
    const h = harness({ devices: 3 })

    const started = h.queue.captureAll({ fullPage: false })
    expect(started.queued).toBe(3)

    for (const targetId of h.cdp.inFlight()) h.cdp.settle(targetId, Buffer.from('png'))
    await settle()

    expect([...h.fs.files.keys()].sort()).toEqual([
      '/shots/device-0-400x800-20260828-143005.png',
      '/shots/device-1-401x800-20260828-143005.png',
      '/shots/device-2-402x800-20260828-143005.png'
    ])
    // One `mkdir` per job is cheap and idempotent; the point is that the folder
    // is never assumed to exist.
    expect(h.fs.made).toEqual([DIRECTORY, DIRECTORY, DIRECTORY])
  })

  it('runs at most three captures at once', async () => {
    const h = harness({ devices: 6 })

    h.queue.captureAll({ fullPage: true })
    expect(h.cdp.inFlight()).toHaveLength(3)

    // Finishing one lets exactly one more start.
    h.cdp.settle(h.cdp.inFlight()[0] as number, Buffer.from('png'))
    await settle()
    expect(h.cdp.inFlight()).toHaveLength(3)

    for (const targetId of h.cdp.inFlight()) h.cdp.settle(targetId, Buffer.from('png'))
    await settle()
    for (const targetId of h.cdp.inFlight()) h.cdp.settle(targetId, Buffer.from('png'))
    await settle()

    expect(h.cdp.peak).toBe(3)
    expect(h.fs.files.size).toBe(6)
  })

  it('keeps the batch going when one capture fails, and says which', async () => {
    const h = harness({ devices: 3 })
    h.queue.captureAll({ fullPage: false })

    h.cdp.settle(1, Buffer.from('png'))
    h.cdp.settle(2, new Error('page is gone'))
    h.cdp.settle(3, Buffer.from('png'))
    await settle()

    const events = h.flush()
    const byDevice = new Map(events.map((event) => [event.deviceId, event]))
    expect(byDevice.get('device-0')?.state).toBe('done')
    expect(byDevice.get('device-1')?.state).toBe('failed')
    expect(byDevice.get('device-1')?.error).toContain('page is gone')
    expect(byDevice.get('device-2')?.state).toBe('done')
    // The other two files exist: one failure is one file, not a dead batch.
    expect(h.fs.files.size).toBe(2)
  })

  it('reports a capture that answered with no image as a failure', async () => {
    const h = harness({ devices: 1 })
    h.queue.captureDevice('device-0', { fullPage: false })

    h.cdp.settle(1, Buffer.alloc(0))
    await settle()

    const [event] = h.flush()
    expect(event?.state).toBe('failed')
    expect(h.fs.files.size).toBe(0)
  })

  it('reports a write that failed rather than claiming a path', async () => {
    const h = harness({ devices: 1 })
    h.fs.failWrites.add('/shots/device-0-400x800-20260828-143005.png')

    h.queue.captureDevice('device-0', { fullPage: false })
    h.cdp.settle(1, Buffer.from('png'))
    await settle()

    const [event] = h.flush()
    expect(event?.state).toBe('failed')
    expect(event?.path).toBeUndefined()
    expect(event?.error).toContain('disk is full')
  })

  it('carries the batch id and size, so N-of-M is countable', async () => {
    const h = harness({ devices: 3 })
    const started = h.queue.captureAll({ fullPage: false })

    for (const targetId of h.cdp.inFlight()) h.cdp.settle(targetId, Buffer.from('png'))
    await settle()

    const events = h.flush()
    expect(events).toHaveLength(3)
    for (const event of events) {
      expect(event.batchId).toBe(started.batchId)
      expect(event.batchSize).toBe(3)
    }
    expect(new Set(events.map((event) => event.id)).size).toBe(3)
  })

  it('sends one batched message per turn rather than one per transition', async () => {
    const h = harness({ devices: 2 })
    h.queue.captureAll({ fullPage: false })

    for (const targetId of h.cdp.inFlight()) h.cdp.settle(targetId, Buffer.from('png'))
    await settle()

    // queued -> active -> done for two devices is four transitions and two
    // payloads: the newest state per job is what the renderer needs.
    const events = h.flush()
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.state === 'done')).toBe(true)
  })

  it('suffixes a second shot of the same device in the same second', async () => {
    const h = harness({ devices: 1 })

    h.queue.captureDevice('device-0', { fullPage: false })
    h.cdp.settle(1, Buffer.from('one'))
    await settle()

    h.queue.captureDevice('device-0', { fullPage: false })
    h.cdp.settle(1, Buffer.from('two'))
    await settle()

    expect([...h.fs.files.keys()]).toEqual([
      '/shots/device-0-400x800-20260828-143005.png',
      '/shots/device-0-400x800-20260828-143005-2.png'
    ])
  })

  it('does not hand two concurrent jobs the same unwritten name', async () => {
    const h = harness({ devices: 2 })
    // Same name for both devices: the reservation, not the name, is what has to
    // keep them apart.
    h.queue.updateDevice('device-1', { name: 'Device 0', width: 400, height: 800 })

    h.queue.captureAll({ fullPage: false })
    h.cdp.settle(1, Buffer.from('one'))
    h.cdp.settle(2, Buffer.from('two'))
    await settle()

    expect([...h.fs.files.keys()].sort()).toEqual([
      '/shots/device-0-400x800-20260828-143005-2.png',
      '/shots/device-0-400x800-20260828-143005.png'
    ])
  })

  it('never runs two captures of the same device at once', async () => {
    const h = harness({ devices: 2 })

    // Two gestures on one device — the camera button pressed twice, or a
    // single shot landing inside a "screenshot everything". Both fit inside the
    // concurrency budget, so nothing but the per-device rule keeps them apart.
    h.queue.captureDevice('device-0', { fullPage: false })
    h.queue.captureDevice('device-0', { fullPage: true, dpr: 1 })

    // A capture owns its view's emulation while it runs: the second one would
    // resize the frame and drop the density under the first one's feet, and the
    // first one's restore would land in the middle of the second one.
    expect(h.cdp.calls).toHaveLength(1)
    expect(h.cdp.inFlight()).toEqual([1])

    h.cdp.settle(1, Buffer.from('one'))
    await settle()

    // Only once the first has finished.
    expect(h.cdp.calls).toHaveLength(2)
    expect(h.cdp.calls[1]?.options).toMatchObject({ fullPage: true, dpr: 1 })
    h.cdp.settle(1, Buffer.from('two'))
    await settle()

    expect([...h.fs.files.keys()]).toEqual([
      '/shots/device-0-400x800-20260828-143005.png',
      '/shots/device-0-400x800-20260828-143005-2.png'
    ])
  })

  it('still runs different devices side by side', async () => {
    const h = harness({ devices: 2 })

    h.queue.captureDevice('device-0', { fullPage: false })
    h.queue.captureDevice('device-1', { fullPage: false })
    // Different views are different CDP sessions; serializing them would make
    // "screenshot every device" as slow as the slowest page, one at a time.
    expect(h.cdp.inFlight()).toEqual([1, 2])

    for (const targetId of h.cdp.inFlight()) h.cdp.settle(targetId, Buffer.from('png'))
    await settle()
    expect(h.fs.files.size).toBe(2)
  })

  it('lets the next shot of a device run after one of them failed', async () => {
    const h = harness({ devices: 1 })

    h.queue.captureDevice('device-0', { fullPage: false })
    h.queue.captureDevice('device-0', { fullPage: false })

    h.cdp.settle(1, new Error('page is gone'))
    await settle()

    // A rejected capture must not leave every later shot of that device
    // hanging off it.
    expect(h.cdp.calls).toHaveLength(2)
    h.cdp.settle(1, Buffer.from('png'))
    await settle()
    expect(h.fs.files.size).toBe(1)
  })

  it('takes format and density from the request, falling back to the settings', async () => {
    const h = harness({ devices: 1 })

    h.queue.captureDevice('device-0', { fullPage: true, format: 'jpeg', dpr: 1 })
    h.cdp.settle(1, Buffer.from('jpg'))
    await settle()

    expect(h.cdp.calls[0]?.options).toEqual({ format: 'jpeg', fullPage: true, dpr: 1 })
    expect([...h.fs.files.keys()]).toEqual(['/shots/device-0-400x800-20260828-143005.jpg'])

    h.queue.captureDevice('device-0', { fullPage: false })
    h.cdp.settle(1, Buffer.from('png'))
    await settle()
    expect(h.cdp.calls[1]?.options).toEqual({ format: 'png', fullPage: false, dpr: 'device' })
  })

  it('queues nothing for a device that is not on the canvas', () => {
    const h = harness({ devices: 1 })
    expect(h.queue.captureDevice('ghost', { fullPage: false })).toMatchObject({ queued: 0 })
    expect(h.cdp.calls).toHaveLength(0)
  })

  it('forgets a device that left the canvas', () => {
    const h = harness({ devices: 3 })
    h.queue.retain(new Set(['device-0', 'device-2']))
    expect(h.queue.deviceIds()).toEqual(['device-0', 'device-2'])
    expect(h.queue.captureAll({ fullPage: false }).queued).toBe(2)
  })

  it('copies one viewport to the clipboard without touching the disk', async () => {
    const h = harness({ devices: 1 })

    const copying = h.queue.copy('device-0')
    h.cdp.settle(1, Buffer.from('png'))
    await expect(copying).resolves.toBe(true)

    expect(h.copied).toHaveLength(1)
    expect(h.fs.files.size).toBe(0)
    // Always the visible viewport, always lossless.
    expect(h.cdp.calls[0]?.options).toMatchObject({ format: 'png', fullPage: false })
  })

  it('reports a copy that produced nothing rather than claiming one', async () => {
    const h = harness({ devices: 1 })
    const copying = h.queue.copy('device-0')
    h.cdp.settle(1, new Error('no debugger'))
    await expect(copying).resolves.toBe(false)
    expect(h.copied).toHaveLength(0)
  })

  it('reveals a screenshot, and refuses a path outside the folder', () => {
    const h = harness({ devices: 1 })

    expect(h.queue.reveal('/shots/device-0.png')).toBe(true)
    expect(h.revealed).toEqual(['/shots/device-0.png'])

    expect(h.queue.reveal('/etc/passwd')).toBe(false)
    expect(h.queue.reveal('')).toBe(false)
    expect(h.revealed).toHaveLength(1)
  })

  it('stops reporting once disposed', async () => {
    const h = harness({ devices: 2 })
    h.queue.captureAll({ fullPage: false })
    h.queue.dispose()

    expect(h.flush()).toHaveLength(0)
    expect(h.queue.captureAll({ fullPage: false }).queued).toBe(0)
  })
})
