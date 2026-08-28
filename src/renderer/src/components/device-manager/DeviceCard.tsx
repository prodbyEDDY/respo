import {
  CheckCircleIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DeviceTabletIcon,
  PencilSquareIcon,
  TrashIcon
} from '@heroicons/react/24/outline'
import { deviceTypeOf, isRotatable } from '@shared/custom-devices'
import type { DeviceSpec, DeviceType } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

const TYPE_ICONS: Record<DeviceType, typeof DevicePhoneMobileIcon> = {
  phone: DevicePhoneMobileIcon,
  tablet: DeviceTabletIcon,
  desktop: ComputerDesktopIcon
}

export type DeviceCardProps = {
  device: DeviceSpec
  /** Whether the device is part of the suite the canvas is showing. */
  inSuite: boolean
  /** Edit/delete controls. Absent for catalog devices, which are read-only. */
  onEdit?: () => void
  onDelete?: () => void
}

function Tag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
      {children}
    </span>
  )
}

/**
 * One device, as a row in the manager.
 *
 * Everything that decides whether a page will look right here — the viewport,
 * the pixel ratio, whether it has a touch screen — is on the face of the card,
 * because the alternative is opening each one to find out.
 */
export function DeviceCard({
  device,
  inSuite,
  onEdit,
  onDelete
}: DeviceCardProps): React.JSX.Element {
  const type = deviceTypeOf(device)
  const Icon = TYPE_ICONS[type]
  const editable = onEdit !== undefined || onDelete !== undefined

  return (
    <li
      data-device-id={device.id}
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5',
        'shadow-hairline transition-colors duration-150 ease-out hover:border-primary/40'
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h4 className="truncate text-caption font-medium text-foreground">{device.name}</h4>
          {inSuite ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <CheckCircleIcon
                  aria-label="On the canvas"
                  className="size-3.5 shrink-0 text-primary"
                />
              </TooltipTrigger>
              <TooltipContent>On the canvas in the current suite</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-micro tabular-nums text-muted-foreground">
            {device.width} × {device.height}
          </span>
          <Tag>{device.dpr}×</Tag>
          {device.touch ? <Tag>touch</Tag> : null}
          {isRotatable(device) ? <Tag>rotates</Tag> : null}
        </div>
      </div>

      {editable ? (
        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit === undefined ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${device.name}`}
                  onClick={onEdit}
                >
                  <PencilSquareIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          )}
          {onDelete === undefined ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${device.name}`}
                  onClick={onDelete}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <TrashIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          )}
        </div>
      ) : null}
    </li>
  )
}
