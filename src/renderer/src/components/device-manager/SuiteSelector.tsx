import { CheckIcon, RectangleStackIcon, Squares2X2Icon } from '@heroicons/react/24/outline'
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
import { useDevices } from '@renderer/stores/devices'
import { useLayout } from '@renderer/stores/layout'

/**
 * Which set of devices the canvas is showing, and the way to another one.
 *
 * In the toolbar rather than in the library, because switching suites is a
 * thing you do *while looking at the canvas* — a whole different set of
 * viewports is one click away, and the name of the current one is on screen the
 * rest of the time so you always know what you are looking at.
 */
export function SuiteSelector(): React.JSX.Element {
  const suites = useDevices((s) => s.suites)
  const activeSuiteId = useDevices((s) => s.activeSuiteId)
  const setView = useLayout((s) => s.setView)

  const activeSuite = suites.find((s) => s.id === activeSuiteId)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label="Device suite"
              data-testid="suite-selector"
              className="max-w-40 gap-1.5 rounded-full px-2.5 text-muted-foreground"
            >
              <RectangleStackIcon />
              <span className="truncate">{activeSuite?.name ?? 'No suite'}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>The set of devices on the canvas</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Suites</DropdownMenuLabel>
        {suites.map((suite) => {
          const current = suite.id === activeSuiteId
          return (
            <DropdownMenuItem
              key={suite.id}
              onSelect={() => useDevices.getState().setActiveSuite(suite.id)}
              className={cn(current && 'text-primary focus:text-primary')}
            >
              {/* A fixed slot for the mark, so the names line up either way. */}
              <span className="grid size-4 place-items-center">
                {current ? <CheckIcon className="size-4" /> : null}
              </span>
              <span className="truncate">{suite.name}</span>
              <DropdownMenuShortcut className="tabular-nums">
                {suite.deviceIds.length}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setView('devices')}>
          <Squares2X2Icon />
          Manage…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
