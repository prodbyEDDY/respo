import type { DeviceSpec, DeviceType } from './types'

/**
 * The device catalog Respo emulates.
 *
 * Provenance (CLAUDE.md §1): the metrics are re-typed by hand from the device
 * list Chromium ships in DevTools (`emulated_devices`, BSD-3-Clause) plus
 * public vendor specs. Nothing here is copied from responsively-app or any
 * other AGPL source — neither its code nor its `deviceList` data.
 *
 * Each entry is a plain `DeviceSpec`: the viewport in CSS pixels, the
 * `devicePixelRatio` to emulate, the user agent to report, and whether the page
 * should see a touch screen. Those four are exactly what the CDP emulation task
 * feeds to `Emulation.setDeviceMetricsOverride`,
 * `Emulation.setTouchEmulationEnabled` and `Network.setUserAgentOverride`.
 *
 * Bumping browser/OS versions is a one-line edit to the constants below.
 */

const CHROME = '152.0.0.0'
const IOS = '26_0'
const IOS_SAFARI = '26.0'
const ANDROID = '16'

/** Mobile Safari on iPhone. Apple pins the WebKit/Mobile build tokens. */
const IPHONE_UA = `Mozilla/5.0 (iPhone; CPU iPhone OS ${IOS} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${IOS_SAFARI} Mobile/15E148 Safari/604.1`

/** Mobile Safari on iPad. */
const IPAD_UA = `Mozilla/5.0 (iPad; CPU OS ${IOS} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${IOS_SAFARI} Mobile/15E148 Safari/604.1`

/** Chrome on an Android phone — the `Mobile` token is what sites branch on. */
function androidPhone(model: string, release: string = ANDROID): string {
  return `Mozilla/5.0 (Linux; Android ${release}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36`
}

/** Chrome on an Android tablet — same string without `Mobile`. */
function androidTablet(model: string, release: string = ANDROID): string {
  return `Mozilla/5.0 (Linux; Android ${release}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`
}

const WINDOWS_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`

const MACOS_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`

/** Chrome on a Chromebook (ChromeOS). */
const CROS_UA = `Mozilla/5.0 (X11; CrOS x86_64 15917.95.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`

/** Amazon Silk (Chromium-based) on a Kindle Fire tablet. */
function fireTabletUA(model: string, release: string = '9'): string {
  return `Mozilla/5.0 (Linux; Android ${release}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Silk/133.6.6 like Chrome/${CHROME} Safari/537.36`
}

// prettier-ignore
const CATALOG: DeviceSpec[] = [
  // ── iPhone ────────────────────────────────────────────────────────────────
  { id: 'iphone-se',          name: 'iPhone SE',           width: 375,  height: 667,  dpr: 2,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-13-mini',     name: 'iPhone 13 mini',      width: 375,  height: 812,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-12-pro',      name: 'iPhone 12 Pro',       width: 390,  height: 844,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-14',          name: 'iPhone 14',           width: 390,  height: 844,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-14-pro-max',  name: 'iPhone 14 Pro Max',   width: 430,  height: 932,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-15',          name: 'iPhone 15',           width: 393,  height: 852,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-15-pro',      name: 'iPhone 15 Pro',       width: 393,  height: 852,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-15-pro-max',  name: 'iPhone 15 Pro Max',   width: 430,  height: 932,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-16',          name: 'iPhone 16',           width: 393,  height: 852,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-16-pro',      name: 'iPhone 16 Pro',       width: 402,  height: 874,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-16-pro-max',  name: 'iPhone 16 Pro Max',   width: 440,  height: 956,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-8',           name: 'iPhone 8',            width: 375,  height: 667,  dpr: 2,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-x',           name: 'iPhone X',            width: 375,  height: 812,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-xr',          name: 'iPhone XR',           width: 414,  height: 896,  dpr: 2,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-11',          name: 'iPhone 11',           width: 414,  height: 896,  dpr: 2,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-12-mini',     name: 'iPhone 12 mini',      width: 375,  height: 812,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-13',          name: 'iPhone 13',           width: 390,  height: 844,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-13-pro',      name: 'iPhone 13 Pro',       width: 390,  height: 844,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-14-plus',     name: 'iPhone 14 Plus',      width: 428,  height: 926,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-14-pro',      name: 'iPhone 14 Pro',       width: 393,  height: 852,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-15-plus',     name: 'iPhone 15 Plus',      width: 430,  height: 932,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-16-plus',     name: 'iPhone 16 Plus',      width: 430,  height: 932,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-16e',         name: 'iPhone 16e',          width: 390,  height: 844,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-17',          name: 'iPhone 17',           width: 402,  height: 874,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-17-pro',      name: 'iPhone 17 Pro',       width: 402,  height: 874,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-17-pro-max',  name: 'iPhone 17 Pro Max',   width: 440,  height: 956,  dpr: 3,     userAgent: IPHONE_UA, touch: true },
  { id: 'iphone-air',         name: 'iPhone Air',          width: 420,  height: 912,  dpr: 3,     userAgent: IPHONE_UA, touch: true },

  // ── Android phones ────────────────────────────────────────────────────────
  { id: 'pixel-7',            name: 'Pixel 7',             width: 412,  height: 915,  dpr: 2.625, userAgent: androidPhone('Pixel 7'),        touch: true },
  { id: 'pixel-8',            name: 'Pixel 8',             width: 412,  height: 915,  dpr: 2.625, userAgent: androidPhone('Pixel 8'),        touch: true },
  { id: 'pixel-8-pro',        name: 'Pixel 8 Pro',         width: 448,  height: 992,  dpr: 2.625, userAgent: androidPhone('Pixel 8 Pro'),    touch: true },
  { id: 'pixel-fold',         name: 'Pixel Fold',          width: 841,  height: 891,  dpr: 2.625, userAgent: androidPhone('Pixel Fold'),     touch: true },
  { id: 'galaxy-s20-ultra',   name: 'Galaxy S20 Ultra',    width: 412,  height: 915,  dpr: 3.5,   userAgent: androidPhone('SM-G988B', '13'), touch: true },
  { id: 'galaxy-s23',         name: 'Galaxy S23',          width: 360,  height: 780,  dpr: 3,     userAgent: androidPhone('SM-S911B', '14'), touch: true },
  { id: 'galaxy-a54',         name: 'Galaxy A54',          width: 360,  height: 800,  dpr: 3,     userAgent: androidPhone('SM-A546B', '14'), touch: true },
  { id: 'galaxy-z-fold-5',    name: 'Galaxy Z Fold 5',     width: 344,  height: 882,  dpr: 2.625, userAgent: androidPhone('SM-F946B', '14'), touch: true },
  { id: 'galaxy-z-fold-5-open', name: 'Galaxy Z Fold 5 (unfolded)', width: 768, height: 1076, dpr: 2, userAgent: androidPhone('SM-F946B', '14'), touch: true },
  { id: 'xiaomi-14',          name: 'Xiaomi 14',           width: 393,  height: 873,  dpr: 3,     userAgent: androidPhone('2311DRK48G', '14'), touch: true },
  { id: 'moto-g-power',       name: 'Moto G Power',        width: 412,  height: 823,  dpr: 1.75,  userAgent: androidPhone('moto g power', '13'), touch: true },
  { id: 'pixel-3',            name: 'Pixel 3',             width: 393,  height: 786,  dpr: 2.75,  userAgent: androidPhone('Pixel 3', '12'),          touch: true },
  { id: 'pixel-5',            name: 'Pixel 5',             width: 393,  height: 851,  dpr: 2.75,  userAgent: androidPhone('Pixel 5', '13'),          touch: true },
  { id: 'pixel-6',            name: 'Pixel 6',             width: 412,  height: 915,  dpr: 2.625, userAgent: androidPhone('Pixel 6', '15'),          touch: true },
  { id: 'pixel-6-pro',        name: 'Pixel 6 Pro',         width: 412,  height: 892,  dpr: 3.5,   userAgent: androidPhone('Pixel 6 Pro', '15'),      touch: true },
  { id: 'pixel-7-pro',        name: 'Pixel 7 Pro',         width: 412,  height: 892,  dpr: 3.5,   userAgent: androidPhone('Pixel 7 Pro', '15'),      touch: true },
  { id: 'pixel-8a',           name: 'Pixel 8a',            width: 412,  height: 915,  dpr: 2.625, userAgent: androidPhone('Pixel 8a'),               touch: true },
  { id: 'pixel-9',            name: 'Pixel 9',             width: 412,  height: 924,  dpr: 2.625, userAgent: androidPhone('Pixel 9'),                touch: true },
  { id: 'pixel-9-pro',        name: 'Pixel 9 Pro',         width: 427,  height: 952,  dpr: 3,     userAgent: androidPhone('Pixel 9 Pro'),            touch: true },
  { id: 'pixel-9-pro-xl',     name: 'Pixel 9 Pro XL',      width: 448,  height: 997,  dpr: 3,     userAgent: androidPhone('Pixel 9 Pro XL'),         touch: true },
  { id: 'pixel-9-pro-fold',   name: 'Pixel 9 Pro Fold',    width: 412,  height: 922,  dpr: 2.625, userAgent: androidPhone('Pixel 9 Pro Fold'),       touch: true },
  { id: 'pixel-9-pro-fold-open', name: 'Pixel 9 Pro Fold (unfolded)', width: 836, height: 842, dpr: 2.625, userAgent: androidPhone('Pixel 9 Pro Fold'), touch: true },
  { id: 'pixel-10',           name: 'Pixel 10',            width: 412,  height: 924,  dpr: 2.625, userAgent: androidPhone('Pixel 10'),               touch: true },
  { id: 'galaxy-s8',          name: 'Galaxy S8',           width: 360,  height: 740,  dpr: 4,     userAgent: androidPhone('SM-G950F', '9'),          touch: true },
  { id: 'galaxy-s9',          name: 'Galaxy S9',           width: 360,  height: 740,  dpr: 4,     userAgent: androidPhone('SM-G960F', '10'),         touch: true },
  { id: 'galaxy-s10',         name: 'Galaxy S10',          width: 360,  height: 760,  dpr: 4,     userAgent: androidPhone('SM-G973F', '12'),         touch: true },
  { id: 'galaxy-s21',         name: 'Galaxy S21',          width: 360,  height: 800,  dpr: 3,     userAgent: androidPhone('SM-G991B', '15'),         touch: true },
  { id: 'galaxy-s22',         name: 'Galaxy S22',          width: 360,  height: 780,  dpr: 3,     userAgent: androidPhone('SM-S901B'),               touch: true },
  { id: 'galaxy-s23-ultra',   name: 'Galaxy S23 Ultra',    width: 384,  height: 824,  dpr: 3.5,   userAgent: androidPhone('SM-S918B'),               touch: true },
  { id: 'galaxy-s24',         name: 'Galaxy S24',          width: 360,  height: 780,  dpr: 3,     userAgent: androidPhone('SM-S921B'),               touch: true },
  { id: 'galaxy-s24-ultra',   name: 'Galaxy S24 Ultra',    width: 384,  height: 824,  dpr: 3.5,   userAgent: androidPhone('SM-S928B'),               touch: true },
  { id: 'galaxy-s25',         name: 'Galaxy S25',          width: 360,  height: 780,  dpr: 3,     userAgent: androidPhone('SM-S931B'),               touch: true },
  { id: 'galaxy-s25-ultra',   name: 'Galaxy S25 Ultra',    width: 384,  height: 824,  dpr: 3.5,   userAgent: androidPhone('SM-S938B'),               touch: true },
  { id: 'galaxy-s25-edge',    name: 'Galaxy S25 Edge',     width: 360,  height: 804,  dpr: 3,     userAgent: androidPhone('SM-S937B'),               touch: true },
  { id: 'galaxy-z-flip',      name: 'Galaxy Z Flip 6',     width: 412,  height: 917,  dpr: 2.6,   userAgent: androidPhone('SM-F741B'),               touch: true },
  { id: 'galaxy-z-fold-6',    name: 'Galaxy Z Fold 6',     width: 412,  height: 968,  dpr: 2.625, userAgent: androidPhone('SM-F956B'),               touch: true },
  { id: 'galaxy-z-fold-6-open', name: 'Galaxy Z Fold 6 (unfolded)', width: 744, height: 860, dpr: 2.625, userAgent: androidPhone('SM-F956B'),        touch: true },
  { id: 'oneplus-12',         name: 'OnePlus 12',          width: 412,  height: 919,  dpr: 3.5,   userAgent: androidPhone('CPH2583'),                touch: true },
  { id: 'oneplus-13',         name: 'OnePlus 13',          width: 412,  height: 919,  dpr: 3.5,   userAgent: androidPhone('CPH2655'),                touch: true },
  { id: 'nothing-phone-2',    name: 'Nothing Phone (2)',   width: 412,  height: 915,  dpr: 2.625, userAgent: androidPhone('A065'),                   touch: true },
  { id: 'moto-g4',            name: 'Moto G4',             width: 360,  height: 640,  dpr: 3,     userAgent: androidPhone('Moto G (4)', '6.0.1'),    touch: true },

  // ── Tablets ───────────────────────────────────────────────────────────────
  { id: 'ipad-mini',          name: 'iPad mini',           width: 768,  height: 1024, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'ipad-air',           name: 'iPad Air',            width: 820,  height: 1180, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'ipad-pro-11',        name: 'iPad Pro 11"',        width: 834,  height: 1194, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'ipad-pro-13',        name: 'iPad Pro 13"',        width: 1024, height: 1366, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'galaxy-tab-s9',      name: 'Galaxy Tab S9',       width: 800,  height: 1280, dpr: 2.25,  userAgent: androidTablet('SM-X710', '14'), touch: true },
  { id: 'surface-duo',        name: 'Surface Duo',         width: 540,  height: 720,  dpr: 2.5,   userAgent: androidPhone('Surface Duo', '12'), touch: true },
  { id: 'nest-hub',           name: 'Nest Hub',            width: 1024, height: 600,  dpr: 2,     userAgent: androidTablet('Nest Hub', '12'), touch: true },
  { id: 'surface-pro-7',      name: 'Surface Pro 7',       width: 912,  height: 1368, dpr: 2,     userAgent: WINDOWS_UA, touch: true },
  { id: 'ipad-10th-gen',      name: 'iPad (10th gen)',     width: 820,  height: 1180, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'ipad-air-11',        name: 'iPad Air 11" (M3)',   width: 820,  height: 1180, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'ipad-air-13',        name: 'iPad Air 13" (M3)',   width: 1024, height: 1366, dpr: 2,     userAgent: IPAD_UA, touch: true },
  { id: 'galaxy-tab-s9-ultra', name: 'Galaxy Tab S9 Ultra', width: 924, height: 1480, dpr: 2,     userAgent: androidTablet('SM-X910'), touch: true },
  { id: 'galaxy-tab-s10-plus', name: 'Galaxy Tab S10+',    width: 880,  height: 1400, dpr: 2,     userAgent: androidTablet('SM-X926B'), touch: true },
  { id: 'pixel-tablet',       name: 'Pixel Tablet',        width: 800,  height: 1280, dpr: 2,     userAgent: androidTablet('Pixel Tablet'), touch: true },
  { id: 'kindle-fire-hdx',    name: 'Kindle Fire HDX 8.9', width: 800,  height: 1280, dpr: 2,     userAgent: fireTabletUA('KFTHWI', '4.4.3'), touch: true },
  { id: 'kindle-fire-hd',     name: 'Fire HD 8',           width: 800,  height: 1280, dpr: 1,     userAgent: fireTabletUA('KFTRPWI', '9'), touch: true },
  { id: 'nexus-7',            name: 'Nexus 7',             width: 600,  height: 960,  dpr: 2,     userAgent: androidTablet('Nexus 7', '6.0.1'), touch: true },
  { id: 'nexus-10',           name: 'Nexus 10',            width: 800,  height: 1280, dpr: 2,     userAgent: androidTablet('Nexus 10', '5.1.1'), touch: true },
  { id: 'surface-pro-9',      name: 'Surface Pro 9',       width: 960,  height: 1440, dpr: 2,     userAgent: WINDOWS_UA, touch: true },
  { id: 'surface-pro-11',     name: 'Surface Pro 11',      width: 960,  height: 1440, dpr: 2,     userAgent: WINDOWS_UA, touch: true },

  // ── Laptops and desktops ──────────────────────────────────────────────────
  { id: 'macbook-1280',       name: 'MacBook 1280',        width: 1280, height: 800,  dpr: 2,     userAgent: MACOS_UA,   touch: false },
  { id: 'macbook-pro-1512',   name: 'MacBook Pro 14"',     width: 1512, height: 982,  dpr: 2,     userAgent: MACOS_UA,   touch: false },
  { id: 'laptop-1366',        name: 'Laptop 1366',         width: 1366, height: 768,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'laptop-1536',        name: 'Laptop 1536',         width: 1536, height: 864,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1440',       name: 'Desktop 1440',        width: 1440, height: 900,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1600',       name: 'Desktop 1600',        width: 1600, height: 900,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1920',       name: 'Desktop 1920',        width: 1920, height: 1080, dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-2560',       name: 'Desktop 2560',        width: 2560, height: 1440, dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'macbook-air-13',     name: 'MacBook Air 13" (M4)', width: 1470, height: 956,  dpr: 2,     userAgent: MACOS_UA,   touch: false },
  { id: 'macbook-air-15',     name: 'MacBook Air 15" (M4)', width: 1710, height: 1112, dpr: 2,     userAgent: MACOS_UA,   touch: false },
  { id: 'macbook-pro-16',     name: 'MacBook Pro 16" (M4)', width: 1728, height: 1117, dpr: 2,     userAgent: MACOS_UA,   touch: false },
  { id: 'imac-24',            name: 'iMac 24"',             width: 2240, height: 1260, dpr: 2,     userAgent: MACOS_UA,   touch: false },
  { id: 'chromebook-1366',    name: 'Chromebook',           width: 1366, height: 768,  dpr: 1,     userAgent: CROS_UA,    touch: false },
  { id: 'laptop-1440',        name: 'Laptop 1440',          width: 1440, height: 900,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'laptop-1920-hidpi',  name: 'Laptop 1920 HiDPI',    width: 1920, height: 1080, dpr: 1.25,  userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1024',       name: 'Desktop 1024',         width: 1024, height: 768,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1280',       name: 'Desktop 1280',         width: 1280, height: 720,  dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1680',       name: 'Desktop 1680',         width: 1680, height: 1050, dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-1920-1200',  name: 'Desktop 1920×1200',    width: 1920, height: 1200, dpr: 1,     userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-2560-1080',  name: 'Desktop 2560×1080 (ultrawide)', width: 2560, height: 1080, dpr: 1, userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-3440-1440',  name: 'Desktop 3440×1440 (ultrawide)', width: 3440, height: 1440, dpr: 1, userAgent: WINDOWS_UA, touch: false },
  { id: 'desktop-3840-4k',    name: 'Desktop 3840×2160 (4K)', width: 3840, height: 2160, dpr: 1,   userAgent: WINDOWS_UA, touch: false }
]

/** Every device Respo can emulate, in picker order. */
export const DEVICE_CATALOG: readonly DeviceSpec[] = CATALOG

const BY_ID: ReadonlyMap<string, DeviceSpec> = new Map(CATALOG.map((d) => [d.id, d]))

/**
 * The selection a fresh session opens with — one phone per platform, a tablet,
 * a laptop and a desktop, matching the approved concept.
 */
export const DEFAULT_ACTIVE_DEVICE_IDS: readonly string[] = [
  'iphone-15-pro',
  'pixel-8',
  'ipad-mini',
  'macbook-1280',
  'desktop-1440'
]

/**
 * What a hand-built device of each kind reports by default.
 *
 * The starting point for a custom device, and what the editor swaps in when the
 * user changes its type — a plausible, current string they can then edit rather
 * than an empty field they have to research.
 */
export const DEFAULT_USER_AGENTS: Readonly<Record<DeviceType, string>> = {
  phone: IPHONE_UA,
  tablet: IPAD_UA,
  desktop: WINDOWS_UA
}

/** Look one device up. `undefined` when the id is not in the catalog. */
export function deviceById(id: string): DeviceSpec | undefined {
  return BY_ID.get(id)
}

/**
 * Resolve ids to specs, keeping the caller's order, skipping ids the catalog
 * does not know and collapsing duplicates — one device never gets two views.
 */
export function devicesByIds(ids: readonly string[]): DeviceSpec[] {
  const seen = new Set<string>()
  const out: DeviceSpec[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const device = BY_ID.get(id)
    if (device === undefined) continue
    seen.add(id)
    out.push(device)
  }
  return out
}
