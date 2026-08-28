import {
  ArrowPathRoundedSquareIcon,
  ArrowsPointingOutIcon,
  ComputerDesktopIcon,
  EllipsisVerticalIcon,
  LinkIcon,
  LinkSlashIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MoonIcon,
  PlusIcon,
  RectangleGroupIcon,
  SunIcon
} from '@heroicons/react/24/outline'
import { SuiteSelector } from '@renderer/components/device-manager/SuiteSelector'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useLayout } from '@renderer/stores/layout'
import { useSettings } from '@renderer/stores/settings'
import { useSync } from '@renderer/stores/sync'
import { AddressBar } from './AddressBar'
import { NavControls } from './NavControls'

type IconButtonProps = {
  label: string
  onClick: () => void
  children: React.ReactNode
}

function IconButton({ label, onClick, children }: IconButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The way in and out of the device library.
 *
 * A plus, because the thing people come here to do is add a device; it turns
 * into a way back once the library has the window, so the trip is one click in
 * each direction.
 */
function DeviceLibraryButton(): React.JSX.Element {
  const view = useLayout((s) => s.view)
  const setView = useLayout((s) => s.setView)
  const open = view === 'devices'

  return (
    <IconButton
      label={open ? 'Back to the canvas' : 'Add or edit devices'}
      onClick={() => setView(open ? 'canvas' : 'devices')}
    >
      {open ? <RectangleGroupIcon /> : <PlusIcon />}
    </IconButton>
  )
}

/**
 * The master switch for interaction mirroring.
 *
 * A chip rather than another icon button: mirroring is the one thing Respo does
 * that a browser does not, its state matters at a glance, and the word carries
 * that where a bare icon would not. One click either way.
 */
function SyncChip(): React.JSX.Element {
  const enabled = useSync((s) => s.globalEnabled)
  const toggleGlobal = useSync((s) => s.toggleGlobal)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          role="switch"
          aria-checked={enabled}
          aria-label="Mirror interactions across devices"
          onClick={toggleGlobal}
          className={cn(
            'rounded-full px-2 tracking-wide uppercase',
            enabled
              ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
              : 'text-muted-foreground'
          )}
        >
          {enabled ? <LinkIcon /> : <LinkSlashIcon />}
          Sync
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {enabled
          ? 'Mirroring on — the device you point at drives the others'
          : 'Mirroring off — each device scrolls on its own'}
      </TooltipContent>
    </Tooltip>
  )
}

/** Light/dark in one click. `system` stays reachable from the overflow menu. */
function ThemeToggle(): React.JSX.Element {
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  const setTheme = useSettings((s) => s.setTheme)

  const dark = resolvedTheme === 'dark'
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <IconButton label={label} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  )
}

/**
 * Everything that is one level away from the main flow. Zoom lives here rather
 * than as three more buttons in the bar: ctrl+wheel on the canvas is the
 * gesture people actually use.
 */
function OverflowMenu(): React.JSX.Element {
  const zoom = useLayout((s) => s.zoom)
  const zoomIn = useLayout((s) => s.zoomIn)
  const zoomOut = useLayout((s) => s.zoomOut)
  const resetZoom = useLayout((s) => s.resetZoom)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More options">
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Canvas zoom</DropdownMenuLabel>
        <DropdownMenuItem onSelect={zoomIn}>
          <MagnifyingGlassPlusIcon />
          Zoom in
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={zoomOut}>
          <MagnifyingGlassMinusIcon />
          Zoom out
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={resetZoom}>
          <ArrowsPointingOutIcon />
          Reset zoom
          <DropdownMenuShortcut>{Math.round(zoom * 100)}%</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <ComputerDesktopIcon />
          Use system theme
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The window's single toolbar: history on the left, the address in the middle,
 * and the view controls on the right.
 *
 * Fixed 48px so the canvas geometry below it is stable — the device views are
 * native surfaces positioned against it, and a toolbar that changes height
 * would move every one of them.
 */
export function TopBar(): React.JSX.Element {
  const rotateAll = useLayout((s) => s.rotateAll)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
      <NavControls />
      <AddressBar />
      <div className="flex items-center gap-1">
        <SuiteSelector />
        <DeviceLibraryButton />
        <SyncChip />
        <IconButton label="Rotate all devices" onClick={rotateAll}>
          <ArrowPathRoundedSquareIcon />
        </IconButton>
        <ThemeToggle />
        <OverflowMenu />
      </div>
    </header>
  )
}
