import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { selectChipVisible, useUpdates } from '@renderer/stores/updates'

/**
 * The whole update UI: one chip in the toolbar, there only while there is
 * something to say.
 *
 * Three clicks at most, and no dialog anywhere on the path: `Update to 0.1.1`
 * starts the download, the same chip shows the percentage, and `Restart to
 * update` quits, installs silently and relaunches. A download that failed is
 * the same chip again, in red, offering a retry — the reason is its tooltip,
 * not a modal.
 *
 * Mint, not blue: blue is for the things that are *on* (sync, the active
 * viewport), and this is a status — a good one — rather than a mode.
 */
export function UpdateChip(): React.JSX.Element | null {
  const status = useUpdates((s) => s.status)
  const visible = useUpdates(selectChipVisible)
  const download = useUpdates((s) => s.download)
  const install = useUpdates((s) => s.install)
  if (!visible) return null

  const { stage, version, percent, error } = status
  const failed = stage === 'error'
  const busy = stage === 'downloading'

  const label = failed
    ? 'Update failed — retry'
    : stage === 'downloaded'
      ? 'Restart to update'
      : busy
        ? `Updating… ${percent ?? 0}%`
        : `Update to ${version ?? ''}`

  const hint = failed
    ? (error ?? 'The download did not finish. Click to try again.')
    : stage === 'downloaded'
      ? `Respo ${version ?? ''} is ready. Restart to finish installing — it takes a few seconds.`
      : busy
        ? `Downloading Respo ${version ?? ''}`
        : `Respo ${version ?? ''} is available. Click to download; nothing changes until you restart.`

  const Icon = failed
    ? ExclamationCircleIcon
    : stage === 'available'
      ? ArrowDownTrayIcon
      : ArrowPathIcon

  const onClick = (): void => {
    if (stage === 'downloaded') install()
    else download()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          data-slot="update-chip"
          data-stage={stage}
          aria-label={label}
          aria-busy={busy}
          disabled={busy}
          onClick={onClick}
          className={cn(
            'rounded-full px-2 font-medium disabled:opacity-100',
            failed
              ? 'bg-status-error/10 text-status-error hover:bg-status-error/15 hover:text-status-error'
              : 'bg-status-ok/10 text-status-ok hover:bg-status-ok/15 hover:text-status-ok'
          )}
        >
          <Icon aria-hidden="true" className={cn(busy && 'motion-safe:animate-spin')} />
          <span className="tabular-nums">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
