import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useWatcher } from '@renderer/stores/watcher'

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/**
 * The live-reload dot, in the address bar, only while a local page is open.
 *
 * A pulse while watching, still while paused, absent otherwise: the page
 * reloading under someone's edits must never be a mystery, and the way to
 * stop it should be under the pointer. One click pauses, one resumes.
 */
export function WatcherIndicator(): React.JSX.Element | null {
  const state = useWatcher((s) => s.state)
  const file = useWatcher((s) => s.file)
  const toggle = useWatcher((s) => s.toggle)
  if (state === 'off' || file === null) return null

  const watching = state === 'watching'
  const label = watching
    ? 'Live reload on — click to pause'
    : 'Live reload paused — click to resume'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={watching}
          data-watcher={state}
          onClick={toggle}
          className="rounded-full"
        >
          <span
            aria-hidden="true"
            className={cn(
              'block size-2 rounded-full',
              // Opacity only, and none of it for people who asked for less motion.
              watching ? 'bg-status-ok motion-safe:animate-pulse' : 'bg-muted-foreground/60'
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {watching ? 'Live reload' : 'Live reload paused'}: {baseName(file)}
        {watching ? ' — click to pause' : ' — click to resume'}
      </TooltipContent>
    </Tooltip>
  )
}
