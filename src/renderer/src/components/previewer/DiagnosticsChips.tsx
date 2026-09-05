import { useEffect, useState } from 'react'
import { ArrowsRightLeftIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import type { DiagnosticsPayload } from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useDiagnostics } from '@renderer/stores/diagnostics'
import { usePanels } from '@renderer/stores/panels'

/** A chip's shell: a pill in a status colour, only ever drawn when it has news. */
const CHIP =
  'h-5 gap-1 rounded-full px-1.5 text-micro font-medium [&_svg:not([class*=size-])]:size-3'

/**
 * `N errors` — the page threw, or wrote to `console.error`, since it last
 * navigated. One click opens this device's DevTools on the console, which is
 * where the answer is. The tooltip carries the last few lines so the common
 * case — "what was it?" — needs no click at all.
 */
function ErrorsChip({
  deviceId,
  state
}: {
  deviceId: string
  state: DiagnosticsPayload
}): React.JSX.Element {
  const open = usePanels((s) => s.open)
  const label = `${state.errors} ${state.errors === 1 ? 'error' : 'errors'}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`${label} on this device — open the console`}
          data-errors={state.errors}
          onClick={() => open(deviceId, 'console')}
          className={cn(
            CHIP,
            'bg-status-error/10 text-status-error hover:bg-status-error/15 hover:text-status-error'
          )}
        >
          <ExclamationCircleIcon />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <ul className="flex flex-col gap-0.5">
          {state.messages.slice(-5).map((message, index) => (
            <li key={index} className="truncate font-mono">
              {message.text}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-muted-foreground">Click to open the console</p>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * `overflow` — the document is wider than the viewport, and these are the
 * elements sticking out. Opening the chip lists them; pointing at one
 * outlines it in the page, and "Highlight all" outlines every one at once.
 * The outline is a CSS layer main inserts, so it scrolls with the page.
 */
function OverflowChip({
  deviceId,
  state
}: {
  deviceId: string
  state: DiagnosticsPayload
}): React.JSX.Element | null {
  const highlight = useDiagnostics((s) => s.highlight)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const report = state.overflow

  // Whatever is outlined goes away with the popover — and with the chip, when
  // the page navigates from under it: an outline nobody can see the reason
  // for is a page that "looks strange".
  const setOpenAndClear = (next: boolean): void => {
    setOpen(next)
    if (next) return
    setAll(false)
    highlight(deviceId, 'none')
  }
  useEffect(() => () => highlight(deviceId, 'none'), [deviceId, highlight])

  if (report === null || report.items.length === 0) return null
  const past = report.scrollWidth - report.clientWidth

  return (
    <Popover open={open} onOpenChange={setOpenAndClear}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Horizontal overflow: ${past}px past the viewport — show what sticks out`}
              data-overflow={past}
              className={cn(
                CHIP,
                'bg-status-warn/15 text-amber-700 hover:bg-status-warn/25 hover:text-amber-800 dark:text-status-warn dark:hover:text-status-warn'
              )}
            >
              <ArrowsRightLeftIcon />
              overflow
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          The page is {past}px wider than the viewport ({report.scrollWidth} of {report.clientWidth}
          px)
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 p-2" data-testid="overflow-popover">
        <div className="flex items-center justify-between px-1 pb-1">
          <p className="text-micro text-muted-foreground">
            {report.scrollWidth}px wide in a {report.clientWidth}px viewport
          </p>
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={all}
            onClick={() => {
              const next = !all
              setAll(next)
              highlight(deviceId, next ? 'all' : 'none')
            }}
            className={cn(all && 'bg-primary/10 text-primary')}
          >
            Highlight all
          </Button>
        </div>
        <ul
          className="flex flex-col"
          onMouseLeave={() => highlight(deviceId, all ? 'all' : 'none')}
        >
          {report.items.map((item, index) => (
            <li
              key={index}
              data-overflow-item={index}
              onMouseEnter={() => highlight(deviceId, index)}
              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-micro hover:bg-accent"
            >
              <code className="truncate font-mono text-foreground">{item.label}</code>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.width}px · +{item.right - report.clientWidth}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The status chips of one device header: nothing at all until the page has
 * something to say, then the two facts a responsive check wants first —
 * errors and sideways overflow — as one compact pill each.
 */
export function DiagnosticsChips({ deviceId }: { deviceId: string }): React.JSX.Element | null {
  const state = useDiagnostics((s) => s.perDevice[deviceId])
  if (state === undefined) return null
  const overflowing = state.overflow !== null && state.overflow.items.length > 0
  if (state.errors === 0 && !overflowing) return null

  return (
    <span className="flex items-center gap-1">
      {state.errors > 0 ? <ErrorsChip deviceId={deviceId} state={state} /> : null}
      {overflowing ? <OverflowChip deviceId={deviceId} state={state} /> : null}
    </span>
  )
}
