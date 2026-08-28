import { XMarkIcon } from '@heroicons/react/24/outline'
import type { DeviceSpec } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useLayout } from '@renderer/stores/layout'

/**
 * Height of the strip in CSS pixels, mirrored from the classes below.
 *
 * The canvas subtracts it when it fits a device, so the expanded frame lands
 * *inside* what is left rather than under the tabs.
 */
export const TAB_STRIP_HEIGHT = 37

export type DeviceTabsProps = {
  devices: readonly DeviceSpec[]
  /** The device currently filling the canvas. */
  shownDeviceId: string
}

/**
 * The other devices, while one of them has the canvas.
 *
 * Tabs rather than a dropdown: the whole point of individual mode is comparing
 * one viewport at a time against the others, and a list you have to open first
 * turns each comparison into three clicks. The size rides along with the name
 * because that is what tells two phones apart at a glance.
 *
 * A real tablist: arrow keys move between tabs, which is the behaviour anyone
 * who has used a browser expects from a row of them.
 */
export function DeviceTabs({ devices, shownDeviceId }: DeviceTabsProps): React.JSX.Element {
  const showIndividual = useLayout((s) => s.showIndividual)
  const exitIndividual = useLayout((s) => s.exitIndividual)

  /** Left/right walk the strip and switch as they go, the way tabs do. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 || devices.length === 0) return
    event.preventDefault()

    const at = devices.findIndex((device) => device.id === shownDeviceId)
    const next = devices[(at + step + devices.length) % devices.length]
    if (next === undefined) return
    showIndividual(next.id)
    // The tab that takes the selection takes the focus with it: a roving
    // tabIndex that left the focus behind would strand the keyboard.
    event.currentTarget
      .querySelector<HTMLElement>(`[data-tab-device="${CSS.escape(next.id)}"]`)
      ?.focus()
  }

  return (
    <div className="flex h-[37px] shrink-0 items-center gap-1 border-b border-border bg-card px-2">
      <div
        role="tablist"
        aria-label="Devices"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {devices.map((device) => {
          const current = device.id === shownDeviceId
          return (
            <button
              key={device.id}
              type="button"
              role="tab"
              aria-selected={current}
              data-tab-device={device.id}
              tabIndex={current ? 0 : -1}
              onClick={() => showIndividual(device.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-caption',
                'transition-colors duration-150 ease-out',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                current
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <span className="font-medium">{device.name}</span>
              <span className="text-micro tabular-nums opacity-70">
                {device.width} × {device.height}
              </span>
            </button>
          )
        })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to all devices"
            onClick={exitIndividual}
          >
            <XMarkIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Back to all devices (Esc)</TooltipContent>
      </Tooltip>
    </div>
  )
}
