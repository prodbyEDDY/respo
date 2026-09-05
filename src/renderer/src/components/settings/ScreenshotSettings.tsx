import { useEffect } from 'react'
import { ExclamationTriangleIcon, FolderOpenIcon } from '@heroicons/react/24/outline'
import type { ShotDpr, ShotFormat } from '@shared/ipc'
import { Segmented } from '@renderer/components/common/Segmented'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'
import { useSettings } from '@renderer/stores/settings'
import { useShots } from '@renderer/stores/shots'
import { useUpdates } from '@renderer/stores/updates'

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

/** A segmented picker with a caption above and the chosen option's hint below. */
function SegmentedField<T extends string | number>({
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
      <Segmented
        label={label}
        value={value}
        choices={choices}
        onChange={onChange}
        className="p-1"
      />
      {/* Fixed height: the hint changes with the choice, and the dialog must
          not resize under the pointer while someone is comparing two of them. */}
      <p className="min-h-[34px] text-micro text-muted-foreground">{selected?.hint ?? ''}</p>
    </div>
  )
}

/**
 * The one switch here that makes Respo less safe than it was.
 *
 * Styled as a warning rather than as a checkbox with a long label, because the
 * label is the point: it says *which* pages it applies to (the device views,
 * never Respo's own window) and it says what "invalid" covers. Someone turning
 * this on for a staging box should be able to read, in the moment, exactly how
 * far it reaches.
 */
export function InsecureCertificates(): React.JSX.Element {
  const allow = useSettings((s) => s.allowInsecureCertificates)
  const setAllow = useSettings((s) => s.setAllowInsecureCertificates)

  return (
    <div
      data-slot="insecure-certificates"
      data-enabled={allow ? 'true' : 'false'}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border p-2.5 transition-colors duration-150 ease-out',
        allow ? 'border-status-error/40 bg-status-error/5' : 'border-border'
      )}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          id="allow-insecure-certificates"
          checked={allow}
          className="mt-0.5"
          onCheckedChange={(next) => setAllow(next === true)}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label
            htmlFor="allow-insecure-certificates"
            className={cn('cursor-pointer', allow && 'text-status-error')}
          >
            Allow invalid certificates
          </Label>
          <p className="text-micro text-muted-foreground">
            Device views will load pages whose certificate is expired, self-signed or issued for
            another host. Respo’s own window is never affected.
          </p>
        </div>
      </div>
      {allow ? (
        <p className="flex items-start gap-1.5 text-micro text-status-error">
          <ExclamationTriangleIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            Nothing will warn you that a device view’s connection is not private. Turn this off
            again when you are done with the server that needed it.
          </span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * The daily launch check, as a preference.
 *
 * The only thing about updates that *is* a preference: what happens after a
 * check is the toolbar chip's business, and checking by hand lives in About.
 * Off in a build that never checks, with the label saying why, rather than a
 * checkbox that would silently do nothing.
 */
export function AutoUpdateCheck(): React.JSX.Element {
  const enabled = useUpdates((s) => s.status.enabled)
  const autoCheck = useUpdates((s) => s.status.autoCheck)
  const setAutoCheck = useUpdates((s) => s.setAutoCheck)

  return (
    <div className="flex items-start gap-2 rounded-md border border-border p-2.5">
      <Checkbox
        id="auto-check-updates"
        checked={autoCheck}
        disabled={!enabled}
        className="mt-0.5"
        onCheckedChange={(next) => setAutoCheck(next === true)}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor="auto-check-updates" className={cn(enabled && 'cursor-pointer')}>
          Check for updates automatically
        </Label>
        <p className="text-micro text-muted-foreground">
          {enabled
            ? 'Once a day, when Respo starts. Nothing is downloaded until you click the update chip.'
            : 'Updates are off in this build.'}
        </p>
      </div>
    </div>
  )
}

export function ScreenshotSettings(): React.JSX.Element {
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
    refreshDirectory()
  }, [refreshDirectory])

  const shown = directory === '' ? settings.directory : directory

  return (
    <div className="flex flex-col gap-5">
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

      <SegmentedField
        label="Format"
        value={settings.format}
        choices={FORMATS}
        onChange={setFormat}
      />
      <SegmentedField
        label="Pixel density"
        value={settings.dpr}
        choices={DENSITIES}
        onChange={setDpr}
      />
    </div>
  )
}
