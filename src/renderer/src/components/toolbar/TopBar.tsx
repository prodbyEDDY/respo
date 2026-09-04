import { useMemo, useState } from 'react'
import {
  ArrowPathRoundedSquareIcon,
  ArrowsPointingOutIcon,
  ArrowTopRightOnSquareIcon,
  Bars2Icon,
  ClockIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  CursorArrowRaysIcon,
  DocumentArrowUpIcon,
  EllipsisVerticalIcon,
  HomeIcon,
  LinkIcon,
  LinkSlashIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MoonIcon,
  PlusIcon,
  RectangleGroupIcon,
  Square2StackIcon,
  SquaresPlusIcon,
  StarIcon,
  SunIcon,
  ViewColumnsIcon,
  WrenchScrewdriverIcon
} from '@heroicons/react/24/outline'
import type { DockPosition } from '@shared/ipc'
import type { CanvasLayoutMode } from '@shared/persistence-types'
import { SuiteSelector } from '@renderer/components/device-manager/SuiteSelector'
import { SettingsDialog } from '@renderer/components/settings/SettingsDialog'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { openLocalFile } from '@renderer/lib/browsing'
import { cn } from '@renderer/lib/utils'
import { useBookmarks } from '@renderer/stores/bookmarks'
import { useDevices } from '@renderer/stores/devices'
import { useGuides } from '@renderer/stores/guides'
import { useHistory } from '@renderer/stores/history'
import { useLayout } from '@renderer/stores/layout'
import { useNavigation } from '@renderer/stores/navigation'
import { usePanels } from '@renderer/stores/panels'
import { useSettings } from '@renderer/stores/settings'
import { useSync } from '@renderer/stores/sync'
import { AddressBar } from './AddressBar'
import { ClearMenu } from './ClearMenu'
import { EmulateButton } from './EmulatePopover'
import { NavControls } from './NavControls'
import { Notice } from './Notice'
import { ShotAllButton, ShotNotice } from './ShotControls'

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
/**
 * How the canvas arranges the frames, as a radio group.
 *
 * Four mutually exclusive answers to one question, so they are radio items and
 * not four toggles: the menu says which one is on without the user having to
 * infer it from three that are off, and screen readers say the same thing. The
 * chord is on the group rather than on a row, because it steps through all four
 * rather than reaching any one of them.
 */
function LayoutModeItems(): React.JSX.Element {
  const mode = useLayout((s) => s.mode)
  const setMode = useLayout((s) => s.setMode)

  const item = (
    value: CanvasLayoutMode,
    label: string,
    icon: React.ReactNode
  ): React.JSX.Element => (
    <DropdownMenuRadioItem value={value}>
      {icon}
      {label}
    </DropdownMenuRadioItem>
  )

  return (
    <>
      <DropdownMenuLabel className="flex items-center">
        Layout
        <DropdownMenuShortcut>{'⇧'}Ctrl L</DropdownMenuShortcut>
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={mode}
        onValueChange={(next) => setMode(next as CanvasLayoutMode)}
      >
        {item('column', 'Column', <Bars2Icon />)}
        {item('flex', 'Flexible rows', <ViewColumnsIcon />)}
        {item('masonry', 'Masonry', <SquaresPlusIcon />)}
        {item('individual', 'One device', <Square2StackIcon />)}
      </DropdownMenuRadioGroup>
    </>
  )
}

/**
 * Where DevTools opens, as a menu.
 *
 * The dock's own header carries the same three choices, but it only exists
 * while something is docked — and a panel the user just moved into its own
 * window has no header to bring it back from. This is that way back, one level
 * off the main flow because it is a preference, not a step in any task.
 */
function DevtoolsDockItems(): React.JSX.Element {
  const dock = usePanels((s) => s.dock)
  const setDock = usePanels((s) => s.setDock)

  const item = (value: DockPosition, label: string, icon: React.ReactNode): React.JSX.Element => (
    <DropdownMenuItem
      onSelect={() => setDock(value)}
      className={cn(dock === value && 'text-primary')}
    >
      {icon}
      {label}
      {dock === value ? <DropdownMenuShortcut>on</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  )

  return (
    <>
      <DropdownMenuLabel>DevTools</DropdownMenuLabel>
      {item('bottom', 'Dock to bottom', <Bars2Icon />)}
      {item('right', 'Dock to right', <ViewColumnsIcon />)}
      {item('undocked', 'Separate window', <ArrowTopRightOnSquareIcon />)}
    </>
  )
}

/**
 * The element picker, as one toggle over the whole canvas.
 *
 * Deliberately not per device: the question people ask is "what is *this*",
 * pointing at whichever viewport shows the problem, and having to say which
 * device first would be a step that answers nothing. Clicking anything in any
 * device ends the mode and opens that device's DevTools on the element.
 */
function InspectToggle(): React.JSX.Element {
  const inspecting = usePanels((s) => s.inspecting)
  const toggle = usePanels((s) => s.toggleInspecting)
  const label = inspecting ? 'Stop inspecting (Esc)' : 'Inspect an element (Ctrl+I)'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={inspecting}
          data-inspecting={inspecting ? 'on' : 'off'}
          onClick={toggle}
          className={cn(inspecting && 'bg-primary/15 text-primary')}
        >
          <CursorArrowRaysIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * How many saved pages the menu is a way into.
 *
 * A shortlist, not the library: the star's popover is where a bookmark is
 * edited, and the address bar's suggestions are where one is *searched for*.
 * This is the "take me back to one of the few I use" path, and a menu that
 * scrolled would stop being that.
 */
const MENU_BOOKMARKS = 6

/**
 * The saved pages, as a way back to them.
 *
 * Newest first, which is the order the store keeps: the page saved five minutes
 * ago is the one this menu is usually opened for.
 */
function BookmarkItems(): React.JSX.Element {
  const items = useBookmarks((s) => s.items)
  const navigate = useNavigation((s) => s.navigate)
  // Derived through `useMemo`: a selector that sliced the list per call would
  // return a new array every time and re-render forever (React error #185).
  const shown = useMemo(() => items.slice(0, MENU_BOOKMARKS), [items])

  return (
    <>
      <DropdownMenuLabel>Bookmarks</DropdownMenuLabel>
      {shown.length === 0 ? (
        <DropdownMenuItem disabled>
          <StarIcon />
          Nothing saved yet
        </DropdownMenuItem>
      ) : (
        shown.map((bookmark) => (
          <DropdownMenuItem key={bookmark.id} onSelect={() => navigate(bookmark.url)}>
            <StarIcon />
            <span className="min-w-0 truncate">
              {bookmark.title === '' ? bookmark.url : bookmark.title}
            </span>
          </DropdownMenuItem>
        ))
      )}
    </>
  )
}

/**
 * The page-level actions that are not a button in the bar.
 *
 * Setting a home page is a decision made once; opening a local file is rare
 * enough that its chord is the whole fast path; clearing history is the kind of
 * thing that should take a deliberate trip through a menu.
 */
function PageItems(): React.JSX.Element {
  const url = useNavigation((s) => s.url)
  const homeUrl = useBookmarks((s) => s.homeUrl)
  const setHome = useBookmarks((s) => s.setHome)
  const isHome = homeUrl !== '' && homeUrl === url

  return (
    <>
      <DropdownMenuItem onSelect={() => void openLocalFile()}>
        <DocumentArrowUpIcon />
        Open file…
        <DropdownMenuShortcut>Ctrl O</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={url === '' && !isHome}
        onSelect={() => setHome(isHome ? '' : url)}
      >
        <HomeIcon />
        {isHome ? 'Clear home page' : 'Set this page as home'}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => useHistory.getState().clear()}>
        <ClockIcon />
        Clear history
      </DropdownMenuItem>
    </>
  )
}

/**
 * The switches that put something *on* every page at once — rulers, and the
 * debug layers the later tasks add. A submenu because they are used together
 * and rarely, and because "Debug" is a word people already know to look
 * under for exactly this kind of thing.
 */
function DebugItems(): React.JSX.Element {
  const active = useDevices((s) => s.active)
  const rulers = useGuides((s) => s.rulers)
  const setRulersAll = useGuides((s) => s.setRulersAll)
  const allRulers = active.length > 0 && active.every((device) => rulers[device.id] === true)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <WrenchScrewdriverIcon />
        Debug
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuCheckboxItem
          checked={allRulers}
          onCheckedChange={(checked) =>
            setRulersAll(
              active.map((device) => device.id),
              checked === true
            )
          }
        >
          Rulers on all devices
        </DropdownMenuCheckboxItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function OverflowMenu({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
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
        <BookmarkItems />
        <DropdownMenuSeparator />
        <PageItems />
        <DropdownMenuSeparator />
        <LayoutModeItems />
        <DropdownMenuSeparator />
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
        <DevtoolsDockItems />
        <DropdownMenuSeparator />
        <DebugItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <ComputerDesktopIcon />
          Use system theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          Radix returns focus to the trigger as the menu closes, and a dialog
          opened in the same tick would fight it for the focus. Deferring by one
          frame lets the menu finish leaving first.
        */}
        <DropdownMenuItem onSelect={() => requestAnimationFrame(onOpenSettings)}>
          <Cog6ToothIcon />
          Settings…
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
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
      <NavControls />
      <AddressBar />
      {/*
        Screenshot feedback lives here, not over the canvas: device pages are
        native views composited above anything the renderer paints, so a toast
        in the corner of the canvas would spend half its life behind a frame.
      */}
      <ShotNotice />
      {/* Everything else worth one line of feedback: a bookmark, a clear. */}
      <Notice />
      <div className="flex items-center gap-1">
        <ClearMenu />
        <SuiteSelector />
        <DeviceLibraryButton />
        <EmulateButton />
        <SyncChip />
        <InspectToggle />
        <ShotAllButton />
        <IconButton label="Rotate all devices" onClick={rotateAll}>
          <ArrowPathRoundedSquareIcon />
        </IconButton>
        <ThemeToggle />
        <OverflowMenu onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  )
}
