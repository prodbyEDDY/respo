import type { DeviceSpec } from './types'

/**
 * TEMPORARY device set for the ViewManager spike.
 *
 * The real catalog (90+ devices, sourced from Chromium's BSD-licensed device
 * list) lands with the device-catalog task and replaces this module wholesale.
 * Ten entries is not an arbitrary number: it is the perf budget in spec §8.
 */
const CHROME = '139.0.0.0'
const SAFARI_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const SAFARI_TABLET =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_PHONE = `Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36`
const DESKTOP = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`

export const SPIKE_DEVICES: readonly DeviceSpec[] = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, dpr: 2, userAgent: SAFARI_MOBILE, touch: true }, // prettier-ignore
  { id: 'iphone-15', name: 'iPhone 15', width: 393, height: 852, dpr: 3, userAgent: SAFARI_MOBILE, touch: true }, // prettier-ignore
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', width: 430, height: 932, dpr: 3, userAgent: SAFARI_MOBILE, touch: true }, // prettier-ignore
  { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_PHONE, touch: true }, // prettier-ignore
  { id: 'galaxy-s23', name: 'Galaxy S23', width: 360, height: 780, dpr: 3, userAgent: ANDROID_PHONE, touch: true }, // prettier-ignore
  { id: 'galaxy-fold', name: 'Galaxy Z Fold', width: 344, height: 882, dpr: 2.625, userAgent: ANDROID_PHONE, touch: true }, // prettier-ignore
  { id: 'ipad-mini', name: 'iPad mini', width: 768, height: 1024, dpr: 2, userAgent: SAFARI_TABLET, touch: true }, // prettier-ignore
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', width: 834, height: 1194, dpr: 2, userAgent: SAFARI_TABLET, touch: true }, // prettier-ignore
  { id: 'laptop', name: 'Laptop', width: 1280, height: 800, dpr: 1, userAgent: DESKTOP, touch: false }, // prettier-ignore
  { id: 'desktop', name: 'Desktop', width: 1440, height: 900, dpr: 1, userAgent: DESKTOP, touch: false } // prettier-ignore
]
