import { describe, expect, it } from 'vitest'
import {
  acceptLanguageFor,
  defaultEmulationProfile,
  describeEmulation,
  GEOLOCATION_PRESETS,
  geolocationPresetOf,
  isEmulationActive,
  isGeolocation,
  isLocaleTag,
  isTimezoneId,
  NETWORK_CONDITIONS,
  NETWORK_PRESETS,
  parseLatLng,
  TIMEZONE_PRESETS,
  VISION_DEFICIENCIES
} from '../emulation'

describe('the default profile', () => {
  it('overrides nothing', () => {
    expect(isEmulationActive(defaultEmulationProfile())).toBe(false)
    expect(describeEmulation(defaultEmulationProfile())).toEqual([])
  })

  it('hands out a fresh object every call', () => {
    const a = defaultEmulationProfile()
    a.colorScheme = 'dark'
    expect(defaultEmulationProfile().colorScheme).toBe('system')
  })
})

describe('isEmulationActive / describeEmulation', () => {
  it.each([
    ['colorScheme', { colorScheme: 'dark' as const }, 'Dark'],
    ['reducedMotion', { reducedMotion: true }, 'Reduced motion'],
    ['forcedColors', { forcedColors: true }, 'Forced colors'],
    ['media', { media: 'print' as const }, 'Print'],
    ['vision', { vision: 'deuteranopia' as const }, 'Deuteranopia'],
    ['network', { network: 'slow-4g' as const }, 'Slow 4G'],
    ['geolocation', { geolocation: { latitude: 35.6762, longitude: 139.6503 } }, 'Tokyo'],
    ['a custom geolocation', { geolocation: { latitude: 1, longitude: 2 } }, 'Custom location'],
    ['locale', { locale: 'de-DE' }, 'de-DE'],
    ['timezone', { timezone: 'Asia/Tokyo' }, 'Asia/Tokyo']
  ])('%s alone switches the badge on and names itself', (_label, patch, word) => {
    const profile = { ...defaultEmulationProfile(), ...patch }
    expect(isEmulationActive(profile)).toBe(true)
    expect(describeEmulation(profile)).toEqual([word])
  })

  it('lists everything that is on, in a stable order', () => {
    const profile = {
      ...defaultEmulationProfile(),
      colorScheme: 'light' as const,
      network: 'offline' as const,
      timezone: 'UTC'
    }
    expect(describeEmulation(profile)).toEqual(['Light', 'Offline', 'UTC'])
  })
})

describe('the presets', () => {
  it('every location preset names a time zone the picker offers', () => {
    for (const city of GEOLOCATION_PRESETS) expect(TIMEZONE_PRESETS).toContain(city.timezone)
  })

  it('every location preset is somewhere on Earth, and findable again', () => {
    for (const city of GEOLOCATION_PRESETS) {
      expect(isGeolocation(city)).toBe(true)
      expect(geolocationPresetOf({ latitude: city.latitude, longitude: city.longitude })?.id).toBe(
        city.id
      )
    }
    expect(geolocationPresetOf(null)).toBeNull()
    expect(geolocationPresetOf({ latitude: 0, longitude: 0 })).toBeNull()
  })

  it('online means no throttling and offline means no network', () => {
    expect(NETWORK_CONDITIONS.online).toEqual({
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    })
    expect(NETWORK_CONDITIONS.offline.offline).toBe(true)
  })

  it('the throttled presets get slower in the order they are listed', () => {
    const throttled = NETWORK_PRESETS.filter((p) => p !== 'online' && p !== 'offline')
    for (let i = 1; i < throttled.length; i += 1) {
      const faster = NETWORK_CONDITIONS[throttled[i - 1]!]
      const slower = NETWORK_CONDITIONS[throttled[i]!]
      expect(slower.downloadThroughput).toBeLessThan(faster.downloadThroughput)
      expect(slower.latency).toBeGreaterThan(faster.latency)
    }
  })

  it('starts the vision list with "none"', () => {
    expect(VISION_DEFICIENCIES[0]).toBe('none')
  })
})

describe('isLocaleTag', () => {
  it.each(['en', 'en-US', 'de-DE', 'zh-Hant-HK', 'sr-Latn-RS', 'pt-BR'])('accepts %s', (tag) => {
    expect(isLocaleTag(tag)).toBe(true)
  })

  it.each(['', 'e', 'en_US', 'en-', '<script>', 'a'.repeat(40), 42, null])('rejects %j', (tag) => {
    expect(isLocaleTag(tag)).toBe(false)
  })
})

describe('isTimezoneId', () => {
  it.each(['UTC', 'Europe/London', 'America/Argentina/ComodRivadavia', 'Etc/GMT+3'])(
    'accepts %s',
    (zone) => {
      expect(isTimezoneId(zone)).toBe(true)
    }
  )

  it.each(['', '/Europe', 'Europe London', 'Asia/Tokyo;x', 'a'.repeat(70), 1])(
    'rejects %j',
    (zone) => {
      expect(isTimezoneId(zone)).toBe(false)
    }
  )
})

describe('isGeolocation', () => {
  it('accepts the poles and the antimeridian', () => {
    expect(isGeolocation({ latitude: 90, longitude: -180 })).toBe(true)
    expect(isGeolocation({ latitude: -90, longitude: 180 })).toBe(true)
  })

  it.each([
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: Number.NaN, longitude: 0 },
    { latitude: '1', longitude: 0 },
    { longitude: 0 },
    null,
    [1, 2]
  ])('rejects %j', (value) => {
    expect(isGeolocation(value)).toBe(false)
  })
})

describe('parseLatLng', () => {
  it('reads a comma-separated pair, with or without spaces', () => {
    expect(parseLatLng('51.5074, -0.1278')).toEqual({ latitude: 51.5074, longitude: -0.1278 })
    expect(parseLatLng('51.5074,-0.1278')).toEqual({ latitude: 51.5074, longitude: -0.1278 })
    expect(parseLatLng('  51.5074   -0.1278 ')).toEqual({ latitude: 51.5074, longitude: -0.1278 })
  })

  it.each(['', '51.5', '1, 2, 3', 'lat, lng', '100, 0'])('rejects %j', (input) => {
    expect(parseLatLng(input)).toBeNull()
  })
})

describe('acceptLanguageFor', () => {
  it('lists the tag, its language, then English', () => {
    expect(acceptLanguageFor('de-DE')).toBe('de-DE,de;q=0.9,en;q=0.8')
  })

  it('does not repeat English for an English locale', () => {
    expect(acceptLanguageFor('en-GB')).toBe('en-GB,en;q=0.9')
  })

  it('does not repeat a bare language', () => {
    expect(acceptLanguageFor('fr')).toBe('fr,en;q=0.8')
  })
})
