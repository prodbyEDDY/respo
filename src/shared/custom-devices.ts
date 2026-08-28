/**
 * User-defined devices: the pure half.
 *
 * The Device Manager is a form, and a form is where the bugs live — an id that
 * collides with the catalog, a width the CDP layer will refuse, a name the user
 * cannot tell apart from another one. All of that reasoning lives here, in
 * plain functions a unit test can reach, so the React components are left with
 * layout and event handlers.
 */

import { DEFAULT_USER_AGENTS, DEVICE_CATALOG } from './deviceCatalog'
import type { DeviceSpec, DeviceType } from './types'

/** Narrower than main's guard rails on purpose: these are the *usable* bounds. */
export const MIN_DIMENSION = 100
export const MAX_DIMENSION = 10_000
export const MIN_DPR = 0.5
export const MAX_DPR = 4
/** A name is a label; the field is capped so it stays one. */
export const MAX_NAME_LENGTH = 60
/** Real user agents are long. This is roomy and still not a payload. */
export const MAX_USER_AGENT_LENGTH = 512

/** Everything a user-defined device is made of, before it has an id. */
export type CustomDeviceInput = Omit<DeviceSpec, 'id'>

/**
 * The editor's state. Numbers are strings because that is what an `<input>`
 * holds: "39" is a legitimate thing to have typed on the way to "393", and a
 * form that fights the user mid-keystroke is worse than one that validates on
 * submit.
 */
export type DeviceDraft = {
  name: string
  width: string
  height: string
  dpr: string
  type: DeviceType
  userAgent: string
  touch: boolean
  rotatable: boolean
}

export type DraftField = 'name' | 'width' | 'height' | 'dpr' | 'userAgent'
export type DraftErrors = Partial<Record<DraftField, string>>

export type DraftResult =
  { ok: true; device: CustomDeviceInput } | { ok: false; errors: DraftErrors }

/** What each kind of device reports about touch, absent a user's opinion. */
export function defaultTouch(type: DeviceType): boolean {
  return type !== 'desktop'
}

/** Landscape makes sense for anything you can pick up. */
export function defaultRotatable(type: DeviceType): boolean {
  return type !== 'desktop'
}

export function defaultUserAgent(type: DeviceType): string {
  return DEFAULT_USER_AGENTS[type]
}

/**
 * The kind of a device.
 *
 * Custom devices say so; catalog entries are read from their metrics rather
 * than annotated 38 times. A viewport with no touch screen is a computer; a
 * touch one whose short side clears 600px is a tablet.
 */
export function deviceTypeOf(device: DeviceSpec): DeviceType {
  if (device.type !== undefined) return device.type
  if (!device.touch) return 'desktop'
  return Math.min(device.width, device.height) >= 600 ? 'tablet' : 'phone'
}

/** Whether a device can be turned on its side. Only monitors cannot. */
export function isRotatable(device: DeviceSpec): boolean {
  return device.rotatable ?? deviceTypeOf(device) !== 'desktop'
}

/** A fresh device of the given kind, with everything plausible filled in. */
export function emptyDraft(type: DeviceType = 'phone'): DeviceDraft {
  return {
    name: '',
    width: type === 'desktop' ? '1440' : type === 'tablet' ? '820' : '390',
    height: type === 'desktop' ? '900' : type === 'tablet' ? '1180' : '844',
    dpr: type === 'desktop' ? '1' : '3',
    type,
    userAgent: defaultUserAgent(type),
    touch: defaultTouch(type),
    rotatable: defaultRotatable(type)
  }
}

/** Load an existing device into the editor. */
export function draftFromDevice(device: DeviceSpec): DeviceDraft {
  const type = deviceTypeOf(device)
  return {
    name: device.name,
    width: String(device.width),
    height: String(device.height),
    dpr: String(device.dpr),
    type,
    userAgent: device.userAgent,
    touch: device.touch,
    rotatable: isRotatable(device)
  }
}

/**
 * Switch a draft to another kind of device.
 *
 * The user agent, touch and rotation follow the new type — that is the point of
 * the control — but *only* while they still hold the old type's defaults. Once
 * someone has edited the user agent by hand, changing the type must not throw
 * their string away.
 */
export function draftWithType(draft: DeviceDraft, type: DeviceType): DeviceDraft {
  const previous = draft.type
  if (previous === type) return draft

  return {
    ...draft,
    type,
    userAgent:
      draft.userAgent.trim() === '' || draft.userAgent === defaultUserAgent(previous)
        ? defaultUserAgent(type)
        : draft.userAgent,
    touch: draft.touch === defaultTouch(previous) ? defaultTouch(type) : draft.touch,
    rotatable:
      draft.rotatable === defaultRotatable(previous) ? defaultRotatable(type) : draft.rotatable
  }
}

function parseBounded(raw: string, min: number, max: number, integer: boolean): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  if (integer && !Number.isInteger(value)) return null
  if (value < min || value > max) return null
  return value
}

export type ValidateDraftOptions = {
  /** Every device the name has to be distinct from — catalog and custom. */
  devices: readonly DeviceSpec[]
  /** The device being edited, whose own name must not collide with itself. */
  editingId?: string
}

/**
 * Turn a draft into a device, or into the messages that say why it is not one.
 *
 * Every field is reported at once rather than one error at a time: a form that
 * reveals its objections one keystroke apart is a worse experience than one
 * that states all of them.
 */
export function validateDraft(draft: DeviceDraft, options: ValidateDraftOptions): DraftResult {
  const errors: DraftErrors = {}

  const name = draft.name.trim()
  if (name === '') errors.name = 'Give the device a name'
  else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `At most ${MAX_NAME_LENGTH} characters`
  } else if (
    options.devices.some(
      (d) => d.id !== options.editingId && d.name.trim().toLowerCase() === name.toLowerCase()
    )
  ) {
    errors.name = 'A device with this name already exists'
  }

  const width = parseBounded(draft.width, MIN_DIMENSION, MAX_DIMENSION, true)
  if (width === null) errors.width = `${MIN_DIMENSION}–${MAX_DIMENSION}, whole pixels`

  const height = parseBounded(draft.height, MIN_DIMENSION, MAX_DIMENSION, true)
  if (height === null) errors.height = `${MIN_DIMENSION}–${MAX_DIMENSION}, whole pixels`

  const dpr = parseBounded(draft.dpr, MIN_DPR, MAX_DPR, false)
  if (dpr === null) errors.dpr = `${MIN_DPR}–${MAX_DPR}`

  const userAgent = draft.userAgent.trim()
  if (userAgent === '') errors.userAgent = 'A device has to report something'
  else if (userAgent.length > MAX_USER_AGENT_LENGTH) {
    errors.userAgent = `At most ${MAX_USER_AGENT_LENGTH} characters`
  }

  // The null checks are redundant with `errors` but they are what narrows the
  // types, and a cast here would be a promise the compiler cannot check.
  if (width === null || height === null || dpr === null || Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    device: {
      name,
      width,
      height,
      dpr,
      userAgent,
      touch: draft.touch,
      type: draft.type,
      rotatable: draft.rotatable
    }
  }
}

/** Ids of user devices are namespaced, so one can never shadow a catalog entry. */
export const CUSTOM_ID_PREFIX = 'custom-'

/**
 * A readable, url-safe stem for an id. `fallback` is what an entirely
 * unrepresentable name (emoji, another script) collapses to.
 */
export function slugify(name: string, fallback: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned === '' ? fallback : cleaned.slice(0, 40)
}

function slug(name: string): string {
  return slugify(name, 'device')
}

/**
 * A stable, readable id for a new device, distinct from everything `taken`.
 *
 * Derived from the name rather than random: an exported backup that someone
 * reads is far easier to reason about with `custom-my-watch` in it than a uuid,
 * and the suffix only appears when it has to.
 */
export function makeCustomDeviceId(name: string, taken: ReadonlySet<string>): string {
  const base = `${CUSTOM_ID_PREFIX}${slug(name)}`
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/**
 * Whether a device answers to what was typed in the search box.
 *
 * Two things people actually search by: the name, and the size. `393x852`,
 * `393×852`, `393 x 852` and a bare `393` all find the same phone.
 */
export function matchesQuery(device: DeviceSpec, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  if (device.name.toLowerCase().includes(q)) return true

  const needle = q.replace(/×/g, 'x').replace(/\s+/g, '')
  return `${device.width}x${device.height}`.includes(needle)
}

/** The catalog followed by the user's own devices. */
export function catalogWithCustom(custom: readonly DeviceSpec[]): DeviceSpec[] {
  return [...DEVICE_CATALOG, ...custom]
}
