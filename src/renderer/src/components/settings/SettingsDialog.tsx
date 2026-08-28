import { useEffect } from 'react'
import { FolderOpenIcon } from '@heroicons/react/24/outline'
import type { ShotDpr, ShotFormat } from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'
import { useShots } from '@renderer/stores/shots'

export type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Choice<T> = { value: T; label: string; hint: string }

const FORMATS: readonly Choice<ShotFormat>[] = [
  { value: 'png', label: 'PNG', hint: 'Lossless. The default, and the one to send a developer.' },
  { value: 'jpeg', label: 'JPEG', hint: 'Smaller files, with compression artefacts around text.' }
]

const DENSITIES: readonly Choice<ShotDpr>[] = [
  {
    value: 'device',
    label: 'Device',
    hint: 'The device’s own pixel ratio — a 393pt iPhone shot comes out 1179px wide.'
  },
  {
    value: 1,
    label: '1×',
    hint: 'One image pixel per CSS pixel. Smaller files, easier to measure against.'
  }
]

/** A segmented picker: two or three choices that are one click apart. */
function Segmented<T extends string | number>({
  label,
  value,
  choices,
  onChange
}: {
  label: string
  value: T
  choices: readonly Choice<T>[]
  onChange: (value: T) => void
}): React.JSX.Element {
  const selected = choices.find((choice) => choice.value === value)

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-md bg-muted p-1">
        {choices.map((choice) => (
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={choice.value === value}
            onClick={() => onChange(choice.value)}
            className={cn(
              'flex flex-1 items-center justify-center rounded-sm px-2 py-1',
              'text-micro font-medium transition-colors duration-150 ease-out outline-none',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50',
              choice.value === value
                ? 'bg-card text-foreground shadow-hairline'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {/* Fixed height: the hint changes with the choice, and the dialog must
          not resize under the pointer while someone is comparing two of them. */}
      <p className="min-h-[34px] text-micro text-muted-foreground">{selected?.hint ?? ''}</p>
    </div>
  )
}

/**
 * Everything about Respo that is a preference rather than a step in a task.
 *
 * Only screenshots for now, which is why there is no navigation in here: a
 * sidebar with one entry is a promise about a second one. The theme lives in
 * the toolbar, where it is one click rather than three.
 *
 * Every control writes through immediately — there is no Save button, because
 * there is nothing here that a person would want to try and then abandon.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const settings = useShots((s) => s.settings)
  const directory = useShots((s) => s.directory)
  const setFormat = useShots((s) => s.setFormat)
  const setDpr = useShots((s) => s.setDpr)
  const chooseDirectory = useShots((s) => s.chooseDirectory)
  const refreshDirectory = useShots((s) => s.refreshDirectory)

  // The folder shown is the one main will actually write to, and main is the
  // only side that can resolve the default. Asked on open rather than kept in
  // step: it changes about as often as the dialog is opened.
  useEffect(() => {
    if (open) refreshDirectory()
  }, [open, refreshDirectory])

  const shown = directory === '' ? settings.directory : directory

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Where screenshots go, and what they look like.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shots-folder">Screenshots folder</Label>
            <div className="flex items-center gap-2">
              {/*
                Read-only and not an input: a path is main's to hand out and
                main's to change (CLAUDE.md §7), and a field someone can type
                into invites a path that does not exist.
              */}
              <p
                id="shots-folder"
                title={shown}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40',
                  'px-2.5 py-1.5 text-caption text-foreground'
                )}
              >
                {shown === '' ? 'Loading…' : shown}
              </p>
              <Button variant="outline" size="sm" onClick={() => void chooseDirectory()}>
                <FolderOpenIcon />
                Choose…
              </Button>
            </div>
            <p className="min-h-[19px] text-micro text-muted-foreground">
              New screenshots land here. Existing files stay where they are.
            </p>
          </div>

          <Segmented
            label="Format"
            value={settings.format}
            choices={FORMATS}
            onChange={setFormat}
          />
          <Segmented
            label="Pixel density"
            value={settings.dpr}
            choices={DENSITIES}
            onChange={setDpr}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
