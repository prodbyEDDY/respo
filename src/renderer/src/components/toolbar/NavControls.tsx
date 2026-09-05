import { ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { selectCanGoBack, selectCanGoForward, useNavigation } from '@renderer/stores/navigation'

type ControlProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}

function Control({ label, onClick, disabled, children }: ControlProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/*
          The span keeps the tooltip reachable: a disabled button fires no
          pointer events, so the trigger has to sit around it rather than on it.
        */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled === true}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Back, forward, reload — for every device at once.
 *
 * There is no per-device history in Respo: one page is driven across many
 * viewports, so these three act on the whole canvas. Back and forward are live
 * while *any* device could take the step, which is exactly when the click does
 * something; each view's own history travels in the batched `load-state` event.
 */
export function NavControls(): React.JSX.Element {
  const back = useNavigation((s) => s.back)
  const forward = useNavigation((s) => s.forward)
  const reload = useNavigation((s) => s.reload)
  const canGoBack = useNavigation(selectCanGoBack)
  const canGoForward = useNavigation(selectCanGoForward)

  return (
    <div className="flex items-center gap-0.5">
      <Control label="Back" onClick={back} disabled={!canGoBack}>
        <ArrowLeftIcon />
      </Control>
      <Control label="Forward" onClick={forward} disabled={!canGoForward}>
        <ArrowRightIcon />
      </Control>
      <Control label="Reload" onClick={() => reload()}>
        <ArrowPathIcon />
      </Control>
    </div>
  )
}
