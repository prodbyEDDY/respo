import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { cn } from '@renderer/lib/utils'
import { useNotices } from '@renderer/stores/notices'

/**
 * What just happened, in one line.
 *
 * Sits in the toolbar beside the screenshot notice for the same reason that one
 * does: device pages are native views composited above anything the renderer
 * paints, so a toast over the canvas would spend half its life behind a frame.
 *
 * It takes itself away — nothing here has to be dismissed to keep working — and
 * renders nothing at all when there is nothing to say, so it costs no space in
 * the toolbar the rest of the time.
 */
export function Notice(): React.JSX.Element | null {
  const notice = useNotices((s) => s.notice)
  if (notice === null) return null

  const failed = notice.tone === 'error'
  const Icon = failed ? ExclamationCircleIcon : CheckCircleIcon

  return (
    <div
      role="status"
      data-tone={notice.tone}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1',
        'text-micro',
        // Motion budget: opacity/transform only, 150ms (DESIGN-SYSTEM.md).
        'duration-150 ease-out animate-in fade-in-0 zoom-in-95',
        failed ? 'text-status-error' : 'text-muted-foreground'
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="max-w-[32ch] truncate" title={notice.text}>
        {notice.text}
      </span>
    </div>
  )
}
