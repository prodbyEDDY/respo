/**
 * The emulation pack: everything Respo can pretend about the *environment* a
 * page runs in, beyond the device itself.
 *
 * A device (`DeviceSpec`) says how big the screen is and what the browser
 * calls itself. This says what the person holding it prefers (dark mode, less
 * motion), where they are (a city, a time zone, a language), how good their
 * connection is, and how they see (a colour vision deficiency). All of it is
 * global — one page across many viewports, one environment — except the vision
 * simulation, which can also be set per device so two identical frames can be
 * compared with and without it.
 *
 * Nouns only: the IPC shapes are in `./ipc`, the persistence slice in
 * `./persistence-types`, and the CDP calls in `main/cdp-controller`.
 */

/** `prefers-color-scheme`, as the page will see it. `system` is no override. */
export type EmulatedColorScheme = 'system' | 'light' | 'dark'

/** The CSS media type the page evaluates against. `auto` is no override. */
export type EmulatedMediaType = 'auto' | 'screen' | 'print'

/**
 * Chromium's own vision-deficiency simulations (`Emulation.setEmulatedVisionDeficiency`).
 *
 * Exactly the protocol's list, in the order the picker shows them. They are
 * rendered by the page's compositor, so a screenshot carries them too.
 */
export type VisionDeficiency =
  | 'none'
  | 'blurredVision'
  | 'reducedContrast'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'achromatopsia'

export const VISION_DEFICIENCIES: readonly VisionDeficiency[] = [
  'none',
  'blurredVision',
  'reducedContrast',
  'protanopia',
  'deuteranopia',
  'tritanopia',
  'achromatopsia'
]

export function isVisionDeficiency(value: unknown): value is VisionDeficiency {
  return VISION_DEFICIENCIES.includes(value as VisionDeficiency)
}

/** What the picker calls each simulation. */
export const VISION_LABELS: Readonly<Record<VisionDeficiency, string>> = {
  none: 'None',
  blurredVision: 'Blurred vision',
  reducedContrast: 'Reduced contrast',
  protanopia: 'Protanopia',
  deuteranopia: 'Deuteranopia',
  tritanopia: 'Tritanopia',
  achromatopsia: 'Achromatopsia'
}

/**
 * The connection presets, named the way DevTools names them.
 *
 * `online` is no throttling at all; `offline` fails every request. The three
 * in between are the numbers DevTools uses for the same labels, so a page
 * that "loads in 4s on Slow 4G" here does the same thing there.
 */
export type NetworkPreset = 'online' | 'fast-4g' | 'slow-4g' | '3g' | 'offline'

export const NETWORK_PRESETS: readonly NetworkPreset[] = [
  'online',
  'fast-4g',
  'slow-4g',
  '3g',
  'offline'
]

export function isNetworkPreset(value: unknown): value is NetworkPreset {
  return NETWORK_PRESETS.includes(value as NetworkPreset)
}

export const NETWORK_LABELS: Readonly<Record<NetworkPreset, string>> = {
  online: 'Online',
  'fast-4g': 'Fast 4G',
  'slow-4g': 'Slow 4G',
  '3g': '3G',
  offline: 'Offline'
}

/** `Network.emulateNetworkConditions` parameters. Throughput in bytes/second. */
export type NetworkConditions = {
  offline: boolean
  /** Round-trip latency in milliseconds. */
  latency: number
  /** `-1` means "do not throttle". */
  downloadThroughput: number
  uploadThroughput: number
}

/**
 * The DevTools presets, in bytes per second.
 *
 * Each is the advertised speed in bits, over eight, times DevTools' own 0.8 /
 * 0.9 "real-world" factor — the same arithmetic the Network panel does.
 */
export const NETWORK_CONDITIONS: Readonly<Record<NetworkPreset, NetworkConditions>> = {
  online: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  'fast-4g': {
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: ((4 * 1000 * 1000) / 8) * 0.9,
    uploadThroughput: ((3 * 1000 * 1000) / 8) * 0.9
  },
  'slow-4g': {
    offline: false,
    latency: 150 * 3.75,
    downloadThroughput: ((1.6 * 1000 * 1000) / 8) * 0.9,
    uploadThroughput: ((750 * 1000) / 8) * 0.9
  },
  '3g': {
    offline: false,
    latency: 400 * 5,
    downloadThroughput: ((500 * 1000) / 8) * 0.8,
    uploadThroughput: ((500 * 1000) / 8) * 0.8
  },
  offline: { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
}

/** A position the page's geolocation API will report. */
export type GeolocationOverride = {
  latitude: number
  longitude: number
}

/**
 * How precise the emulated position claims to be, in metres. DevTools' own
 * default for a custom location; precise enough for a map, vague enough that
 * nothing treats it as GPS.
 */
export const GEOLOCATION_ACCURACY_M = 150

/** One row of the location picker. */
export type GeolocationPreset = {
  id: string
  label: string
  latitude: number
  longitude: number
  /** The time zone someone standing there would be in. Offered, not forced. */
  timezone: string
}

/**
 * Eight cities, one per region a layout usually has to be checked against —
 * including a southern-hemisphere one and one east of UTC+8.
 */
export const GEOLOCATION_PRESETS: readonly GeolocationPreset[] = [
  {
    id: 'london',
    label: 'London',
    latitude: 51.5074,
    longitude: -0.1278,
    timezone: 'Europe/London'
  },
  { id: 'berlin', label: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  {
    id: 'moscow',
    label: 'Moscow',
    latitude: 55.7558,
    longitude: 37.6173,
    timezone: 'Europe/Moscow'
  },
  {
    id: 'new-york',
    label: 'New York',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York'
  },
  {
    id: 'san-francisco',
    label: 'San Francisco',
    latitude: 37.7749,
    longitude: -122.4194,
    timezone: 'America/Los_Angeles'
  },
  {
    id: 'sao-paulo',
    label: 'São Paulo',
    latitude: -23.5505,
    longitude: -46.6333,
    timezone: 'America/Sao_Paulo'
  },
  { id: 'tokyo', label: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  {
    id: 'sydney',
    label: 'Sydney',
    latitude: -33.8688,
    longitude: 151.2093,
    timezone: 'Australia/Sydney'
  }
]

/** One row of the locale picker: a BCP 47 tag and what to call it. */
export type LocalePreset = { tag: string; label: string }

/**
 * Languages worth a row: the big Latin-script ones, two CJK, Cyrillic, and an
 * RTL one — a layout that survives `ar-SA` survives most things.
 */
export const LOCALE_PRESETS: readonly LocalePreset[] = [
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'de-DE', label: 'German' },
  { tag: 'fr-FR', label: 'French' },
  { tag: 'es-ES', label: 'Spanish' },
  { tag: 'pt-BR', label: 'Portuguese (Brazil)' },
  { tag: 'ru-RU', label: 'Russian' },
  { tag: 'ja-JP', label: 'Japanese' },
  { tag: 'zh-CN', label: 'Chinese (Simplified)' },
  { tag: 'ar-SA', label: 'Arabic' },
  { tag: 'hi-IN', label: 'Hindi' }
]

/** IANA zone ids worth a row. Every location preset's zone is among them. */
export const TIMEZONE_PRESETS: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney'
]

/**
 * The whole environment, as the user set it.
 *
 * `null` (or `system` / `auto` / `none` / `online`) is always "do not
 * override": a fresh profile touches nothing, and Reset all is `defaultEmulationProfile()`.
 */
export type EmulationProfile = {
  colorScheme: EmulatedColorScheme
  reducedMotion: boolean
  forcedColors: boolean
  media: EmulatedMediaType
  vision: VisionDeficiency
  network: NetworkPreset
  geolocation: GeolocationOverride | null
  /** A BCP 47 tag (`de-DE`). Sets `navigator.language`, `Intl` and `Accept-Language`. */
  locale: string | null
  /** An IANA zone id (`Asia/Tokyo`). */
  timezone: string | null
}

export function defaultEmulationProfile(): EmulationProfile {
  return {
    colorScheme: 'system',
    reducedMotion: false,
    forcedColors: false,
    media: 'auto',
    vision: 'none',
    network: 'online',
    geolocation: null,
    locale: null,
    timezone: null
  }
}

/** Whether anything in the profile overrides the real environment. */
export function isEmulationActive(profile: EmulationProfile): boolean {
  return (
    profile.colorScheme !== 'system' ||
    profile.reducedMotion ||
    profile.forcedColors ||
    profile.media !== 'auto' ||
    profile.vision !== 'none' ||
    profile.network !== 'online' ||
    profile.geolocation !== null ||
    profile.locale !== null ||
    profile.timezone !== null
  )
}

/** Longest BCP 47 tag worth accepting: `zh-Hant-HK-u-ca-chinese` is 24. */
export const MAX_LOCALE_LENGTH = 35
/** Longest IANA id is `America/Argentina/ComodRivadavia` at 32. */
export const MAX_TIMEZONE_LENGTH = 64

/** A BCP 47 language tag: `de`, `de-DE`, `zh-Hant-HK`, `sr-Latn-RS`. */
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
/** An IANA zone id: letters, digits, `/`, `_`, `+`, `-`. `UTC` and `Etc/GMT+3` included. */
const TIMEZONE_RE = /^[A-Za-z][A-Za-z0-9_+\-/]*$/

export function isLocaleTag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LOCALE_LENGTH && LOCALE_RE.test(value)
}

export function isTimezoneId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TIMEZONE_LENGTH && TIMEZONE_RE.test(value)
}

/** A latitude/longitude pair that is somewhere on Earth. */
export function isGeolocation(value: unknown): value is GeolocationOverride {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { latitude, longitude } = value as Record<string, unknown>
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  )
}

/** `"51.5, -0.12"` → a position, or `null` when it is not one. */
export function parseLatLng(input: string): GeolocationOverride | null {
  const parts = input.split(/[,\s]+/).filter((part) => part !== '')
  if (parts.length !== 2) return null
  const candidate = { latitude: Number(parts[0]), longitude: Number(parts[1]) }
  return isGeolocation(candidate) ? candidate : null
}

/**
 * The `Accept-Language` header a locale implies.
 *
 * `de-DE,de;q=0.9,en;q=0.8`: the tag, its bare language as a fallback, and
 * English last — the same shape a real browser sends, so a server that
 * negotiates by q-value sees a plausible client rather than one word.
 */
export function acceptLanguageFor(locale: string): string {
  const base = locale.split('-')[0]?.toLowerCase() ?? locale
  const parts = [locale]
  if (base !== locale.toLowerCase()) parts.push(`${base};q=0.9`)
  if (base !== 'en') parts.push('en;q=0.8')
  return parts.join(',')
}

/** Nearest preset city for a position, or `null` when it is a custom one. */
export function geolocationPresetOf(geo: GeolocationOverride | null): GeolocationPreset | null {
  if (geo === null) return null
  return (
    GEOLOCATION_PRESETS.find(
      (preset) =>
        Math.abs(preset.latitude - geo.latitude) < 1e-6 &&
        Math.abs(preset.longitude - geo.longitude) < 1e-6
    ) ?? null
  )
}

/**
 * What is switched on, in a few words — the tooltip on the toolbar button.
 *
 * `Dark · Slow 4G · Tokyo`, never a sentence: the point is to answer "why
 * does this page look odd" at a glance.
 */
export function describeEmulation(profile: EmulationProfile): string[] {
  const parts: string[] = []
  if (profile.colorScheme !== 'system') {
    parts.push(profile.colorScheme === 'dark' ? 'Dark' : 'Light')
  }
  if (profile.reducedMotion) parts.push('Reduced motion')
  if (profile.forcedColors) parts.push('Forced colors')
  if (profile.media !== 'auto') parts.push(profile.media === 'print' ? 'Print' : 'Screen')
  if (profile.vision !== 'none') parts.push(VISION_LABELS[profile.vision])
  if (profile.network !== 'online') parts.push(NETWORK_LABELS[profile.network])
  if (profile.geolocation !== null) {
    parts.push(geolocationPresetOf(profile.geolocation)?.label ?? 'Custom location')
  }
  if (profile.locale !== null) parts.push(profile.locale)
  if (profile.timezone !== null) parts.push(profile.timezone)
  return parts
}
