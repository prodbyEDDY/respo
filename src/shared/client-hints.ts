/**
 * User-Agent Client Hints, derived from a device's user-agent string.
 *
 * A Chromium page has two ways to ask what it is running on: the frozen
 * `navigator.userAgent` string, and `navigator.userAgentData` plus the
 * `Sec-CH-UA-*` request headers. Overriding only the string leaves the second
 * channel telling the truth about the host machine — a "Pixel 8" that reports
 * `platform: "Windows"` is exactly the kind of half-emulation a responsive
 * layout branches on. So the override carries `userAgentMetadata` too
 * (spec §5.2, "UA + Client Hints"), and this module is where the metadata
 * comes from.
 *
 * Derived rather than stored per device: every value here is a function of
 * the user-agent string the device already carries, which keeps the catalog
 * (and the user's own devices, whose only editable field is that string) from
 * having to be right twice. Only a Chromium user agent gets hints at all —
 * Safari and Firefox have no Client Hints, and a device that claims to be an
 * iPhone is most honest with `navigator.userAgentData` absent (`null` here;
 * `CDPController` then sends no metadata, and Chromium exposes none).
 */

import type { DeviceSpec } from './types'

/** What `Sec-CH-UA-Platform` may say. Chromium's own spellings. */
export type ClientHintsPlatform = 'Android' | 'Windows' | 'macOS' | 'Linux' | 'Chrome OS' | ''

export type ClientHints = {
  platform: ClientHintsPlatform
  /** `Sec-CH-UA-Platform-Version`: `15.0.0` on Android 15, `''` when unknown. */
  platformVersion: string
  /** `Sec-CH-UA-Arch`: `x86` / `arm`, or `''` — which is what Chrome on Android sends. */
  architecture: string
  /** `Sec-CH-UA-Bitness`: `64`, or `''` on Android. */
  bitness: string
  /** `Sec-CH-UA-Model`: the phone's model as the UA string names it; `''` on desktops. */
  model: string
  /** `Sec-CH-UA-Mobile`: the `Mobile` token — an Android tablet is `?0`. */
  mobile: boolean
  /** The Chromium major the UA string claims. The brands are built from it. */
  chromeMajor: string
  /** The browser brand alongside `Chromium`. */
  brand: 'Google Chrome' | 'Microsoft Edge'
}

/** One entry of `brands` / `fullVersionList`. */
export type UserAgentBrand = { brand: string; version: string }

/** `Network.setUserAgentOverride`'s `userAgentMetadata`, as the protocol wants it. */
export type UserAgentMetadata = {
  brands: UserAgentBrand[]
  fullVersionList: UserAgentBrand[]
  platform: string
  platformVersion: string
  architecture: string
  model: string
  mobile: boolean
  bitness: string
}

/**
 * The GREASE brand every Chromium adds so that sites cannot match the list
 * literally. Chrome varies the spelling by version; one fixed spelling is
 * still a valid GREASE and still not a brand anyone would sniff for.
 */
const GREASE: UserAgentBrand = { brand: 'Not_A Brand', version: '24' }

/**
 * What Chrome on a current Windows reports in `platformVersion`. The UA string
 * says `NT 10.0` for Windows 10 and 11 alike (it is frozen), so the hint is
 * the only channel that carries the real one; `15.0.0` is Windows 11 23H2+.
 */
const WINDOWS_PLATFORM_VERSION = '15.0.0'

/**
 * Same story on macOS: the UA string is frozen at `10_15_7` for every macOS
 * since Catalina, and the hint carries the real version.
 */
const MACOS_PLATFORM_VERSION = '15.0.0'

const CHROME_RE = /\bChrome\/(\d+)(?:\.\d+)*/
const ANDROID_RE = /\bAndroid (\d+)(?:\.(\d+))?(?:\.(\d+))?;?\s*([^;)]*)\)/
const MACOS_RE = /\bMac OS X\b/
const WINDOWS_RE = /\bWindows NT\b/
const CROS_RE = /\bCrOS \w+ (\d+(?:\.\d+)*)\b/
const LINUX_RE = /\bLinux\b/

/**
 * The hints a user-agent string implies, or `null` for a browser that has no
 * Client Hints to send.
 */
export function clientHintsOf(device: Pick<DeviceSpec, 'userAgent'>): ClientHints | null {
  const ua = device.userAgent
  const chrome = CHROME_RE.exec(ua)
  if (chrome === null || chrome[1] === undefined) return null

  const brand = /\bEdg(?:e|A|iOS)?\/\d/.test(ua) ? 'Microsoft Edge' : 'Google Chrome'
  const base = { chromeMajor: chrome[1], brand } as const

  const android = ANDROID_RE.exec(ua)
  if (android !== null) {
    const [, major, minor, patch, rawModel] = android
    // `Pixel 8 Build/AP2A…` is how a real Android UA names the device; the
    // hint carries only the model.
    const model = (rawModel ?? '').replace(/\s*Build\/.*$/, '').trim()
    return {
      ...base,
      platform: 'Android',
      platformVersion: `${major ?? '0'}.${minor ?? '0'}.${patch ?? '0'}`,
      // Chrome on Android sends both empty, and a site that has learned to
      // expect that would find `arm` more surprising than nothing.
      architecture: '',
      bitness: '',
      model,
      mobile: /\bMobile\b/.test(ua)
    }
  }

  if (WINDOWS_RE.test(ua)) {
    return {
      ...base,
      platform: 'Windows',
      platformVersion: WINDOWS_PLATFORM_VERSION,
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false
    }
  }

  if (MACOS_RE.test(ua)) {
    return {
      ...base,
      platform: 'macOS',
      platformVersion: MACOS_PLATFORM_VERSION,
      architecture: 'arm',
      bitness: '64',
      model: '',
      mobile: false
    }
  }

  const cros = CROS_RE.exec(ua)
  if (cros !== null) {
    return {
      ...base,
      platform: 'Chrome OS',
      platformVersion: cros[1] ?? '',
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false
    }
  }

  if (LINUX_RE.test(ua)) {
    return {
      ...base,
      platform: 'Linux',
      platformVersion: '',
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false
    }
  }

  // A Chromium on a platform this module does not know. Hints with an empty
  // platform beat none: the brands and the mobile flag are still right.
  return {
    ...base,
    platform: '',
    platformVersion: '',
    architecture: '',
    bitness: '',
    model: '',
    mobile: /\bMobile\b/.test(ua)
  }
}

/**
 * The protocol payload for a set of hints.
 *
 * `engineVersion` is the Chromium Respo itself runs on (`process.versions.chrome`).
 * It is used for the full version list only when its major agrees with the
 * user-agent string's: a page comparing `Sec-CH-UA-Full-Version-List` with
 * `navigator.userAgent` must see one browser, not two. When they disagree —
 * a catalog string that has not been bumped, a user's own — the string wins
 * and the full version is its major with zeros, which is what a frozen UA
 * string says anyway.
 */
export function userAgentMetadataFor(
  hints: ClientHints,
  engineVersion: string | null
): UserAgentMetadata {
  const engineMajor = engineVersion?.split('.')[0] ?? null
  const fullVersion =
    engineVersion !== null && engineMajor === hints.chromeMajor
      ? engineVersion
      : `${hints.chromeMajor}.0.0.0`

  return {
    brands: [
      GREASE,
      { brand: 'Chromium', version: hints.chromeMajor },
      { brand: hints.brand, version: hints.chromeMajor }
    ],
    fullVersionList: [
      { brand: GREASE.brand, version: `${GREASE.version}.0.0.0` },
      { brand: 'Chromium', version: fullVersion },
      { brand: hints.brand, version: fullVersion }
    ],
    platform: hints.platform,
    platformVersion: hints.platformVersion,
    architecture: hints.architecture,
    model: hints.model,
    mobile: hints.mobile,
    bitness: hints.bitness
  }
}
