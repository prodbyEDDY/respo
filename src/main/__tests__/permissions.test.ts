import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionStatePayload } from '@shared/ipc'
import type { PermissionsDocument } from '@shared/persistence-types'
import type { Deferrer } from '../load-state-batcher'
import {
  createPermissionsManager,
  mapPermission,
  permissionOrigin,
  MAX_PENDING_PROMPTS,
  type PermissionsManager
} from '../permissions'

/** A deferrer under the test's control: nothing flushes until `run()` is called. */
function manualDeferrer(): Deferrer & { run: () => void; pending: () => boolean } {
  let task: (() => void) | null = null
  return {
    defer(next) {
      task = next
      return () => {
        task = null
      }
    },
    run() {
      const current = task
      task = null
      current?.()
    },
    pending: () => task !== null
  }
}

type Harness = {
  manager: PermissionsManager
  document: () => PermissionsDocument
  states: PermissionStatePayload[]
  flush: () => void
  setOrigin: (origin: string | null) => void
}

/** The id of the question the prompt is showing. Throws rather than asserting. */
function promptId(manager: PermissionsManager, index = 0): string {
  const prompt = manager.state().prompts[index]
  if (prompt === undefined) throw new Error(`expected a pending prompt at ${index}`)
  return prompt.id
}

function harness(
  initial: PermissionsDocument = {},
  origin: string | null = 'https://a.dev'
): Harness {
  let document: PermissionsDocument = initial
  let current = origin
  const states: PermissionStatePayload[] = []
  const deferrer = manualDeferrer()

  const manager = createPermissionsManager({
    store: {
      read: () => document,
      write: (next) => {
        document = next
      }
    },
    currentOrigin: () => current,
    onState: (state) => states.push(state),
    deferrer
  })

  return {
    manager,
    document: () => document,
    states,
    flush: deferrer.run,
    setOrigin: (next) => {
      current = next
    }
  }
}

describe('mapPermission', () => {
  it('splits a media request by the streams it asks for', () => {
    expect(mapPermission('media', ['video'])).toEqual(['camera'])
    expect(mapPermission('media', ['audio'])).toEqual(['microphone'])
    expect(mapPermission('media', ['video', 'audio'])).toEqual(['camera', 'microphone'])
  })

  it('refuses a media request that names no stream', () => {
    expect(mapPermission('media', [])).toBeNull()
    expect(mapPermission('media', undefined)).toBeNull()
  })

  it('folds both MIDI permissions onto one row', () => {
    expect(mapPermission('midi', undefined)).toEqual(['midi'])
    expect(mapPermission('midiSysex', undefined)).toEqual(['midi'])
  })

  it.each([
    'display-capture',
    'idle-detection',
    'window-management',
    'storage-access',
    'openExternal',
    'clipboard-sanitized-write',
    'unknown',
    ''
  ])('has no row for %j', (permission) => {
    expect(mapPermission(permission, undefined)).toBeNull()
  })
})

describe('permissionOrigin', () => {
  it('takes the origin of a url', () => {
    expect(permissionOrigin('https://a.dev/some/page?q=1')).toBe('https://a.dev')
    expect(permissionOrigin('http://localhost:5173/index.html')).toBe('http://localhost:5173')
  })

  it('accepts a bare origin unchanged', () => {
    expect(permissionOrigin('https://a.dev')).toBe('https://a.dev')
  })

  it.each(['file:///C:/x.html', 'about:blank', 'data:text/html,x', '', null, undefined, 'junk'])(
    'has no origin for %j',
    (value) => {
      expect(permissionOrigin(value)).toBeNull()
    }
  )
})

describe('PermissionsManager: answering a request', () => {
  let test: Harness

  beforeEach(() => {
    test = harness()
  })

  it('grants what the origin already allows, without asking', () => {
    test = harness({ 'https://a.dev': { geolocation: 'allow' } })
    const callback = vi.fn()

    test.manager.request('https://a.dev/map', 'geolocation', undefined, callback)

    expect(callback).toHaveBeenCalledWith(true)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('refuses what the origin blocks, without asking', () => {
    test = harness({ 'https://a.dev': { geolocation: 'block' } })
    const callback = vi.fn()

    test.manager.request('https://a.dev/map', 'geolocation', undefined, callback)

    expect(callback).toHaveBeenCalledWith(false)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('allows fullscreen by default — a video player must not need a dialog', () => {
    const callback = vi.fn()

    test.manager.request('https://a.dev/watch', 'fullscreen', undefined, callback)

    expect(callback).toHaveBeenCalledWith(true)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('refuses a capability it has no row for, silently', () => {
    const callback = vi.fn()

    test.manager.request('https://a.dev', 'display-capture', undefined, callback)

    expect(callback).toHaveBeenCalledWith(false)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('refuses a request it cannot attribute to a site', () => {
    const callback = vi.fn()

    test.manager.request('file:///C:/x.html', 'geolocation', undefined, callback)

    expect(callback).toHaveBeenCalledWith(false)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('asks once for five viewports and answers all of them', () => {
    const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    for (const callback of callbacks) {
      test.manager.request('https://a.dev/map', 'geolocation', undefined, callback)
    }

    expect(test.manager.state().prompts).toHaveLength(1)
    for (const callback of callbacks) expect(callback).not.toHaveBeenCalled()

    test.manager.respond(promptId(test.manager), true)
    for (const callback of callbacks) expect(callback).toHaveBeenCalledWith(true)
  })

  it('keeps camera and microphone as one question when both were asked for', () => {
    const callback = vi.fn()
    test.manager.request('https://a.dev', 'media', ['video', 'audio'], callback)

    expect(test.manager.state().prompts[0]?.types).toEqual(['camera', 'microphone'])

    test.manager.respond(promptId(test.manager), true)
    expect(callback).toHaveBeenCalledWith(true)
    expect(test.document()['https://a.dev']).toEqual({ camera: 'allow', microphone: 'allow' })
  })

  it('refuses a camera+microphone request when only the camera is allowed', () => {
    test = harness({ 'https://a.dev': { camera: 'allow', microphone: 'block' } })
    const callback = vi.fn()

    test.manager.request('https://a.dev', 'media', ['video', 'audio'], callback)

    expect(callback).toHaveBeenCalledWith(false)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('keeps one question per origin — two sites are two prompts', () => {
    test.manager.request('https://a.dev', 'geolocation', undefined, vi.fn())
    test.manager.request('https://b.dev', 'geolocation', undefined, vi.fn())

    expect(test.manager.state().prompts.map((p) => p.origin)).toEqual([
      'https://a.dev',
      'https://b.dev'
    ])
  })

  it('stops showing questions once the toolbar is full of them', () => {
    // Distinct questions from distinct origins, up to the cap.
    for (let n = 0; n < MAX_PENDING_PROMPTS; n += 1) {
      test.manager.request(`https://s${n}.dev`, 'geolocation', undefined, vi.fn())
    }
    expect(test.manager.state().prompts).toHaveLength(MAX_PENDING_PROMPTS)

    const refused = vi.fn()
    test.manager.request('https://last.dev', 'geolocation', undefined, refused)
    expect(refused).toHaveBeenCalledWith(false)
    expect(test.manager.state().prompts).toHaveLength(MAX_PENDING_PROMPTS)
  })

  it('ignores an answer to a question that is already gone', () => {
    const callback = vi.fn()
    test.manager.request('https://a.dev', 'geolocation', undefined, callback)
    const id = promptId(test.manager)

    test.manager.respond(id, true)
    expect(callback).toHaveBeenCalledTimes(1)

    // A second click on a button that is on its way out.
    test.manager.respond(id, false)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(test.document()['https://a.dev']).toEqual({ geolocation: 'allow' })
  })
})

describe('PermissionsManager: remembering', () => {
  it('keeps an allow and a block for the origin that asked', () => {
    const test = harness()
    test.manager.request('https://a.dev/page', 'geolocation', undefined, vi.fn())
    test.manager.respond(promptId(test.manager), true)

    test.manager.request('https://b.dev/page', 'notifications', undefined, vi.fn())
    test.manager.respond(promptId(test.manager), false)

    expect(test.document()).toEqual({
      'https://a.dev': { geolocation: 'allow' },
      'https://b.dev': { notifications: 'block' }
    })
  })

  it('remembers nothing when a question is dismissed', () => {
    const test = harness()
    const callback = vi.fn()
    test.manager.request('https://a.dev', 'geolocation', undefined, callback)

    test.manager.dismiss(promptId(test.manager))

    expect(callback).toHaveBeenCalledWith(false)
    expect(test.document()).toEqual({})
    // And the site is free to ask again.
    test.manager.request('https://a.dev', 'geolocation', undefined, vi.fn())
    expect(test.manager.state().prompts).toHaveLength(1)
  })

  it('drops the origin entirely when its last decision goes back to ask', () => {
    const test = harness({ 'https://a.dev': { geolocation: 'allow' } })

    test.manager.setDecision('geolocation', 'ask')

    expect(test.document()).toEqual({})
  })

  it('writes a decision against the site the canvas is on, never one named by a caller', () => {
    const test = harness({}, 'https://canvas.dev/page')

    test.manager.setDecision('camera', 'block')

    expect(test.document()).toEqual({ 'https://canvas.dev': { camera: 'block' } })
  })

  it('does nothing when the canvas is not on a site', () => {
    const test = harness({}, 'file:///C:/x.html')

    const state = test.manager.setDecision('camera', 'allow')

    expect(test.document()).toEqual({})
    expect(state.origin).toBeNull()
  })

  it('settles a pending question when the panel decides the same thing', () => {
    const test = harness({}, 'https://a.dev')
    const callback = vi.fn()
    test.manager.request('https://a.dev', 'geolocation', undefined, callback)

    test.manager.setDecision('geolocation', 'block')

    expect(callback).toHaveBeenCalledWith(false)
    expect(test.manager.state().prompts).toEqual([])
  })

  it('leaves a two-part question standing while only half of it is decided', () => {
    const test = harness({}, 'https://a.dev')
    const callback = vi.fn()
    test.manager.request('https://a.dev', 'media', ['video', 'audio'], callback)

    test.manager.setDecision('camera', 'allow')

    expect(callback).not.toHaveBeenCalled()
    expect(test.manager.state().prompts).toHaveLength(1)

    test.manager.setDecision('microphone', 'allow')
    expect(callback).toHaveBeenCalledWith(true)
  })

  it('forgets one site without touching the others', () => {
    const test = harness(
      {
        'https://a.dev': { camera: 'allow', geolocation: 'block' },
        'https://b.dev': { camera: 'allow' }
      },
      'https://a.dev'
    )

    test.manager.resetOrigin()

    expect(test.document()).toEqual({ 'https://b.dev': { camera: 'allow' } })
  })

  it('never grows past the origin cap, and never drops the site being written', () => {
    const document: PermissionsDocument = {}
    for (let n = 0; n < 200; n += 1) document[`https://s${n}.dev`] = { camera: 'allow' }
    const test = harness(document, 'https://fresh.dev')

    test.manager.setDecision('camera', 'allow')

    const written = test.document()
    expect(Object.keys(written)).toHaveLength(200)
    expect(written['https://fresh.dev']).toEqual({ camera: 'allow' })
    // The oldest entry is the one that made room.
    expect(written['https://s0.dev']).toBeUndefined()
  })
})

describe('PermissionsManager: the silent check', () => {
  it('answers true only for an allow', () => {
    const test = harness({
      'https://a.dev': { geolocation: 'allow', notifications: 'block' }
    })

    expect(test.manager.check('https://a.dev', 'geolocation')).toBe(true)
    expect(test.manager.check('https://a.dev', 'notifications')).toBe(false)
    // `ask` is not consent.
    expect(test.manager.check('https://a.dev', 'clipboard-read')).toBe(false)
    expect(test.manager.check('https://b.dev', 'geolocation')).toBe(false)
    expect(test.manager.check(null, 'geolocation')).toBe(false)
  })

  it('reads a media check through the stream it names', () => {
    const test = harness({ 'https://a.dev': { camera: 'allow' } })

    expect(test.manager.check('https://a.dev', 'media', 'video')).toBe(true)
    expect(test.manager.check('https://a.dev', 'media', 'audio')).toBe(false)
    // Chromium's `unknown` reaches here as no stream at all, and `media` with
    // no stream is not a question.
    expect(test.manager.check('https://a.dev', 'media')).toBe(false)
  })
})

describe('PermissionsManager: pushing state', () => {
  it('coalesces a burst of requests into one push', () => {
    const test = harness()
    for (let n = 0; n < 5; n += 1) {
      test.manager.request('https://a.dev', 'geolocation', undefined, vi.fn())
    }

    test.flush()

    expect(test.states).toHaveLength(1)
    expect(test.states[0]?.prompts).toHaveLength(1)
  })

  it('says nothing when nothing changed', () => {
    const test = harness()

    test.manager.refresh()
    test.flush()
    expect(test.states).toHaveLength(1)

    test.manager.refresh()
    test.flush()
    expect(test.states).toHaveLength(1)
  })

  it('speaks up when the canvas moves to another site', () => {
    const test = harness({ 'https://b.dev': { camera: 'allow' } }, 'https://a.dev')
    test.manager.refresh()
    test.flush()

    test.setOrigin('https://b.dev/page')
    test.manager.refresh()
    test.flush()

    expect(test.states).toHaveLength(2)
    expect(test.states[1]).toMatchObject({
      origin: 'https://b.dev',
      decisions: expect.objectContaining({ camera: 'allow' })
    })
  })

  it('reports the defaults when there is no site', () => {
    const test = harness({}, null)

    expect(test.manager.state()).toMatchObject({
      origin: null,
      decisions: expect.objectContaining({ camera: 'ask', fullscreen: 'allow' })
    })
  })

  it('leaves nothing waiting on an answer when it is disposed', () => {
    const test = harness()
    const callback = vi.fn()
    test.manager.request('https://a.dev', 'geolocation', undefined, callback)

    test.manager.dispose()

    expect(callback).toHaveBeenCalledWith(false)
    // And anything asking afterwards is refused rather than queued forever.
    const later = vi.fn()
    test.manager.request('https://a.dev', 'geolocation', undefined, later)
    expect(later).toHaveBeenCalledWith(false)
  })

  it('survives a callback that throws — one dead view must not silence four', () => {
    const test = harness()
    const thrower = vi.fn(() => {
      throw new Error('view is gone')
    })
    const survivor = vi.fn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    test.manager.request('https://a.dev', 'geolocation', undefined, thrower)
    test.manager.request('https://a.dev', 'geolocation', undefined, survivor)
    test.manager.respond(promptId(test.manager), true)

    expect(survivor).toHaveBeenCalledWith(true)
    errors.mockRestore()
  })
})
