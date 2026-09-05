import { useEffect, useRef } from 'react'
import { PhotoIcon, TrashIcon } from '@heroicons/react/24/outline'
import { MAX_OVERLAY_IMAGE_BYTES, type OverlayMode } from '@shared/ipc'
import { guidesKeyOf } from '@shared/persistence-types'
import type { DeviceSpec } from '@shared/types'
import { Segmented } from '@renderer/components/common/Segmented'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { Slider } from '@renderer/components/ui/slider'
import { useDesignOverlay } from '@renderer/stores/design-overlay'

const MODES: readonly { value: OverlayMode; label: string }[] = [
  { value: 'overlay', label: 'Overlay' },
  { value: 'side-by-side', label: 'Side by side' }
]

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The file picker, as a button. The `<input type="file">` is the browser's
 * own dialog: the renderer is handed a `File`, learns no path and writes
 * nothing — which is the whole of CLAUDE.md §7 for this feature.
 */
function ChooseImage({
  onPick,
  label
}: {
  onPick: (file: File) => void
  label: string
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        data-testid="overlay-file"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so picking the same file again is a change.
          event.target.value = ''
          if (file !== undefined) onPick(file)
        }}
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <PhotoIcon />
        {label}
      </Button>
    </>
  )
}

/**
 * Everything about one viewport size's design overlay.
 *
 * Opened from a device's menu, but about the *size*: a mockup exported at
 * 393px is the same mockup on every 393px frame. Every control writes
 * through as it moves — there is nothing here to try and then abandon, and
 * "Remove" is the undo.
 */
export function DesignOverlayDialog({
  device,
  open,
  onOpenChange
}: {
  device: DeviceSpec
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const key = guidesKeyOf(device.width, device.height)
  const overlay = useDesignOverlay((s) => s.overlays[key])
  const image = useDesignOverlay((s) =>
    overlay === undefined ? undefined : s.images[overlay.imageId]
  )
  const error = useDesignOverlay((s) => s.error)
  const chooseImage = useDesignOverlay((s) => s.chooseImage)
  const setOpacity = useDesignOverlay((s) => s.setOpacity)
  const setCurtain = useDesignOverlay((s) => s.setCurtain)
  const setMode = useDesignOverlay((s) => s.setMode)
  const setEnabled = useDesignOverlay((s) => s.setEnabled)
  const remove = useDesignOverlay((s) => s.remove)
  const loadImage = useDesignOverlay((s) => s.loadImage)

  // The thumbnail: fetched once main is asked for it, and only while open.
  useEffect(() => {
    if (open && overlay !== undefined) loadImage(overlay.imageId)
  }, [open, overlay, loadImage])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="overlay-dialog">
        <DialogHeader>
          <DialogTitle>Design overlay</DialogTitle>
          <DialogDescription>
            A mockup over the page, for every {device.width} × {device.height} frame.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {overlay === undefined ? (
            <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-4">
              <ChooseImage
                label="Choose an image…"
                onPick={(file) => void chooseImage(key, file)}
              />
              <p className="text-micro text-muted-foreground">
                PNG, JPEG, GIF or WebP up to {MAX_OVERLAY_IMAGE_BYTES / 1024 / 1024} MB. Export it
                at {device.width}px wide to line up with the page.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                  {image === undefined ? null : image === null ? (
                    <PhotoIcon className="size-6 text-muted-foreground" />
                  ) : (
                    <img
                      src={image.dataUrl}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-micro text-muted-foreground" data-testid="overlay-image-facts">
                    {image === null
                      ? 'This image is no longer available.'
                      : image === undefined
                        ? 'Loading…'
                        : `${image.width} × ${image.height} · ${formatBytes(image.bytes)}`}
                  </p>
                  <div className="flex items-center gap-2">
                    <ChooseImage label="Replace…" onPick={(file) => void chooseImage(key, file)} />
                    <Button variant="ghost" size="sm" onClick={() => remove(key)}>
                      <TrashIcon />
                      Remove
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="overlay-enabled"
                  checked={overlay.enabled}
                  onCheckedChange={(next) => setEnabled(key, next === true)}
                />
                <Label htmlFor="overlay-enabled" className="cursor-pointer">
                  Show
                </Label>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Mode</Label>
                <Segmented
                  label="Mode"
                  value={overlay.mode}
                  choices={MODES}
                  onChange={(mode) => setMode(key, mode)}
                />
              </div>

              {overlay.mode === 'overlay' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label className="justify-between">
                      Opacity
                      <span className="tabular-nums text-muted-foreground">
                        {Math.round(overlay.opacity * 100)}%
                      </span>
                    </Label>
                    <Slider
                      aria-label="Opacity"
                      value={[Math.round(overlay.opacity * 100)]}
                      onValueChange={([value]) => setOpacity(key, (value ?? 0) / 100)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="justify-between">
                      Curtain
                      <span className="tabular-nums text-muted-foreground">
                        {Math.round(overlay.curtain * 100)}%
                      </span>
                    </Label>
                    <Slider
                      aria-label="Curtain"
                      value={[Math.round(overlay.curtain * 100)]}
                      onValueChange={([value]) => setCurtain(key, (value ?? 0) / 100)}
                    />
                    <p className="text-micro text-muted-foreground">
                      Hides the mockup from the left, so the page shows through on that side.
                    </p>
                  </div>
                  <p className="text-micro text-muted-foreground">
                    A page whose Content Security Policy forbids <code>data:</code> images will not
                    show the overlay — use Side by side there.
                  </p>
                </>
              ) : (
                <p className="text-micro text-muted-foreground">
                  The mockup is shown beside the frame and scrolls with the page.
                </p>
              )}
            </>
          )}

          {error === null ? null : (
            <p role="alert" className="text-micro text-status-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
