import { useEffect, useMemo, useState } from 'react'
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { matchesQuery, type CustomDeviceInput } from '@shared/custom-devices'
import { DEVICE_CATALOG } from '@shared/deviceCatalog'
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
import { Input } from '@renderer/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { MAX_SUITE_DEVICES, suitesEmptiedBy, useDevices } from '@renderer/stores/devices'
import { useLayout } from '@renderer/stores/layout'
import { DeviceCard } from './DeviceCard'
import { DeviceEditDialog } from './DeviceEditDialog'
import { SuitesPanel } from './SuitesPanel'

function Section({
  title,
  count,
  caption,
  children
}: {
  title: string
  count: number
  caption?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-caption font-medium text-foreground">{title}</h3>
        <span className="text-micro tabular-nums text-muted-foreground">{count}</span>
        {caption === undefined ? null : (
          <span className="text-micro text-muted-foreground">· {caption}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>
}

/** “Mobile”, or “Mobile” and “Tablet” — suites, as a sentence names them. */
function namesOf(suites: readonly { name: string }[]): string {
  const quoted = suites.map((suite) => `“${suite.name}”`)
  if (quoted.length <= 1) return quoted[0] ?? 'That suite'
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) as string}`
}

/** Whether a key event came from somewhere the user is writing. */
function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * The full-screen device library.
 *
 * It replaces the canvas rather than floating over it: device pages are native
 * views composited above everything the renderer draws, so a panel on top of
 * them is not a thing that can exist. `App` stops reporting layout while this
 * is open, which is what takes the views off the screen.
 */
export function DeviceManagerView(): React.JSX.Element {
  const customDevices = useDevices((s) => s.customDevices)
  const allDevices = useDevices((s) => s.allDevices)
  const active = useDevices((s) => s.active)
  const suites = useDevices((s) => s.suites)
  const activeSuiteId = useDevices((s) => s.activeSuiteId)
  const setView = useLayout((s) => s.setView)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DeviceSpec | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DeviceSpec | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  /**
   * The one-line answer under the suites panel, and the state it was an answer
   * *about*.
   *
   * Kept together so the notice can expire without an effect: the moment the
   * active suite or its membership changes, what this says has been acted on
   * (or overtaken) and it stops being rendered.
   */
  const [suiteNotice, setSuiteNotice] = useState<{ text: string; about: string } | null>(null)

  const close = (): void => setView('canvas')

  // Escape closes the manager — but only when nothing is layered above it, or
  // it would close out from under the dialog the user is actually looking at.
  const blocked = editorOpen || pendingDelete !== null
  useEffect(() => {
    if (blocked) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Asked of the DOM rather than tracked in state: dialogs of our own are
      // in `blocked`, but the suites panel owns three more, and one Escape must
      // never dismiss two surfaces at once.
      if (document.querySelector('[data-slot="dialog-content"]') !== null) return
      // The same rule for a field that is being typed in — the address bar is
      // still in the toolbar above this view, and Escape there means "drop what
      // I typed", not "close the library behind me".
      if (isEditing(event.target)) return
      setView('canvas')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [blocked, setView])

  const inSuite = useMemo(() => new Set(active.map((d) => d.id)), [active])
  // What the status line below is *about*: the suite, and what is in it.
  const membership = useMemo(
    () => activeSuiteId + ':' + active.map((d) => d.id).join(' '),
    [activeSuiteId, active]
  )
  const suiteError = suiteNotice?.about === membership ? suiteNotice.text : null
  const setSuiteError = (text: string | null): void => {
    setSuiteNotice(text === null ? null : { text, about: membership })
  }

  /** The suites that hold nothing but the device waiting to be deleted. */
  const blockingSuites = useMemo(
    () => (pendingDelete === null ? [] : suitesEmptiedBy(suites, pendingDelete.id)),
    [pendingDelete, suites]
  )

  const custom = useMemo(
    () => customDevices.filter((d) => matchesQuery(d, query)),
    [customDevices, query]
  )
  const catalog = useMemo(() => DEVICE_CATALOG.filter((d) => matchesQuery(d, query)), [query])
  const nothingFound = custom.length === 0 && catalog.length === 0

  /**
   * Membership, from the card. Two ways it is refused — the suite's last device
   * and the suite's ceiling — and both are worth a sentence, because neither is
   * visible on the button that was just clicked.
   */
  const toggleSuite = (device: DeviceSpec): void => {
    const result = useDevices.getState().toggleDeviceInSuite(device.id)
    if (result.ok) {
      setSuiteError(null)
      return
    }
    setSuiteError(
      result.reason === 'last-in-suite'
        ? 'A suite keeps at least one device. Add another one before removing this.'
        : result.reason === 'too-many'
          ? `A suite holds at most ${MAX_SUITE_DEVICES} devices. Take one out to make room.`
          : 'That device is no longer there.'
    )
  }

  const openEditor = (device: DeviceSpec | null): void => {
    setEditing(device)
    setFormError(null)
    setEditorOpen(true)
  }

  const submit = (input: CustomDeviceInput): boolean => {
    const store = useDevices.getState()
    const result = editing === null ? store.addCustom(input) : store.updateCustom(editing.id, input)
    if (!result.ok) {
      // A valid form can still be refused by the store: the document has a cap,
      // and the device being edited may have been deleted in another window.
      setFormError(
        result.reason === 'too-many'
          ? 'You have reached the maximum number of custom devices.'
          : 'That device no longer exists.'
      )
      return false
    }

    // The device is in the library either way; the canvas is the part that can
    // be full, and a device that quietly did not appear needs explaining.
    if ('joinedSuite' in result && !result.joinedSuite) {
      setSuiteError(
        `“${result.device.name}” was added to your devices. This suite already holds ` +
          `${MAX_SUITE_DEVICES}, so it is not on the canvas — take one out to make room.`
      )
    }
    return true
  }

  const confirmDelete = (): void => {
    if (pendingDelete === null) return
    const result = useDevices.getState().removeCustom(pendingDelete.id)
    if (result.ok) {
      setPendingDelete(null)
      setDeleteError(null)
      return
    }
    setDeleteError(
      result.reason === 'last-in-suite'
        ? `${namesOf(blockingSuites)} would be left with no devices. Add another one there first.`
        : 'That device no longer exists.'
    )
  }

  return (
    <div className="flex h-full flex-col bg-background" data-testid="device-manager">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <h2 className="text-heading font-medium text-foreground">Devices</h2>

        <div className="relative ml-2 max-w-xs flex-1">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or size"
            aria-label="Search devices"
            className="pl-8"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button onClick={() => openEditor(null)}>
            <PlusIcon />
            New device
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close devices" onClick={close}>
                <XMarkIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to the canvas · Esc</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <SuitesPanel />

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="flex flex-col gap-6">
          {suiteError === null ? null : (
            <p role="status" className="text-caption text-status-error">
              {suiteError}
            </p>
          )}

          <Section
            title="Your devices"
            count={custom.length}
            caption={customDevices.length === 0 ? undefined : 'editable'}
          >
            {custom.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-caption text-muted-foreground">
                {customDevices.length === 0
                  ? 'No devices of your own yet. Add one to test a viewport the catalog does not cover.'
                  : 'No matches here.'}
              </p>
            ) : (
              <Grid>
                {custom.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    inSuite={inSuite.has(device.id)}
                    onToggleSuite={() => toggleSuite(device)}
                    onEdit={() => openEditor(device)}
                    onDelete={() => {
                      setDeleteError(null)
                      setPendingDelete(device)
                    }}
                  />
                ))}
              </Grid>
            )}
          </Section>

          <Section title="Built-in devices" count={catalog.length} caption="read-only">
            <Grid>
              {catalog.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  inSuite={inSuite.has(device.id)}
                  onToggleSuite={() => toggleSuite(device)}
                />
              ))}
            </Grid>
          </Section>

          {nothingFound ? (
            <p className="text-center text-caption text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : null}
        </div>
      </div>

      <DeviceEditDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        device={editing}
        devices={allDevices}
        error={formError}
        onSubmit={submit}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (open) return
          setPendingDelete(null)
          setDeleteError(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
            <DialogDescription>
              {blockingSuites.length === 0
                ? 'It is removed from every suite that uses it. This cannot be undone.'
                : `${namesOf(blockingSuites)} ${blockingSuites.length === 1 ? 'holds' : 'hold'} ` +
                  'nothing else, and a suite cannot be empty. Add another device there, then ' +
                  'delete this one.'}
            </DialogDescription>
          </DialogHeader>
          {deleteError === null ? null : (
            <p className="text-caption text-status-error">{deleteError}</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={blockingSuites.length > 0}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
