import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { serializeBackup } from '@shared/backup'
import type { DeviceSpec } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { exportBackupFile, importBackupFile } from '@renderer/lib/persistence'
import { cn } from '@renderer/lib/utils'
import {
  MAX_SUITE_NAME_LENGTH,
  useDevices,
  type SuiteMutationError
} from '@renderer/stores/devices'

/** How long a one-line answer stays on screen before it stops being news. */
const NOTICE_MS = 5000

type Notice = { tone: 'ok' | 'error'; text: string }

/** Plain English for every way the store can say no. */
function explain(reason: SuiteMutationError): string {
  switch (reason) {
    case 'last-suite':
      return 'This is your only suite — there has to be one.'
    case 'last-in-suite':
      return 'A suite keeps at least one device. Add another one first.'
    case 'duplicate-name':
      return 'You already have a suite with that name.'
    case 'invalid-name':
      return `Give the suite a name of up to ${MAX_SUITE_NAME_LENGTH} characters.`
    case 'too-many':
      return 'You have reached the maximum number of suites.'
    default:
      return 'That is no longer there.'
  }
}

/**
 * One device in the active suite: draggable, and removable in one click.
 *
 * The chip is the drag handle rather than a separate grip: the whole point of
 * the row is that it can be rearranged, and a 12px grip beside each name would
 * be a smaller target for no gain. The remove button stops the pointer from
 * reaching the drag listeners, so a click on it is only ever a click.
 */
function DeviceChip({
  device,
  onRemove
}: {
  device: DeviceSpec
  onRemove: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: device.id
  })

  return (
    <li
      ref={setNodeRef}
      data-suite-device-id={device.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3',
        'shadow-hairline select-none',
        // Transform and opacity only, so the reflow stays on the compositor.
        isDragging ? 'z-10 opacity-80 shadow-soft' : 'opacity-100'
      )}
      {...attributes}
      {...listeners}
    >
      <span className="cursor-grab text-caption text-foreground active:cursor-grabbing">
        {device.name}
      </span>
      <span className="text-micro tabular-nums text-muted-foreground">
        {device.width}×{device.height}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${device.name} from this suite`}
        className="rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <XMarkIcon />
      </Button>
    </li>
  )
}

/**
 * Suites: which one the canvas is showing, what is in it, and in what order.
 *
 * It sits at the top of the device library because that is the order of the
 * decisions — you pick the set you are working on, then you fill it. The row of
 * chips *is* the canvas: dragging one is the layout, not a preference about it.
 */
export function SuitesPanel(): React.JSX.Element {
  const suites = useDevices((s) => s.suites)
  const activeSuiteId = useDevices((s) => s.activeSuiteId)
  const active = useDevices((s) => s.active)

  const [notice, setNotice] = useState<Notice | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // One timer, restarted: two answers in a row must not leave the first one's
  // expiry to wipe the second.
  const say = (tone: Notice['tone'], text: string): void => {
    setNotice({ tone, text })
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    },
    []
  )

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click on a chip's
    // remove button is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const ids = useMemo(() => active.map((d) => d.id), [active])
  const pendingSuite = suites.find((s) => s.id === pendingDelete) ?? null

  const onDragEnd = (event: DragEndEvent): void => {
    const { active: dragged, over } = event
    if (over === null || dragged.id === over.id) return
    const from = ids.indexOf(String(dragged.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    useDevices.getState().reorderSuiteDevices(from, to)
  }

  const create = (): void => {
    const result = useDevices.getState().createSuite(name)
    if (!result.ok) {
      // Inside the dialog, not in the panel's status line: the panel is behind
      // the overlay, and an answer nobody can see is not an answer.
      setCreateError(explain(result.reason))
      return
    }
    setCreating(false)
    setName('')
    setCreateError(null)
    say('ok', `Now showing “${result.suite.name}”.`)
  }

  const confirmDelete = (): void => {
    if (pendingSuite === null) return
    const result = useDevices.getState().deleteSuite(pendingSuite.id)
    setPendingDelete(null)
    if (!result.ok) say('error', explain(result.reason))
  }

  const removeDevice = (deviceId: string): void => {
    const result = useDevices.getState().toggleDeviceInSuite(deviceId)
    if (!result.ok) say('error', explain(result.reason))
  }

  const exportDocument = (): void => {
    const { customDevices, suites: allSuites } = useDevices.getState()
    void exportBackupFile(serializeBackup({ customDevices, suites: allSuites })).then((result) => {
      if (result.ok) {
        say('ok', 'Saved your devices and suites.')
        return
      }
      // Dismissing the dialog is a decision, not a failure worth reporting.
      if (result.reason === 'cancelled') return
      say('error', `Export failed: ${result.message}`)
    })
  }

  const importDocument = (): void => {
    void importBackupFile().then((result) => {
      if (!result.ok) {
        if (result.reason === 'cancelled') return
        say('error', `Import failed: ${result.message}`)
        return
      }

      const merged = useDevices.getState().importBackup(result.backup)
      const devices = merged.devicesAdded + merged.devicesReplaced
      const imported = merged.suitesAdded + merged.suitesReplaced
      say(
        'ok',
        `Imported ${devices} ${devices === 1 ? 'device' : 'devices'} and ${imported} ${
          imported === 1 ? 'suite' : 'suites'
        }.`
      )
    })
  }

  return (
    <section className="flex flex-col gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-caption font-medium text-foreground">Suites</h3>

        <ul className="flex flex-wrap items-center gap-1">
          {suites.map((suite) => {
            const current = suite.id === activeSuiteId
            return (
              <li key={suite.id} className="group flex items-center">
                <Button
                  variant="ghost"
                  size="xs"
                  aria-pressed={current}
                  data-suite-id={suite.id}
                  onClick={() => useDevices.getState().setActiveSuite(suite.id)}
                  className={cn(
                    'gap-1 rounded-full px-2.5 transition-colors duration-150 ease-out',
                    current
                      ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                      : 'text-muted-foreground'
                  )}
                >
                  {current ? <CheckIcon className="size-3.5" /> : null}
                  {suite.name}
                </Button>
                {/*
                  Beside the pill, not inside it: a button cannot contain
                  another one, and deleting is not what a click on the name is
                  for. It stays out of the way until the row is hovered.
                */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete suite ${suite.name}`}
                  onClick={() => setPendingDelete(suite.id)}
                  className={cn(
                    '-ml-1 rounded-full text-muted-foreground opacity-0',
                    'transition-opacity duration-150 ease-out',
                    'hover:bg-destructive/10 hover:text-destructive',
                    'group-hover:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  <XMarkIcon />
                </Button>
              </li>
            )
          })}
        </ul>

        <Button
          variant="ghost"
          size="xs"
          className="rounded-full text-muted-foreground"
          onClick={() => {
            setName('')
            setCreateError(null)
            setCreating(true)
          }}
        >
          <PlusIcon />
          New suite
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Import" onClick={importDocument}>
                <ArrowDownTrayIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import devices and suites from a file</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Export" onClick={exportDocument}>
                <ArrowUpTrayIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export your devices and suites to a file</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More suite options">
                <EllipsisHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setConfirmingReset(true)}
                data-testid="reset-document"
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <ArrowPathIcon />
                Reset everything
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-micro text-muted-foreground">In this suite · drag to reorder</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ul className="flex flex-wrap items-center gap-1.5" data-testid="suite-devices">
              {active.map((device) => (
                <DeviceChip
                  key={device.id}
                  device={device}
                  onRemove={() => removeDevice(device.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      {notice === null ? null : (
        <p
          role="status"
          className={cn(
            'text-micro',
            notice.tone === 'error' ? 'text-status-error' : 'text-muted-foreground'
          )}
        >
          {notice.text}
        </p>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New suite</DialogTitle>
            <DialogDescription>
              A suite is a named set of devices. It starts with one — add the rest from the library
              below.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={MAX_SUITE_NAME_LENGTH}
            aria-label="Suite name"
            placeholder="Marketing site"
            aria-invalid={createError !== null || undefined}
            onChange={(event) => {
              setName(event.target.value)
              setCreateError(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              create()
            }}
          />
          {createError === null ? null : (
            <p className="text-caption text-status-error">{createError}</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={create}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingSuite !== null} onOpenChange={(open) => open || setPendingDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{pendingSuite?.name}”?</DialogTitle>
            <DialogDescription>
              The suite goes away. The devices in it stay in your library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset everything?</DialogTitle>
            <DialogDescription>
              Every device you made and every suite you arranged is deleted, leaving the default
              suite. Export first if you want them back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingReset(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                useDevices.getState().reset()
                setConfirmingReset(false)
                say('ok', 'Back to the default suite.')
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
