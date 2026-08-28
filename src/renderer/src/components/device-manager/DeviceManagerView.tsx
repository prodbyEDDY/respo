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
import { useDevices } from '@renderer/stores/devices'
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
  const setView = useLayout((s) => s.setView)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DeviceSpec | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DeviceSpec | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [suiteError, setSuiteError] = useState<string | null>(null)

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
      setView('canvas')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [blocked, setView])

  const inSuite = useMemo(() => new Set(active.map((d) => d.id)), [active])

  const custom = useMemo(
    () => customDevices.filter((d) => matchesQuery(d, query)),
    [customDevices, query]
  )
  const catalog = useMemo(() => DEVICE_CATALOG.filter((d) => matchesQuery(d, query)), [query])
  const nothingFound = custom.length === 0 && catalog.length === 0

  /**
   * Membership, from the card. The only way this is refused is the suite's last
   * device, which is worth a sentence — everything else just happens.
   */
  const toggleSuite = (device: DeviceSpec): void => {
    const result = useDevices.getState().toggleDeviceInSuite(device.id)
    setSuiteError(
      result.ok
        ? null
        : result.reason === 'last-in-suite'
          ? 'A suite keeps at least one device. Add another one before removing this.'
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
    if (result.ok) return true

    // A valid form can still be refused by the store: the document has a cap,
    // and the device being edited may have been deleted in another window.
    setFormError(
      result.reason === 'too-many'
        ? 'You have reached the maximum number of custom devices.'
        : 'That device no longer exists.'
    )
    return false
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
        ? 'This is the only device left in the current suite. Add another one first.'
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
              It is removed from every suite that uses it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError === null ? null : (
            <p className="text-caption text-status-error">{deleteError}</p>
          )}
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
    </div>
  )
}
