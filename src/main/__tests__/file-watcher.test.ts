import { beforeEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WatcherState } from '@shared/ipc'
import type { CdpTarget } from '../cdp-controller'
import {
  CHANGE_DEBOUNCE_MS,
  FileWatcher,
  isIgnored,
  isWatchedFile,
  swapExpression,
  watchableFile,
  type WatchOptions,
  type Watcher
} from '../file-watcher'

type FakeWatcher = Watcher & {
  root: string
  options: WatchOptions
  closed: boolean
  fire: (event: string, path: string) => void
}

function fakeWatchFactory(): {
  made: FakeWatcher[]
  watch: (root: string, options: WatchOptions) => Watcher
} {
  const made: FakeWatcher[] = []
  return {
    made,
    watch(root, options) {
      const listeners: ((event: string, path: string) => void)[] = []
      const watcher: FakeWatcher = {
        root,
        options,
        closed: false,
        fire: (event, path) => {
          for (const listener of listeners) listener(event, path)
        },
        on: (_event, listener) => {
          listeners.push(listener)
          return watcher
        },
        close: async () => {
          watcher.closed = true
        }
      }
      made.push(watcher)
      return watcher
    }
  }
}

function manualTimer(): {
  set: (task: () => void, ms: number) => () => void
  fire: () => void
  pending: number
} {
  const timers: (() => void)[] = []
  return {
    set(task) {
      timers.push(task)
      return () => {
        const i = timers.indexOf(task)
        if (i >= 0) timers.splice(i, 1)
      }
    },
    fire() {
      for (const task of timers.splice(0)) task()
    },
    get pending() {
      return timers.length
    }
  }
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

const ROOT = resolve('/tmp/site')
const PAGE = resolve(ROOT, 'index.html')
const PAGE_URL = pathToFileURL(PAGE).href

describe('watchableFile', () => {
  it('names the local html page, and nothing else', () => {
    expect(watchableFile(PAGE_URL)).toBe(PAGE)
    expect(watchableFile(pathToFileURL(resolve(ROOT, 'page.HTM')).href)).toBe(
      resolve(ROOT, 'page.HTM')
    )
    expect(watchableFile('https://example.com/index.html')).toBeNull()
    expect(watchableFile(pathToFileURL(resolve(ROOT, 'style.css')).href)).toBeNull()
    expect(watchableFile('not a url')).toBeNull()
    expect(watchableFile(null)).toBeNull()
  })
})

describe('isWatchedFile / isIgnored', () => {
  it('reacts to html, css and scripts, and leaves dependencies and git alone', () => {
    expect(isWatchedFile(resolve(ROOT, 'a.css'))).toBe(true)
    expect(isWatchedFile(resolve(ROOT, 'deep', 'a.mjs'))).toBe(true)
    expect(isWatchedFile(resolve(ROOT, 'a.png'))).toBe(false)
    expect(isWatchedFile(resolve(ROOT, 'node_modules', 'x', 'a.js'))).toBe(false)
    expect(isIgnored(resolve(ROOT, '.git', 'HEAD'))).toBe(true)
    expect(isIgnored(resolve(ROOT, 'node_modules'))).toBe(true)
    expect(isIgnored(resolve(ROOT, 'node_modules_not', 'a.js'))).toBe(false)
  })
})

describe('swapExpression', () => {
  it('embeds the paths as JSON and stamps the query', () => {
    const expression = swapExpression(['/tmp/site/a.css'], 42)
    expect(expression).toContain('["/tmp/site/a.css"]')
    expect(expression).toContain("'42'")
    expect(expression).toContain('link[rel~="stylesheet"]')
  })
})

describe('FileWatcher', () => {
  let factory: ReturnType<typeof fakeWatchFactory>
  let timer: ReturnType<typeof manualTimer>
  let reloads: number
  let evaluations: { id: number; expression: string }[]
  let swapAnswer: number | null
  let states: WatcherState[]
  let watcher: FileWatcher

  beforeEach(() => {
    factory = fakeWatchFactory()
    timer = manualTimer()
    reloads = 0
    evaluations = []
    swapAnswer = 1
    states = []
    watcher = new FileWatcher({
      watch: factory.watch,
      cdp: {
        async evaluate<T>(t: CdpTarget, expression: string): Promise<T | null> {
          evaluations.push({ id: t.id, expression })
          return swapAnswer as T
        }
      },
      reloadAll: () => {
        reloads += 1
      },
      onState: (state) => states.push(state),
      setTimer: timer.set,
      now: () => 1234
    })
    watcher.registerDevice({ deviceId: 'a', target: target() })
    watcher.registerDevice({ deviceId: 'b', target: target() })
  })

  it('starts off, watches the page folder for a local file, and says so', () => {
    expect(watcher.state()).toEqual({ state: 'off', file: null, lastReloadAt: null })
    watcher.follow(PAGE_URL)
    expect(factory.made).toHaveLength(1)
    expect(factory.made[0]?.root).toBe(ROOT)
    expect(factory.made[0]?.options.depth).toBe(3)
    expect(states.at(-1)).toEqual({ state: 'watching', file: PAGE, lastReloadAt: null })
  })

  it('does not watch an http page, and stops when the canvas leaves the file', () => {
    watcher.follow('https://example.com/')
    expect(factory.made).toHaveLength(0)
    watcher.follow(PAGE_URL)
    watcher.follow('https://example.com/')
    expect(factory.made[0]?.closed).toBe(true)
    expect(watcher.state().state).toBe('off')
  })

  it('a url that has not changed costs nothing', () => {
    watcher.follow(PAGE_URL)
    watcher.follow(PAGE_URL)
    watcher.follow(`${PAGE_URL}#section`)
    expect(factory.made).toHaveLength(1)
  })

  it('swaps a changed stylesheet in every view, once the burst settles', () => {
    watcher.follow(PAGE_URL)
    const css = resolve(ROOT, 'style.css')
    factory.made[0]?.fire('change', css)
    factory.made[0]?.fire('change', css)
    expect(timer.pending).toBe(1)
    expect(evaluations).toHaveLength(0)

    timer.fire()
    expect(evaluations).toHaveLength(2)
    expect(evaluations[0]?.expression).toContain(JSON.stringify(pathToFileURL(css).pathname))
    expect(reloads).toBe(0)
  })

  it('reloads everything when a view had no link to swap', async () => {
    watcher.follow(PAGE_URL)
    swapAnswer = 0
    factory.made[0]?.fire('change', resolve(ROOT, 'style.css'))
    timer.fire()
    await new Promise((r) => setTimeout(r, 0))
    expect(reloads).toBe(1)
    expect(watcher.state().lastReloadAt).toBe(1234)
  })

  it('reloads everything for html or script changes, and for a mixed burst', () => {
    watcher.follow(PAGE_URL)
    factory.made[0]?.fire('change', resolve(ROOT, 'style.css'))
    factory.made[0]?.fire('change', resolve(ROOT, 'app.js'))
    timer.fire()
    expect(reloads).toBe(1)
    expect(evaluations).toHaveLength(0)
    expect(states.at(-1)?.lastReloadAt).toBe(1234)
  })

  it('ignores files that are not the page’s business', () => {
    watcher.follow(PAGE_URL)
    factory.made[0]?.fire('change', resolve(ROOT, 'photo.png'))
    factory.made[0]?.fire('change', resolve(ROOT, 'node_modules', 'lib', 'x.js'))
    factory.made[0]?.fire('addDir', resolve(ROOT, 'sub'))
    expect(timer.pending).toBe(0)
  })

  it('pauses and resumes, dropping what arrived while paused', () => {
    watcher.follow(PAGE_URL)
    expect(watcher.toggle().state).toBe('paused')
    factory.made[0]?.fire('change', resolve(ROOT, 'app.js'))
    timer.fire()
    expect(reloads).toBe(0)
    expect(watcher.toggle().state).toBe('watching')
    factory.made[0]?.fire('change', resolve(ROOT, 'app.js'))
    timer.fire()
    expect(reloads).toBe(1)
  })

  it('toggle does nothing while off', () => {
    expect(watcher.toggle().state).toBe('off')
  })

  it('a new page restarts the watch on its own folder', () => {
    watcher.follow(PAGE_URL)
    const other = resolve('/tmp/other/page.html')
    watcher.follow(pathToFileURL(other).href)
    expect(factory.made).toHaveLength(2)
    expect(factory.made[0]?.closed).toBe(true)
    expect(factory.made[1]?.root).toBe(resolve('/tmp/other'))
  })

  it('dispose closes the watcher and ignores everything after', () => {
    watcher.follow(PAGE_URL)
    watcher.dispose()
    expect(factory.made[0]?.closed).toBe(true)
    watcher.follow(PAGE_URL)
    expect(factory.made).toHaveLength(1)
    expect(CHANGE_DEBOUNCE_MS).toBe(100)
  })
})
