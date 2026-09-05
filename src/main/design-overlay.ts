/**
 * Design overlays: a mockup laid over the page (spec §5.7).
 *
 * The image is a CSS layer on the page, like the guides: an `html::before`
 * pseudo-element at the document's origin, centred, sized to the image and
 * painted with it as a `data:` background — so it scrolls with the document
 * and the designer's export lines up with the layout underneath. Opacity and
 * a left-to-right curtain (`clip-path: inset`) are two more declarations on
 * the same rule, so a slider costs one `insertCSS` and nothing in the page
 * runs (CLAUDE.md §3).
 *
 * The images themselves are the one thing in Respo that is measured in
 * megabytes, so they do not live in the settings document (which is written
 * on every debounce) but under their own store key, by content id, with a
 * total cap: past 100 MB the least recently used image goes. A setting that
 * points at an evicted image simply shows nothing, and the dialog says so.
 */

import { createHash } from 'node:crypto'
import { MAX_OVERLAY_IMAGE_BYTES, type OverlayApply, type OverlayImage } from '@shared/ipc'
import { IMAGE_ID_RE } from '@shared/persistence-types'
import type { CdpTarget } from './cdp-controller'
import type { CssLayer } from './diagnostics'
import type { PersistenceBackend } from './persistence'

/** The store key the images live under. Not part of the settings document. */
export const OVERLAY_IMAGES_KEY = 'overlayImages'

/** Total the store may hold before the least recently used image goes. */
export const MAX_OVERLAY_STORE_BYTES = 100 * 1024 * 1024

/** What `nativeImage` answers with, behind an interface so the store is testable. */
export type ImageDecoder = (bytes: Buffer) => { width: number; height: number } | null

type StoredImage = {
  dataUrl: string
  width: number
  height: number
  bytes: number
  /** When it was last stored or shown. Epoch milliseconds. */
  usedAt: number
}

type ImagesDocument = Record<string, StoredImage>

export type OverlayDeviceRegistration = {
  deviceId: string
  target: CdpTarget
  css: CssLayer
}

/** Same registry shape as the other per-view managers. */
export interface OverlayRegistry {
  registerDevice(registration: OverlayDeviceRegistration): void
  /** The view finished loading a document: put its overlay back on it. */
  refresh(deviceId: string): void
  unregisterDevice(deviceId: string): void
}

export type DesignOverlayManagerOptions = {
  backend: PersistenceBackend
  decode: ImageDecoder
  now?: () => number
  /** The store's own cap. Injectable so the eviction is testable in kilobytes. */
  maxStoreBytes?: number
}

/** The content id of some bytes: enough of the SHA-256 to never collide by accident. */
export function imageIdOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

/**
 * The stylesheet for one overlay. Exported for its unit test.
 *
 * Centred like a mockup is meant to be read, and never wider than the
 * viewport: an image wider than the page is scaled to fit rather than
 * allowed to make the page scroll sideways. `aspect-ratio` keeps the height
 * honest when that happens.
 */
export function overlayCss(
  image: { width: number; height: number; dataUrl: string },
  apply: OverlayApply
): string {
  const curtain = Math.round(apply.curtain * 1000) / 10
  return (
    `html::before { content: '' !important; position: absolute !important; top: 0 !important; left: 50% !important; ` +
    `transform: translateX(-50%) !important; width: ${Math.round(image.width)}px !important; max-width: 100% !important; ` +
    `aspect-ratio: ${Math.round(image.width)} / ${Math.round(image.height)} !important; height: auto !important; ` +
    `background: url(${image.dataUrl}) no-repeat 0 0 / 100% 100% !important; ` +
    `opacity: ${apply.opacity} !important; clip-path: inset(0 0 0 ${curtain}%) !important; ` +
    `pointer-events: none !important; z-index: 2147483646 !important; }`
  )
}

function isStoredImage(value: unknown): value is StoredImage {
  if (typeof value !== 'object' || value === null) return false
  const image = value as Record<string, unknown>
  return (
    typeof image['dataUrl'] === 'string' &&
    image['dataUrl'].startsWith('data:image/') &&
    typeof image['width'] === 'number' &&
    typeof image['height'] === 'number' &&
    typeof image['bytes'] === 'number' &&
    typeof image['usedAt'] === 'number'
  )
}

type Entry = {
  deviceId: string
  target: CdpTarget
  css: CssLayer
  apply: OverlayApply | null
  key: string | null
  chain: Promise<void>
}

export class DesignOverlayManager implements OverlayRegistry {
  private readonly backend: PersistenceBackend
  private readonly decode: ImageDecoder
  private readonly now: () => number
  private readonly maxStoreBytes: number
  private readonly devices = new Map<string, Entry>()
  /**
   * What a device that has not registered yet was told to show. The frame
   * sends its settings the moment it mounts — on a restart, before the view
   * behind it has even been primed — and a set that arrived early must not
   * be a set that was lost.
   */
  private readonly pending = new Map<string, OverlayApply | null>()
  private images: ImagesDocument | null = null
  private disposed = false

  constructor(options: DesignOverlayManagerOptions) {
    this.backend = options.backend
    this.decode = options.decode
    this.now = options.now ?? Date.now
    this.maxStoreBytes = options.maxStoreBytes ?? MAX_OVERLAY_STORE_BYTES
  }

  /**
   * Keep an image. The data url has been shape-checked by the validator;
   * this is where the bytes are decoded and the cap enforced.
   */
  storeImage(
    dataUrl: string
  ):
    | { ok: true; image: Omit<OverlayImage, 'dataUrl'> }
    | { ok: false; reason: 'too-large' | 'unreadable'; message: string } {
    const comma = dataUrl.indexOf(',')
    const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64')
    if (bytes.byteLength > MAX_OVERLAY_IMAGE_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        message: `Images up to ${MAX_OVERLAY_IMAGE_BYTES / 1024 / 1024} MB, please.`
      }
    }
    const size = this.decode(bytes)
    if (size === null || size.width <= 0 || size.height <= 0) {
      return {
        ok: false,
        reason: 'unreadable',
        message: 'That file is not an image Respo can show.'
      }
    }

    const id = imageIdOf(bytes)
    const images = this.read()
    images[id] = {
      dataUrl,
      width: size.width,
      height: size.height,
      bytes: bytes.byteLength,
      usedAt: this.now()
    }
    this.evict(images, id)
    this.write(images)
    return {
      ok: true,
      image: { id, width: size.width, height: size.height, bytes: bytes.byteLength }
    }
  }

  /** A stored image, touched as recently used. `null` once evicted. */
  image(id: string): OverlayImage | null {
    if (!IMAGE_ID_RE.test(id)) return null
    const images = this.read()
    const stored = images[id]
    if (stored === undefined) return null
    stored.usedAt = this.now()
    this.write(images)
    return {
      id,
      width: stored.width,
      height: stored.height,
      bytes: stored.bytes,
      dataUrl: stored.dataUrl
    }
  }

  /** Every stored image's id and size, oldest first. Test seam. */
  inventory(): { id: string; bytes: number }[] {
    return Object.entries(this.read())
      .sort((a, b) => a[1].usedAt - b[1].usedAt)
      .map(([id, image]) => ({ id, bytes: image.bytes }))
  }

  registerDevice(registration: OverlayDeviceRegistration): void {
    if (this.disposed) return
    const entry: Entry = {
      deviceId: registration.deviceId,
      target: registration.target,
      css: registration.css,
      apply: this.pending.get(registration.deviceId) ?? null,
      key: null,
      chain: Promise.resolve()
    }
    this.pending.delete(registration.deviceId)
    this.devices.set(entry.deviceId, entry)
    if (entry.apply !== null) void this.queue(entry)
  }

  /** Put an overlay on one device's page, or (`null`) take it off. */
  set(deviceId: string, apply: OverlayApply | null): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const entry = this.devices.get(deviceId)
    if (entry === undefined) {
      this.pending.set(deviceId, apply === null ? null : { ...apply })
      return Promise.resolve()
    }
    entry.apply = apply === null ? null : { ...apply }
    return this.queue(entry)
  }

  refresh(deviceId: string): void {
    const entry = this.devices.get(deviceId)
    if (entry === undefined || this.disposed) return
    entry.key = null
    if (entry.apply === null) return
    void this.queue(entry)
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId)
    this.pending.delete(deviceId)
  }

  retain(live: ReadonlySet<string>): void {
    for (const deviceId of [...this.devices.keys(), ...this.pending.keys()]) {
      if (!live.has(deviceId)) this.unregisterDevice(deviceId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.devices.clear()
    this.pending.clear()
  }

  private queue(entry: Entry): Promise<void> {
    entry.chain = entry.chain.then(() => this.replace(entry)).catch(() => undefined)
    return entry.chain
  }

  private async replace(entry: Entry): Promise<void> {
    if (this.disposed || this.devices.get(entry.deviceId) !== entry) return
    if (entry.key !== null) {
      const key = entry.key
      entry.key = null
      try {
        await entry.css.remove(key)
      } catch {
        // The document that held the layer is gone; so is the layer.
      }
    }
    const { apply } = entry
    if (apply === null) return
    const image = this.image(apply.imageId)
    if (image === null) return
    try {
      entry.key = await entry.css.insert(overlayCss(image, apply))
    } catch {
      // A view mid-navigation refuses; `refresh` will try again once it lands.
    }
  }

  private read(): ImagesDocument {
    if (this.images !== null) return this.images
    let raw: unknown
    try {
      raw = this.backend.get(OVERLAY_IMAGES_KEY)
    } catch (error) {
      console.error('overlay: failed to read the image store', error)
      raw = undefined
    }
    const images: ImagesDocument = {}
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [id, entry] of Object.entries(raw)) {
        if (IMAGE_ID_RE.test(id) && isStoredImage(entry)) images[id] = entry
      }
    }
    this.images = images
    return images
  }

  private write(images: ImagesDocument): void {
    this.images = images
    try {
      this.backend.set(OVERLAY_IMAGES_KEY, images)
    } catch (error) {
      console.error('overlay: failed to write the image store', error)
    }
  }

  /** Drop the least recently used images until the store fits, keeping `keep`. */
  private evict(images: ImagesDocument, keep: string): void {
    let total = Object.values(images).reduce((sum, image) => sum + image.bytes, 0)
    if (total <= this.maxStoreBytes) return
    const oldestFirst = Object.entries(images)
      .filter(([id]) => id !== keep)
      .sort((a, b) => a[1].usedAt - b[1].usedAt)
    for (const [id, image] of oldestFirst) {
      if (total <= this.maxStoreBytes) break
      delete images[id]
      total -= image.bytes
    }
  }
}
