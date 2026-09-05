import { useRef, useState } from 'react'
import {
  Cog6ToothIcon,
  CursorArrowRaysIcon,
  LinkIcon,
  LinkSlashIcon,
  PlusIcon,
  RectangleGroupIcon
} from '@heroicons/react/24/outline'
import { SuiteSelector } from '@renderer/components/device-manager/SuiteSelector'
import { SettingsDialog } from '@renderer/components/settings/SettingsDialog'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useLayout } from '@renderer/stores/layout'
import { usePanels } from '@renderer/stores/panels'
import { useSync } from '@renderer/stores/sync'
import { useEmulation, selectEmulationActive } from '@renderer/stores/emulation'
import { AddressBar } from './AddressBar'
import { NavControls } from './NavControls'
import { Notice } from './Notice'
import { ShotAllButton, ShotNotice } from './ShotControls'
import { UpdateChip } from './UpdateChip'
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

export function TopBar(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const emulating = useEmulation(selectEmulationActive)
  return (
    <header className="app-toolbar flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
      <NavControls />
      <AddressBar />
      <ShotNotice />
      <Notice />
      <UpdateChip />
      <div className="flex shrink-0 items-center gap-1">
        <SuiteSelector />
        <DeviceLibraryButton />
        <SyncChip />
        <InspectToggle />
        <ShotAllButton />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              ref={settingsTrigger}
              onClick={() => setSettingsOpen(true)}
              className="relative"
              data-emulating={emulating ? 'on' : 'off'}
            >
              <Cog6ToothIcon />
              {emulating && (
                <span
                  aria-hidden="true"
                  data-slot="emulate-badge"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{emulating ? 'Settings · Emulation active' : 'Settings'}</TooltipContent>
        </Tooltip>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        triggerRef={settingsTrigger}
      />
    </header>
  )
}
