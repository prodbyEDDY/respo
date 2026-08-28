import { useMemo } from 'react'
import {
  CameraIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  FolderOpenIcon
} from '@heroicons/react/24/outline'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { progressOf, useShots } from '@renderer/stores/shots'

/**
 * Screenshot every device on the canvas, in one click.
 *
 * The same gesture as a device's own camera, one level up: click for the
 * viewports, alt for the whole pages. While a batch runs the button counts it
 * down — the canvas cannot show progress itself, because the frames are native
 * views with nothing of ours drawn over them.
 */
export function ShotAllButton(): React.JSX.Element {
  const captureAll = useShots((s) => s.captureAll)
  // Subscribed to the *stored* value and derived here: a selector that built a
  // new object every call would never compare equal to itself, and zustand
  // would re-render this button until React gave up (error #185).
  const batches = useShots((s) => s.batches)
  const progress = useMemo(() => progressOf(batches), [batches])
  const running = progress !== null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={running ? 'xs' : 'icon-sm'}
          aria-label="Screenshot every device"
          data-shooting={running ? 'true' : undefined}
          disabled={running}
          onClick={(event) => captureAll({ fullPage: event.altKey })}
          className={cn('tabular-nums', running && 'text-primary disabled:opacity-100')}
        >
          <CameraIcon />
          {running ? `${progress.done}/${progress.total}` : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Screenshot every device (Ctrl+S) — hold Alt for full pages</TooltipContent>
    </Tooltip>
  )
}

/**
 * What the last screenshot gesture did, in one line.
 *
 * It lives in the toolbar rather than floating over the canvas, and that is not
 * a style choice: device pages are native views composited above everything the
 * renderer paints, so a toast in the corner of the canvas would be behind a
 * device frame as often as not. The toolbar is ours.
 */
export function ShotNotice(): React.JSX.Element | null {
  const notice = useShots((s) => s.notice)
  const reveal = useShots((s) => s.reveal)
  const dismiss = useShots((s) => s.dismiss)

  if (notice === null) return null
  const failed = notice.tone === 'error'
  const Icon = failed ? ExclamationCircleIcon : CheckCircleIcon

  return (
    <div
      role="status"
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1',
        'text-micro',
        failed ? 'text-status-error' : 'text-muted-foreground'
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="max-w-[22ch] truncate" title={notice.path ?? notice.text}>
        {notice.text}
      </span>
      {notice.path === undefined ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Show in folder"
              onClick={() => {
                reveal(notice.path as string)
                dismiss(notice.id)
              }}
            >
              <FolderOpenIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show in folder</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
