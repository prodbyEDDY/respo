import { useState } from 'react'
import {
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DeviceTabletIcon
} from '@heroicons/react/24/outline'
import {
  draftFromDevice,
  draftWithType,
  emptyDraft,
  MAX_DPR,
  MAX_DIMENSION,
  MAX_NAME_LENGTH,
  MIN_DPR,
  MIN_DIMENSION,
  validateDraft,
  type CustomDeviceInput,
  type DeviceDraft,
  type DraftErrors
} from '@shared/custom-devices'
import type { DeviceSpec, DeviceType } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'

export type DeviceEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The device being edited; `null` creates a new one. */
  device: DeviceSpec | null
  /** Everything the new name has to be distinct from. */
  devices: readonly DeviceSpec[]
  /** A refusal from the store, for a form that was otherwise valid. */
  error?: string | null
  /** Called with a valid device. Return `false` to keep the dialog open. */
  onSubmit: (input: CustomDeviceInput) => boolean
}

const TYPES: ReadonlyArray<{
  value: DeviceType
  label: string
  icon: typeof DevicePhoneMobileIcon
}> = [
  { value: 'phone', label: 'Phone', icon: DevicePhoneMobileIcon },
  { value: 'tablet', label: 'Tablet', icon: DeviceTabletIcon },
  { value: 'desktop', label: 'Desktop', icon: ComputerDesktopIcon }
]

/** One labelled field with room for its error, so nothing jumps when one appears. */
function Field({
  id,
  label,
  error,
  hint,
  children
}: {
  id: string
  label: string
  error?: string | undefined
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p
        className={cn(
          'min-h-[19px] text-micro',
          error === undefined ? 'text-muted-foreground' : 'text-status-error'
        )}
      >
        {error ?? hint ?? ''}
      </p>
    </div>
  )
}

/**
 * The form behind "New device" and "Edit".
 *
 * It validates on submit, not on every keystroke: "39" is a perfectly
 * reasonable thing to have typed on the way to "393", and a form that objects
 * mid-word is a worse experience than one that waits to be asked.
 *
 * Deliberately a component of its own, mounted only while the dialog is open:
 * the draft is then *initialised* from `device` rather than synced to it by an
 * effect, so the previous edit's values cannot leak into the next one and there
 * is no render-then-correct pass on the way in.
 */
function DeviceForm({
  device,
  devices,
  error,
  onSubmit,
  onCancel
}: Omit<DeviceEditDialogProps, 'open' | 'onOpenChange'> & {
  onCancel: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<DeviceDraft>(() =>
    device === null ? emptyDraft() : draftFromDevice(device)
  )
  const [errors, setErrors] = useState<DraftErrors>({})

  const editing = device !== null
  const field = <K extends keyof DeviceDraft>(key: K, value: DeviceDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const result = validateDraft(draft, {
      devices,
      ...(device === null ? {} : { editingId: device.id })
    })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    onSubmit(result.device)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit device' : 'New device'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Changes apply to every view of this device straight away.'
            : 'It joins the current suite, so it shows up on the canvas right away.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="flex flex-col gap-1">
        <Field id="device-name" label="Name" error={errors.name}>
          <Input
            id="device-name"
            value={draft.name}
            autoFocus
            // The same ceiling the validator uses: a field that lets you type
            // past it only to refuse on submit is a trap.
            maxLength={MAX_NAME_LENGTH}
            placeholder="My phone"
            aria-invalid={errors.name !== undefined}
            onChange={(e) => field('name', e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <div
            role="radiogroup"
            aria-label="Device type"
            className="flex gap-1 rounded-md bg-muted p-1"
          >
            {TYPES.map(({ value, label, icon: Icon }) => {
              const selected = draft.type === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDraft((current) => draftWithType(current, value))}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1',
                    'text-micro font-medium transition-colors duration-150 ease-out outline-none',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    selected
                      ? 'bg-card text-foreground shadow-hairline'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </button>
              )
            })}
          </div>
          <p className="min-h-[19px] text-micro text-muted-foreground">
            Sets the user agent, touch and rotation below — until you change them yourself.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field
            id="device-width"
            label="Width"
            error={errors.width}
            hint={`${MIN_DIMENSION}–${MAX_DIMENSION} px`}
          >
            <Input
              id="device-width"
              type="number"
              inputMode="numeric"
              value={draft.width}
              aria-invalid={errors.width !== undefined}
              onChange={(e) => field('width', e.target.value)}
            />
          </Field>
          <Field
            id="device-height"
            label="Height"
            error={errors.height}
            hint={`${MIN_DIMENSION}–${MAX_DIMENSION} px`}
          >
            <Input
              id="device-height"
              type="number"
              inputMode="numeric"
              value={draft.height}
              aria-invalid={errors.height !== undefined}
              onChange={(e) => field('height', e.target.value)}
            />
          </Field>
          <Field
            id="device-dpr"
            label="Pixel ratio"
            error={errors.dpr}
            hint={`${MIN_DPR}–${MAX_DPR}`}
          >
            <Input
              id="device-dpr"
              type="number"
              step="0.5"
              inputMode="decimal"
              value={draft.dpr}
              aria-invalid={errors.dpr !== undefined}
              onChange={(e) => field('dpr', e.target.value)}
            />
          </Field>
        </div>

        <Field id="device-ua" label="User agent" error={errors.userAgent}>
          <Textarea
            id="device-ua"
            rows={3}
            value={draft.userAgent}
            aria-invalid={errors.userAgent !== undefined}
            onChange={(e) => field('userAgent', e.target.value)}
          />
        </Field>

        <div className="flex gap-6 pb-2">
          <Label htmlFor="device-touch">
            <Checkbox
              id="device-touch"
              checked={draft.touch}
              onCheckedChange={(checked) => field('touch', checked === true)}
            />
            Touch screen
          </Label>
          <Label htmlFor="device-rotatable">
            <Checkbox
              id="device-rotatable"
              checked={draft.rotatable}
              onCheckedChange={(checked) => field('rotatable', checked === true)}
            />
            Can rotate
          </Label>
        </div>

        {error === null || error === undefined ? null : (
          <p className="pb-2 text-caption text-status-error">{error}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{editing ? 'Save changes' : 'Add device'}</Button>
        </DialogFooter>
      </form>
    </>
  )
}

/**
 * The dialog around the form.
 *
 * Radix mounts its content only while the dialog is open, which is exactly the
 * lifetime the form's state wants: opening it is what builds the draft.
 */
export function DeviceEditDialog({
  open,
  onOpenChange,
  device,
  devices,
  error,
  onSubmit
}: DeviceEditDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The window can be as short as 480px; the form scrolls rather than
          hanging its footer off the bottom of it. */}
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DeviceForm
          key={device?.id ?? 'new'}
          device={device}
          devices={devices}
          error={error}
          onCancel={() => onOpenChange(false)}
          onSubmit={(input) => {
            const accepted = onSubmit(input)
            if (accepted) onOpenChange(false)
            return accepted
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
