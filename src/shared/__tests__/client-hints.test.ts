import { describe, expect, it } from 'vitest'
import { clientHintsOf, userAgentMetadataFor } from '../client-hints'
import { DEVICE_CATALOG } from '../deviceCatalog'

const PIXEL =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
const TAB =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

describe('clientHintsOf', () => {
  it('reads an Android phone: platform, version, model, mobile', () => {
    expect(clientHintsOf({ userAgent: PIXEL })).toEqual({
      platform: 'Android',
      platformVersion: '15.0.0',
      architecture: '',
      bitness: '',
      model: 'Pixel 8',
      mobile: true,
      chromeMajor: '139',
      brand: 'Google Chrome'
    })
  })

  it('an Android tablet is not mobile', () => {
    expect(clientHintsOf({ userAgent: TAB })).toMatchObject({
      platform: 'Android',
      platformVersion: '14.0.0',
      model: 'SM-X710',
      mobile: false
    })
  })

  it('keeps a dotted Android version and drops a Build token from the model', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13.0.1; Pixel 7 Build/TQ3A.230805.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36'
    expect(clientHintsOf({ userAgent: ua })).toMatchObject({
      platformVersion: '13.0.1',
      model: 'Pixel 7',
      chromeMajor: '120'
    })
  })

  it('has nothing to say for Safari — an iPhone has no Client Hints', () => {
    expect(clientHintsOf({ userAgent: IPHONE })).toBeNull()
  })

  it('has nothing to say for Chrome on iOS either (it is WebKit)', () => {
    const crios =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.0.0 Mobile/15E148 Safari/604.1'
    expect(clientHintsOf({ userAgent: crios })).toBeNull()
  })

  it('has nothing to say for Firefox', () => {
    expect(
      clientHintsOf({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
      })
    ).toBeNull()
  })

  it('reads Windows and macOS desktops, with the real platform version in the hint', () => {
    expect(clientHintsOf({ userAgent: WINDOWS })).toMatchObject({
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false
    })
    expect(clientHintsOf({ userAgent: MAC })).toMatchObject({
      platform: 'macOS',
      architecture: 'arm',
      bitness: '64',
      mobile: false
    })
  })

  it('names Edge as the brand next to Chromium', () => {
    expect(clientHintsOf({ userAgent: `${WINDOWS} Edg/139.0.0.0` })?.brand).toBe('Microsoft Edge')
  })

  it('reads Chrome OS and Linux', () => {
    expect(
      clientHintsOf({
        userAgent:
          'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
      })
    ).toMatchObject({ platform: 'Chrome OS', platformVersion: '14541.0.0' })
    expect(
      clientHintsOf({
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
      })
    ).toMatchObject({ platform: 'Linux', architecture: 'x86' })
  })

  it('still answers for a Chromium on a platform it does not know', () => {
    expect(
      clientHintsOf({ userAgent: 'Mozilla/5.0 (Fridge OS) Chrome/139.0.0.0 Mobile Safari/537.36' })
    ).toMatchObject({ platform: '', chromeMajor: '139', mobile: true })
  })

  it('answers for every Chromium device in the catalog, and for no Safari one', () => {
    for (const device of DEVICE_CATALOG) {
      const hints = clientHintsOf(device)
      if (device.userAgent.includes('Chrome/')) {
        expect(hints, device.id).not.toBeNull()
        expect(hints?.platform, device.id).not.toBe('')
      } else {
        expect(hints, device.id).toBeNull()
      }
    }
  })
})

describe('userAgentMetadataFor', () => {
  const hints = clientHintsOf({ userAgent: PIXEL })!

  it('builds brands from the UA major, with a GREASE entry', () => {
    const metadata = userAgentMetadataFor(hints, '139.0.7258.66')
    expect(metadata.brands).toEqual(
      expect.arrayContaining([
        { brand: 'Chromium', version: '139' },
        { brand: 'Google Chrome', version: '139' }
      ])
    )
    expect(metadata.brands).toHaveLength(3)
    expect(metadata.brands.some((b) => /Not/.test(b.brand))).toBe(true)
  })

  it('uses the engine’s full version when the majors agree', () => {
    const metadata = userAgentMetadataFor(hints, '139.0.7258.66')
    expect(metadata.fullVersionList).toEqual(
      expect.arrayContaining([{ brand: 'Chromium', version: '139.0.7258.66' }])
    )
  })

  it('lets the user-agent string win when the engine is another major', () => {
    const metadata = userAgentMetadataFor(hints, '152.0.7977.54')
    expect(metadata.fullVersionList).toEqual(
      expect.arrayContaining([{ brand: 'Google Chrome', version: '139.0.0.0' }])
    )
    expect(userAgentMetadataFor(hints, null).fullVersionList).toEqual(
      expect.arrayContaining([{ brand: 'Chromium', version: '139.0.0.0' }])
    )
  })

  it('carries the platform fields through in the protocol’s names', () => {
    expect(userAgentMetadataFor(hints, null)).toMatchObject({
      platform: 'Android',
      platformVersion: '15.0.0',
      architecture: '',
      model: 'Pixel 8',
      mobile: true,
      bitness: ''
    })
  })
})
