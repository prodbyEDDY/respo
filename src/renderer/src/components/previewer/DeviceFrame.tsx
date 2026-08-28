import { useEffect, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon,
  ArrowsUpDownIcon,
  CameraIcon,
  ChevronDownIcon,
  ClipboardIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  LinkSlashIcon,
  ViewfinderCircleIcon
} from '@heroicons/react/24/outline'
import { isRotatable } from '@shared/custom-devices'
import type { LoadStatePayload } from '@shared/ipc'
import type { DeviceSpec } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useLayout } from '@renderer/stores/layout'
import { useNavigation } from '@renderer/stores/navigation'
import { selectIsOpen, usePanels } from '@renderer/stores/panels'
import { selectIsBusy, useShots } from '@renderer/stores/shots'
import { useSync } from '@renderer/stores/sync'

export type DeviceFrameProps = {
  device: DeviceSpec
  /** Canvas zoom. The placeholder shrinks; main restores the logical viewport. */
  zoom: number
  /** Attaches the element main measures and glues the `WebContentsView` to. */
  viewportRef: (element: HTMLElement | null) => void
}

/** A ring, not a GIF: `animate-spin` is a transform, so it stays on the GPU. */
function Spinner(): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="size-3 animate-spin rounded-full border-2 border-status-loading border-t-transparent"
    />
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * What the user sees instead of Chromium's own error page.
 *
 * This only becomes visible because main hides a view whose main frame failed:
 * a `WebContentsView` composites above the entire window, so nothing the
 * renderer draws can ever sit on top of a live one.
 */
function LoadError({ state }: { state: LoadStatePayload }): React.JSX.Element {
  const reload = useNavigation((s) => s.reload)

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
      <ExclamationTriangleIcon aria-hidden="true" className="size-6 text-status-error" />
      <p className="text-caption font-medium text-foreground">
        Couldn&apos;t load {hostOf(state.url)}
      </p>
      <p className="max-w-full truncate text-micro text-muted-foreground">
        {state.errorDesc ?? 'The page failed to load'}
        {state.errorCode === undefined ? '' : ` (${state.errorCode})`}
      </p>
      <Button variant="outline" size="sm" onClick={reload} className="mt-1">
        <ArrowPathIcon />
        Retry
      </Button>
    </div>
  )
}

/**
 * Take one device in or out of mirroring, from its own header.
 *
 * The switch is per-device and instant: main stops dispatching to a muted view
 * on the very next event, and stops listening to it as a source.
 */
function MirrorToggle({ deviceId }: { deviceId: string }): React.JSX.Element {
  const muted = useSync((s) => s.disabled[deviceId] === true)
  const toggleDevice = useSync((s) => s.toggleDevice)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          role="switch"
          aria-checked={!muted}
          aria-label="Mirror interactions on this device"
          data-mirroring={muted ? 'off' : 'on'}
          onClick={() => toggleDevice(deviceId)}
          className={cn(muted ? 'text-status-warn' : 'text-muted-foreground hover:text-foreground')}
        >
          {muted ? <LinkSlashIcon /> : <LinkIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {muted ? 'Not mirroring — click to include this device' : 'Mirroring — click to exclude'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Turn one device on its side, from its own header.
 *
 * Only rendered for a device that has a side to be turned on: a desktop monitor
 * has one orientation, and a control that would do nothing is worse than no
 * control. The store swaps the spec's width and height, which is what makes
 * main re-run the CDP emulation for this view alone.
 */
function RotateToggle({ deviceId }: { deviceId: string }): React.JSX.Element {
  const landscape = useLayout((s) => s.rotated[deviceId] === true)
  const rotate = useLayout((s) => s.rotate)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Rotate this device"
          aria-pressed={landscape}
          data-orientation={landscape ? 'landscape' : 'portrait'}
          onClick={() => rotate(deviceId)}
          className={cn(landscape ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
        >
          <ArrowPathRoundedSquareIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{landscape ? 'Back to portrait' : 'Rotate to landscape'}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Open this device's own DevTools, from its own header.
 *
 * Per device, not per app: Respo has as many pages open as there are frames,
 * and "the" DevTools would have to mean one of them. A second click closes it
 * again, so the control says what state it is in and how to leave it.
 */
function DevtoolsToggle({ deviceId }: { deviceId: string }): React.JSX.Element {
  const open = usePanels((s) => selectIsOpen(s, deviceId))
  const toggle = usePanels((s) => s.toggle)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Open DevTools for this device"
          aria-pressed={open}
          data-devtools={open ? 'open' : 'closed'}
          onClick={() => toggle(deviceId)}
          className={cn(open ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
        >
          <CodeBracketIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{open ? 'Close DevTools' : 'Open DevTools'}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Screenshot this device, from its own header.
 *
 * One click is the whole gesture: the viewport, saved. Everything else is one
 * level down — alt+click, or the split arrow — because "a picture of this
 * frame" is what people come here for and a menu in front of it would charge
 * every screenshot for the two that are not the common one.
 */
function ShotButton({ deviceId }: { deviceId: string }): React.JSX.Element {
  const busy = useShots((s) => selectIsBusy(s, deviceId))
  const capture = useShots((s) => s.capture)
  const copy = useShots((s) => s.copy)

  return (
    <span className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Screenshot this device"
            data-shooting={busy ? 'true' : undefined}
            disabled={busy}
            // Alt is the modifier a browser's own "capture full size" hides
            // behind, and the menu says so out loud for anyone who never
            // learned it.
            onClick={(event) => capture(deviceId, { fullPage: event.altKey })}
            className="text-muted-foreground hover:text-foreground disabled:opacity-100"
          >
            {busy ? <Spinner /> : <CameraIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Screenshot — hold Alt for the full page</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Screenshot options"
            className="-ml-1.5 w-3 text-muted-foreground hover:text-foreground"
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => capture(deviceId, { fullPage: false })}>
            <ViewfinderCircleIcon />
            Visible area
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => capture(deviceId, { fullPage: true })}>
            <ArrowsUpDownIcon />
            Full page
            <DropdownMenuShortcut>Alt</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(deviceId)}>
            <ClipboardIcon />
            Copy to clipboard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/**
 * The shutter: one flash of the frame when a picture of it lands.
 *
 * Opacity only, 150ms (DESIGN-SYSTEM.md motion budget), and drawn *outside* the
 * viewport element for the same reason the lead ring is — the page is a native
 * view composited over that box, so anything painted inside it is invisible.
 *
 * Driven by a counter rather than a flag: two screenshots in a row are two
 * flashes, and a boolean that is already `true` would show only the first.
 */
function useShutter(deviceId: string): boolean {
  const token = useShots((s) => s.flash[deviceId] ?? 0)
  // What this frame has already flashed for. Seeded with the current count, so
  // a frame that mounts onto a device with a history does not flash for it.
  const [acknowledged, setAcknowledged] = useState(token)
  // Derived during render rather than set from the effect: the flash *is* the
  // difference between the two numbers, and an effect that assigns it would
  // render the frame twice to say the same thing.
  const flashing = token !== acknowledged

  useEffect(() => {
    if (!flashing) return
    const timer = setTimeout(() => setAcknowledged(token), 150)
    return () => {
      clearTimeout(timer)
    }
  }, [flashing, token])

  return flashing
}

/**
 * Chrome around one device: a caption, and an empty rectangle standing in for
 * the page.
 *
 * Nothing is ever painted inside that rectangle while the page is live. The
 * real page is a `WebContentsView` composited on top of the whole window by
 * main, positioned to exactly this element's box — so anything drawn here would
 * be hidden, and anything drawn *around* here must stay outside it. The one
 * exception is the failure card above, which main makes room for by hiding the
 * view that failed.
 */
export function DeviceFrame({ device, zoom, viewportRef }: DeviceFrameProps): React.JSX.Element {
  const load = useNavigation((s) => s.perDevice[device.id])
  // A muted device drives nothing, so it never wears the lead ring — including
  // the moment it is muted while the pointer is still resting on it.
  const isLead = useSync((s) => s.leadDeviceId === device.id && s.disabled[device.id] !== true)
  const setLead = useSync((s) => s.setLead)
  const flashing = useShutter(device.id)
  const width = Math.round(device.width * zoom)
  const height = Math.round(device.height * zoom)

  return (
    <section
      className="relative flex flex-col gap-1"
      aria-label={device.name}
      data-lead={isLead ? 'true' : undefined}
      // Pointing at a device is what elects it: no click, no mode, no third
      // control to learn. The store coalesces this to one message per frame,
      // so sweeping the pointer across the canvas costs one round trip.
      onMouseEnter={() => setLead(device.id)}
    >
      {/*
        The lead marker.

        It lives 4px outside the section rather than on the viewport itself:
        main glues the `WebContentsView` to that element's border box, so a
        border or ring drawn there would be composited over and never seen.
        Opacity only, 150ms (DESIGN-SYSTEM.md motion budget).
      */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -inset-1 rounded-lg border border-primary',
          'transition-opacity duration-150 ease-out',
          isLead ? 'opacity-100' : 'opacity-0'
        )}
      />

      {/*
        The shutter. Outside the frame like the lead ring, and for the same
        reason: the page is a native view composited over that rectangle, so a
        flash drawn inside it would never be seen.
      */}
      <span
        aria-hidden="true"
        data-shutter={flashing ? 'on' : 'off'}
        className={cn(
          'pointer-events-none absolute -inset-1 rounded-lg border-2 border-primary bg-primary/10',
          'transition-opacity duration-150 ease-out',
          flashing ? 'opacity-100' : 'opacity-0'
        )}
      />

      <header className="flex items-center gap-2 px-0.5">
        <h2 className="text-caption font-medium text-foreground">{device.name}</h2>
        <p className="text-micro tabular-nums text-muted-foreground">
          {device.width} × {device.height}
          {zoom === 1 ? '' : ` · ${Math.round(zoom * 100)}%`}
        </p>
        {load?.state === 'loading' ? <Spinner /> : null}
        {/*
          Next to the caption rather than pushed to the far edge: a 1920px
          frame would put a right-aligned control most of a screen away from
          the name it belongs to.
        */}
        <MirrorToggle deviceId={device.id} />
        {isRotatable(device) ? <RotateToggle deviceId={device.id} /> : null}
        <ShotButton deviceId={device.id} />
        <DevtoolsToggle deviceId={device.id} />
      </header>

      <div
        ref={viewportRef}
        data-device-id={device.id}
        data-load-state={load?.state ?? 'idle'}
        className="relative rounded-md border border-border bg-card shadow-hairline"
        style={{ width, height }}
      >
        {load?.state === 'failed' ? <LoadError state={load} /> : null}
      </div>
    </section>
  )
}
