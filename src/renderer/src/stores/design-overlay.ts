import { create } from 'zustand'
import {
  MAX_OVERLAY_IMAGE_BYTES,
  type OverlayImage,
  type OverlayMode,
  type RespoApi
} from '@shared/ipc'
import { clampUnit, type OverlaysDocument, type OverlaySettings } from '@shared/persistence-types'
import { ipcBridge } from '@renderer/lib/ipc'
import { savePersistedState } from '@renderer/lib/persistence'

/**
 * The renderer's half of design overlays: the settings per viewport size,
 * and the images those settings point at, as far as the UI needs them.
 *
 * Main keeps the images and paints the overlay mode into the page; the
 * renderer paints the side-by-side panel itself and owns the settings
 * document. A slider drag is written on a debounce — the setting is one
 * number moving, not a hundred documents.
 */
export interface DesignOverlayState {
  overlays: OverlaysDocument
  /** Images fetched from main, by id — the dialog's thumbnail and the side panel. */
  images: Record<string, OverlayImage | null>
  /** The device whose dialog is open, or `null`. */
  dialogDeviceId: string | null
  /** What the last attempt to store an image said, for the dialog. */
  error: string | null

  openDialog: (deviceId: string) => void
  closeDialog: () => void
  /**
   * Read a file the user picked and keep it as this size's image.
   *
   * The file comes from an `<input type="file">`: the renderer learns no path
   * and writes nothing, it reads what it was handed and sends the bytes once.
   */
  chooseImage: (key: string, file: File) => Promise<void>
  setOpacity: (key: string, opacity: number) => void
  setCurtain: (key: string, curtain: number) => void
  setMode: (key: string, mode: OverlayMode) => void
  setEnabled: (key: string, enabled: boolean) => void
  remove: (key: string) => void
  /** Fetch an image main has, once. Idempotent; `null` is remembered too. */
  loadImage: (id: string) => void
  /** Install what main restored at boot. Writes nothing back. */
  hydrate: (overlays: OverlaysDocument) => void
}

/** How long after the last slider move the document is written. */
export const OVERLAY_SAVE_DEBOUNCE_MS = 250

function withBridge<T>(run: (bridge: RespoApi) => Promise<T>, then?: (answer: T) => void): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void run(bridge).then(then, (error: unknown) => {
    console.error('overlay ipc failed', error)
  })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    savePersistedState({ designOverlays: useDesignOverlay.getState().overlays })
  }, OVERLAY_SAVE_DEBOUNCE_MS)
  ;(saveTimer as { unref?: () => void }).unref?.()
}

/** Read a file as a data url. Rejects the way `FileReader` does. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

const loading = new Set<string>()

export const useDesignOverlay = create<DesignOverlayState>((set, get) => ({
  overlays: {},
  images: {},
  dialogDeviceId: null,
  error: null,

  openDialog: (deviceId) => set({ dialogDeviceId: deviceId, error: null }),
  closeDialog: () => set({ dialogDeviceId: null, error: null }),

  chooseImage: async (key, file) => {
    set({ error: null })
    // Said here, before a single byte is read: the cap is the one thing a
    // person can check on their own, and a 40 MB PNG should not be read
    // into memory to be told no.
    if (file.size > MAX_OVERLAY_IMAGE_BYTES) {
      set({ error: `Images up to ${MAX_OVERLAY_IMAGE_BYTES / 1024 / 1024} MB, please.` })
      return
    }
    const bridge = ipcBridge()
    if (bridge === null) return

    let dataUrl: string
    try {
      dataUrl = await readAsDataUrl(file)
    } catch {
      set({ error: 'That file could not be read.' })
      return
    }
    if (!/^data:image\/(?:png|jpeg);base64,/.test(dataUrl)) {
      set({ error: 'PNG or JPEG, please.' })
      return
    }

    try {
      const result = await bridge.invoke('overlay:store-image', dataUrl)
      if (!result.ok) {
        set({ error: result.message })
        return
      }
      const previous = get().overlays[key]
      const next: OverlaySettings = {
        imageId: result.image.id,
        mode: previous?.mode ?? 'overlay',
        opacity: previous?.opacity ?? 0.5,
        curtain: 0,
        enabled: true
      }
      set({
        overlays: { ...get().overlays, [key]: next },
        images: { ...get().images, [result.image.id]: { ...result.image, dataUrl } }
      })
      scheduleSave()
    } catch (error) {
      console.error('overlay:store-image failed', error)
      set({ error: 'The image could not be stored.' })
    }
  },

  setOpacity: (key, opacity) => {
    const current = get().overlays[key]
    if (current === undefined) return
    const next = clampUnit(opacity, current.opacity)
    if (next === current.opacity) return
    set({ overlays: { ...get().overlays, [key]: { ...current, opacity: next } } })
    scheduleSave()
  },

  setCurtain: (key, curtain) => {
    const current = get().overlays[key]
    if (current === undefined) return
    const next = clampUnit(curtain, current.curtain)
    if (next === current.curtain) return
    set({ overlays: { ...get().overlays, [key]: { ...current, curtain: next } } })
    scheduleSave()
  },

  setMode: (key, mode) => {
    const current = get().overlays[key]
    if (current === undefined || current.mode === mode) return
    set({ overlays: { ...get().overlays, [key]: { ...current, mode } } })
    scheduleSave()
  },

  setEnabled: (key, enabled) => {
    const current = get().overlays[key]
    if (current === undefined || current.enabled === enabled) return
    set({ overlays: { ...get().overlays, [key]: { ...current, enabled } } })
    scheduleSave()
  },

  remove: (key) => {
    if (get().overlays[key] === undefined) return
    const overlays = { ...get().overlays }
    delete overlays[key]
    set({ overlays })
    scheduleSave()
  },

  loadImage: (id) => {
    if (get().images[id] !== undefined || loading.has(id)) return
    loading.add(id)
    withBridge(
      (bridge) => bridge.invoke('overlay:image', id),
      (image) => {
        loading.delete(id)
        set({ images: { ...get().images, [id]: image } })
      }
    )
  },

  hydrate: (overlays) => {
    set({ overlays })
  }
}))

/** Test seam: drop a pending write so suites do not leak into each other. */
export function __flushOverlaySaveForTests(): void {
  loading.clear()
  if (saveTimer === null) return
  clearTimeout(saveTimer)
  saveTimer = null
  savePersistedState({ designOverlays: useDesignOverlay.getState().overlays })
}
