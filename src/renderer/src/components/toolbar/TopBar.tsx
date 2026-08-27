import {
  ArrowPathRoundedSquareIcon,
  ArrowsPointingOutIcon,
  ComputerDesktopIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MoonIcon,
  SunIcon
} from '@heroicons/react/24/outline'
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
import { useLayout } from '@renderer/stores/layout'
import { useSettings } from '@renderer/stores/settings'
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
      <div className="flex items-center gap-0.5">
        <IconButton label="Rotate all devices" onClick={rotateAll}>
          <ArrowPathRoundedSquareIcon />
        </IconButton>
        <ThemeToggle />
        <OverflowMenu />
      </div>
    </header>
  )
}
