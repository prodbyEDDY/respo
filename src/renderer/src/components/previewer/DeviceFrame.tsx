import { useEffect, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon,
  ArrowsPointingOutIcon,
  ArrowsUpDownIcon,
  ArrowUpIcon,
  CameraIcon,
  ChevronDownIcon,
  ClipboardIcon,
  CodeBracketIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  FaceFrownIcon,
  LinkIcon,
  LinkSlashIcon,
  ViewfinderCircleIcon
} from '@heroicons/react/24/outline'
import { isRotatable } from '@shared/custom-devices'
import { VISION_DEFICIENCIES, VISION_LABELS, type VisionDeficiency } from '@shared/emulation'
import type { LoadStatePayload } from '@shared/ipc'
import type { DeviceSpec } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useEmulation } from '@renderer/stores/emulation'
import { useLayout } from '@renderer/stores/layout'
import { useNavigation } from '@renderer/stores/navigation'
import { useNotices } from '@renderer/stores/notices'
import { selectIsOpen, usePanels } from '@renderer/stores/panels'
import { selectIsBusy, useShots } from '@renderer/stores/shots'
import { useSync } from '@renderer/stores/sync'
import { DiagnosticsChips } from './DiagnosticsChips'

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
function LoadError({
  deviceId,
  state
}: {
  deviceId: string
  state: LoadStatePayload
}): React.JSX.Element {
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
      {/* This device only: the others may well be showing the page. */}
      <Button variant="outline" size="sm" onClick={() => reload({ deviceId })} className="mt-1">
        <ArrowPathIcon />
        Retry
      </Button>
    </div>
  )
}

/**
 * What the user sees when a device's renderer process died (spec §7).
 *
 * Its own card rather than the load-error one: the words are different ("the
 * page crashed", not "could not load"), the button is different (a restart of
 * *this* process, not a reload of every device), and the other frames are
 * alive and untouched — which is the whole point of one process per view.
 */
function PageCrashed({
  deviceId,
  state
}: {
  deviceId: string
  state: LoadStatePayload
}): React.JSX.Element {
  const restart = useNavigation((s) => s.restart)

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
      <FaceFrownIcon aria-hidden="true" className="size-6 text-status-error" />
      <p className="text-caption font-medium text-foreground">This page crashed</p>
      <p className="max-w-full truncate text-micro text-muted-foreground">
        The renderer process {state.errorDesc === undefined ? 'went away' : state.errorDesc}. The
        other devices are not affected.
      </p>
      <Button variant="outline" size="sm" onClick={() => restart(deviceId)} className="mt-1">
        <ArrowPathIcon />
        Restart
      </Button>
    </div>
  )
}

/** The radio value that means "no override": the profile decides. */
const INHERIT = 'inherit'

/**
 * The vision simulation for one device: the profile's, or its own.
 *
 * A submenu of radio items rather than a toggle, because the question has
 * eight answers and "inherit" is one of them — it is what makes a device that
 * was set apart go back to matching the others, and it is where the current
 * global choice is shown so nobody has to open the toolbar popover to learn
 * what "inherit" would mean.
 */
function VisionItems({ deviceId }: { deviceId: string }): React.JSX.Element {
  const override = useEmulation((s) => s.deviceVision[deviceId])
  const global = useEmulation((s) => s.profile.vision)
  const setDeviceVision = useEmulation((s) => s.setDeviceVision)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <EyeIcon />
        Vision
        {override === undefined ? null : (
          <DropdownMenuShortcut className="mr-1">{VISION_LABELS[override]}</DropdownMenuShortcut>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={override ?? INHERIT}
          onValueChange={(value) =>
            setDeviceVision(deviceId, value === INHERIT ? null : (value as VisionDeficiency))
          }
        >
          <DropdownMenuRadioItem value={INHERIT}>
            Inherit global
            <DropdownMenuShortcut>{VISION_LABELS[global]}</DropdownMenuShortcut>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {VISION_DEFICIENCIES.map((type) => (
            <DropdownMenuRadioItem key={type} value={type}>
              {VISION_LABELS[type]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * The one visible sign that this device sees the page differently from the
 * others: its own vision simulation, when it has one.
 *
 * Any active emulation must be visible where it applies (W5 UX rule) — a frame
 * that is quietly greyscale would be a mystery. Clicking it is the one-step
 * undo: back to the profile, like every other device.
 */
function VisionChip({ deviceId }: { deviceId: string }): React.JSX.Element | null {
  const override = useEmulation((s) => s.deviceVision[deviceId])
  const setDeviceVision = useEmulation((s) => s.setDeviceVision)
  if (override === undefined) return null

  const label = override === 'none' ? 'No vision filter' : VISION_LABELS[override]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Vision on this device: ${label}. Click to inherit the global setting`}
          data-vision-override={override}
          onClick={() => setDeviceVision(deviceId, null)}
          className="h-5 rounded-full bg-primary/10 px-1.5 text-primary hover:bg-primary/15 hover:text-primary"
        >
          <EyeIcon />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} on this device only — click to inherit the global setting
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Everything about one device that is not worth a button of its own.
 *
 * The header keeps the four things people do constantly — mirror, rotate,
 * shoot, DevTools — and this holds the rest: a reload of *this* device (the
 * toolbar's reloads them all), a cache-busting one, a jump to the top, the
 * vision simulation, the url for pasting somewhere. Rare gestures, one level
 * down, so the header stays the same width whatever a device can do.
 */
function DeviceMenu({ deviceId }: { deviceId: string }): React.JSX.Element {
  const reload = useNavigation((s) => s.reload)
  const scrollToTop = useNavigation((s) => s.scrollToTop)
  const url = useNavigation((s) => s.perDevice[deviceId]?.url ?? '')

  const copyUrl = (): void => {
    if (url === '') return
    navigator.clipboard.writeText(url).then(
      () => useNotices.getState().say('ok', 'URL copied'),
      () => useNotices.getState().say('error', 'Could not copy the URL')
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="More for this device"
          className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
        >
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => reload({ deviceId })}>
          <ArrowPathIcon />
          Reload
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => reload({ deviceId, ignoreCache: true })}>
          <ArrowPathIcon />
          Reload ignoring cache
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => scrollToTop(deviceId)}>
          <ArrowUpIcon />
          Scroll to top
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <VisionItems deviceId={deviceId} />
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={url === ''} onSelect={copyUrl}>
          <ClipboardIcon />
          Copy URL
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
 * Give this device the whole canvas, from its own header.
 *
 * The way *into* individual mode, and deliberately the only one that names a
 * device: the layout menu can switch to the mode, but "show me this one" is a
 * thought people have while looking at a particular frame, and walking up to a
 * menu to say which would be the long way round. Esc — or the strip's own
 * button — is the way back.
 */
function ExpandButton({ deviceId }: { deviceId: string }): React.JSX.Element {
  const enterIndividual = useLayout((s) => s.enterIndividual)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Show only this device"
          onClick={() => enterIndividual(deviceId)}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowsPointingOutIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Show only this device</TooltipContent>
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
  // Nothing to expand when this frame already has the canvas to itself.
  const expandable = useLayout((s) => s.mode !== 'individual')
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
        {/* What the page is complaining about, and what sets this device apart. */}
        <DiagnosticsChips deviceId={device.id} />
        <VisionChip deviceId={device.id} />
        {/*
          Next to the caption rather than pushed to the far edge: a 1920px
          frame would put a right-aligned control most of a screen away from
          the name it belongs to.
        */}
        <MirrorToggle deviceId={device.id} />
        {isRotatable(device) ? <RotateToggle deviceId={device.id} /> : null}
        <ShotButton deviceId={device.id} />
        <DevtoolsToggle deviceId={device.id} />
        {/*
          Last in the row: it changes what the *canvas* shows rather than
          anything about this device, so it reads as the way out of the row
          instead of one more device control.
        */}
        {expandable ? <ExpandButton deviceId={device.id} /> : null}
        <DeviceMenu deviceId={device.id} />
      </header>

      <div
        ref={viewportRef}
        data-device-id={device.id}
        data-load-state={load?.state ?? 'idle'}
        className="relative rounded-md border border-border bg-card shadow-hairline"
        style={{ width, height }}
      >
        {load?.state === 'failed' ? <LoadError deviceId={device.id} state={load} /> : null}
        {load?.state === 'crashed' ? <PageCrashed deviceId={device.id} state={load} /> : null}
      </div>
    </section>
  )
}
