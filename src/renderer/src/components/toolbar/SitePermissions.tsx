import { useEffect, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  BellIcon,
  ClipboardIcon,
  CursorArrowRaysIcon,
  MapPinIcon,
  MicrophoneIcon,
  MusicalNoteIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  VideoCameraIcon
} from '@heroicons/react/24/outline'
import {
  PERMISSION_TYPES,
  type PermissionDecision,
  type PermissionPrompt,
  type PermissionType
} from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { selectPrompt, usePermissions } from '@renderer/stores/permissions'

type Capability = {
  label: string
  /** What the page is asking to do, as the prompt says it. */
  verb: string
  Icon: typeof VideoCameraIcon
}

/**
 * The eight capabilities, in the order the panel lists them.
 *
 * The order is not alphabetical: it runs from the things that watch you
 * (camera, microphone, location) down to the things that merely take over the
 * window. Someone scanning this list for something alarming finds it in the
 * first three rows.
 */
const CAPABILITIES: Readonly<Record<PermissionType, Capability>> = {
  camera: { label: 'Camera', verb: 'use your camera', Icon: VideoCameraIcon },
  microphone: { label: 'Microphone', verb: 'use your microphone', Icon: MicrophoneIcon },
  geolocation: { label: 'Location', verb: 'know your location', Icon: MapPinIcon },
  notifications: { label: 'Notifications', verb: 'send you notifications', Icon: BellIcon },
  'clipboard-read': { label: 'Clipboard', verb: 'read your clipboard', Icon: ClipboardIcon },
  fullscreen: { label: 'Fullscreen', verb: 'go fullscreen', Icon: ArrowsPointingOutIcon },
  midi: { label: 'MIDI devices', verb: 'use your MIDI devices', Icon: MusicalNoteIcon },
  pointerLock: { label: 'Pointer lock', verb: 'capture your pointer', Icon: CursorArrowRaysIcon }
}

const DECISION_LABEL: Readonly<Record<PermissionDecision, string>> = {
  allow: 'Allow',
  block: 'Block',
  ask: 'Ask'
}

/** The site, as a person reads it: no scheme, no trailing slash. */
function siteName(origin: string | null): string {
  if (origin === null) return 'this page'
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/** "your camera", or "your camera and microphone" for a `getUserMedia` of both. */
function promptVerb(types: readonly PermissionType[]): string {
  const verbs = types.map((type) => CAPABILITIES[type].verb)
  if (verbs.length <= 1) return verbs[0] ?? 'do that'
  // Both halves are `use your …`; saying it twice reads like two questions.
  return `use your ${types.map((type) => CAPABILITIES[type].label.toLowerCase()).join(' and ')}`
}

/**
 * One capability, as a row that cycles.
 *
 * A click steps Allow -> Block -> Ask, which is three states on one control
 * rather than a select nobody opens. The decision is spelled out in words on the
 * right — an icon for "block" and a different icon for "ask" would be a puzzle —
 * and the whole row is the hit target.
 */
function CapabilityRow({ type }: { type: PermissionType }): React.JSX.Element {
  const decision = usePermissions((s) => s.decisions[type])
  const origin = usePermissions((s) => s.origin)
  const cycle = usePermissions((s) => s.cycle)
  const { label, Icon } = CAPABILITIES[type]

  return (
    <button
      type="button"
      data-permission={type}
      data-decision={decision}
      disabled={origin === null}
      aria-label={`${label}: ${DECISION_LABEL[decision]}`}
      onClick={() => cycle(type)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-caption',
        'transition-colors duration-150 ease-out outline-none',
        'hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50'
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left text-foreground">{label}</span>
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium',
          decision === 'allow' && 'bg-status-ok/15 text-status-ok',
          decision === 'block' && 'bg-status-error/15 text-status-error',
          decision === 'ask' && 'bg-muted text-muted-foreground'
        )}
      >
        {DECISION_LABEL[decision]}
      </span>
    </button>
  )
}

/**
 * The question, when a page is asking one.
 *
 * Two buttons and a sentence: everything a person needs to answer, and nothing
 * that has to be read twice. Block sits first because the safe answer should not
 * be the one under the cursor when a bubble appears.
 */
function Prompt({ prompt }: { prompt: PermissionPrompt }): React.JSX.Element {
  const respond = usePermissions((s) => s.respond)
  const first = prompt.types[0]
  const Icon = first === undefined ? ShieldExclamationIcon : CAPABILITIES[first].Icon

  return (
    <div className="flex flex-col gap-3" data-slot="permission-prompt">
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
        <p className="min-w-0 text-caption text-foreground">
          <span className="font-medium">{siteName(prompt.origin)}</span> wants to{' '}
          {promptVerb(prompt.types)}.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => respond(prompt.id, false)}>
          Block
        </Button>
        <Button size="sm" onClick={() => respond(prompt.id, true)}>
          Allow
        </Button>
      </div>
    </div>
  )
}

/** The list, plus the two things that act on all of it at once. */
function Panel(): React.JSX.Element {
  const origin = usePermissions((s) => s.origin)
  const changed = usePermissions((s) => s.changed)
  const resetAll = usePermissions((s) => s.resetAll)
  const reload = usePermissions((s) => s.reload)

  return (
    <div className="flex flex-col gap-2" data-slot="permission-panel">
      <div className="flex flex-col gap-0.5">
        <p className="text-caption font-medium text-foreground">Permissions</p>
        <p className="truncate text-micro text-muted-foreground" title={origin ?? ''}>
          {origin === null ? 'There is no site here yet.' : siteName(origin)}
        </p>
      </div>

      <div className="flex flex-col">
        {PERMISSION_TYPES.map((type) => (
          <CapabilityRow key={type} type={type} />
        ))}
      </div>

      {/*
        A page reads a permission when it *asks* for it, so a site already
        refused does not notice being allowed afterwards. Said, not done: a
        reload throws away whatever state the page is in.
      */}
      {changed ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5">
          <span className="min-w-0 text-micro text-muted-foreground">Reload to apply</span>
          <Button variant="ghost" size="xs" onClick={() => reload()}>
            <ArrowPathIcon />
            Reload
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="xs"
          disabled={origin === null}
          className="text-muted-foreground"
          onClick={resetAll}
        >
          Reset all
        </Button>
      </div>
    </div>
  )
}

/**
 * The shield in the address bar: what this site may do, and where it asks.
 *
 * One surface for both, the way a browser does it, and for the same reason —
 * the answer to "why did that dialog appear?" and the answer to "what did I
 * allow here?" are the same list, and a person who has just clicked Allow needs
 * to find their way back to it.
 *
 * A question opens the popover on its own. It does *not* take focus: the address
 * bar is where people are typing when a page decides to ask for a camera, and a
 * prompt that swallowed the next keystroke would be a prompt people learn to
 * fear. Clicking away dismisses it without deciding anything — see
 * `PermissionsState.dismiss`.
 */
export function SiteShield(): React.JSX.Element {
  const prompt = usePermissions(selectPrompt)
  const decisions = usePermissions((s) => s.decisions)
  const dismiss = usePermissions((s) => s.dismiss)
  const refresh = usePermissions((s) => s.refresh)
  const [panelOpen, setPanelOpen] = useState(false)

  const asking = prompt !== null
  const open = panelOpen || asking
  // Something on this site has been refused — worth showing on the icon, since
  // "the map is blank" and "you blocked location here" look identical otherwise.
  const blocked = PERMISSION_TYPES.some((type) => decisions[type] === 'block')

  // The panel is about the site the canvas is on, and main is the only side
  // that knows which that is. Asked on open rather than kept in step.
  useEffect(() => {
    if (panelOpen) refresh()
  }, [panelOpen, refresh])

  const label = asking ? 'A site is asking for a permission' : 'Site permissions for this page'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setPanelOpen(next)
        // Closing while a question is up is "not now", never a decision.
        if (!next && prompt !== null) dismiss(prompt.id)
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              data-slot="site-shield"
              data-asking={asking ? 'true' : 'false'}
              className={cn(
                'rounded-full',
                asking && 'text-primary hover:text-primary',
                !asking && blocked && 'text-status-error hover:text-status-error',
                !asking && !blocked && 'text-muted-foreground'
              )}
            >
              {blocked && !asking ? <ShieldExclamationIcon /> : <ShieldCheckIcon />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        className="w-72"
        // The address bar keeps the keys. A bubble that appears because a page
        // decided to ask must not eat the url someone is halfway through typing.
        onOpenAutoFocus={(event) => {
          if (!panelOpen) event.preventDefault()
        }}
      >
        {prompt === null ? <Panel /> : <Prompt prompt={prompt} />}
      </PopoverContent>
    </Popover>
  )
}
