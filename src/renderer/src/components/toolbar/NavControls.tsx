import { ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useNavigation } from '@renderer/stores/navigation'

type ControlProps = {
  label: string
  onClick: () => void
  children: React.ReactNode
}

function Control({ label, onClick, children }: ControlProps): React.JSX.Element {
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
 * Back, forward, reload — for every device at once.
 *
 * There is no per-device history in Respo: one page is driven across many
 * viewports, so these three act on the whole canvas. Main no-ops a view with
 * nowhere to go, which is why the buttons stay enabled rather than guessing at
 * five separate history stacks.
 */
export function NavControls(): React.JSX.Element {
  const back = useNavigation((s) => s.back)
  const forward = useNavigation((s) => s.forward)
  const reload = useNavigation((s) => s.reload)

  return (
    <div className="flex items-center gap-0.5">
      <Control label="Back" onClick={back}>
        <ArrowLeftIcon />
      </Control>
      <Control label="Forward" onClick={forward}>
        <ArrowRightIcon />
      </Control>
      <Control label="Reload" onClick={reload}>
        <ArrowPathIcon />
      </Control>
    </div>
  )
}
