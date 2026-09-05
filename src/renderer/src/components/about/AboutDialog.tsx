import { useEffect, useState } from 'react'
import { ArrowTopRightOnSquareIcon, FolderOpenIcon } from '@heroicons/react/24/outline'
import type { AppInfo, AppResource, UpdateStatePayload } from '@shared/ipc'
import mark from '@renderer/assets/respo-mark.svg'
import { Button } from '@renderer/components/ui/button'
import { ipcBridge } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useUpdates } from '@renderer/stores/updates'

/** Where the project lives. One place, so a rename is one edit. */
export const REPO_URL = 'https://github.com/prodbyEDDY/respo'
const ISSUES_URL = `${REPO_URL}/issues/new/choose`
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`

/**
 * What the updater line says. The stage in words, plus when it last looked —
 * the two things someone opening About wants to know about updates.
 */
function updateSummary(status: UpdateStatePayload): string {
  if (!status.enabled) return 'Updates are off in this build.'
  switch (status.stage) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Respo ${status.version ?? ''} is available.`
    case 'downloading':
      return `Downloading Respo ${status.version ?? ''} — ${status.percent ?? 0}%`
    case 'downloaded':
      return `Respo ${status.version ?? ''} is ready to install.`
    case 'error':
      return `Could not check for updates: ${status.error ?? 'unknown error'}`
    case 'up-to-date':
      return 'You have the latest version.'
    default:
      return status.lastCheckAt === null
        ? 'Not checked yet.'
        : `Last checked ${new Date(status.lastCheckAt).toLocaleString()}.`
  }
}

/**
 * The one action next to the summary. It mirrors the toolbar chip when the
 * chip is up — the same click, reachable from here too — and is "Check now"
 * the rest of the time.
 */
function UpdateAction(): React.JSX.Element | null {
  const status = useUpdates((s) => s.status)
  const check = useUpdates((s) => s.check)
  const download = useUpdates((s) => s.download)
  const install = useUpdates((s) => s.install)
  if (!status.enabled) return null

  switch (status.stage) {
    case 'available':
      return (
        <Button size="sm" onClick={download}>
          Update to {status.version}
        </Button>
      )
    case 'downloaded':
      return (
        <Button size="sm" onClick={install}>
          Restart to update
        </Button>
      )
    case 'downloading':
      return null
    default:
      return (
        <Button
          variant="outline"
          size="sm"
          disabled={status.stage === 'checking'}
          onClick={check}
          data-slot="check-updates"
        >
          Check now
        </Button>
      )
  }
}

function ExternalLink({ href, children }: { href: string; children: string }): React.JSX.Element {
  return (
    // Opened by main through `openExternalSafe` — the window's open handler —
    // never in a Respo window.
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm text-caption text-foreground underline-offset-4',
        'hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none'
      )}
    >
      {children}
      <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </a>
  )
}

function openResource(resource: AppResource): void {
  const bridge = ipcBridge()
  if (bridge === null) return
  void bridge.invoke('app:open-resource', resource).catch((error: unknown) => {
    console.error(`could not open ${resource}`, error)
  })
}

/**
 * Version, engines, the updater, and the ways out to the project.
 *
 * Quiet on purpose: no release notes, no "what's new", no counters. It answers
 * "which build is this" and "is there a newer one" and gets out of the way.
 */
export function AboutContent(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const status = useUpdates((s) => s.status)
  const refresh = useUpdates((s) => s.refresh)

  // Asked on open: versions never change within a process, but the dialog is
  // opened rarely enough that one round trip per opening is nothing — and the
  // updater's picture is worth refreshing at the same time.
  useEffect(() => {
    refresh()
    const bridge = ipcBridge()
    if (bridge === null) return
    let live = true
    void bridge.invoke('app:get-info').then(
      (answer) => {
        if (live) setInfo(answer)
      },
      (error: unknown) => {
        console.error('app:get-info failed', error)
      }
    )
    return () => {
      live = false
    }
  }, [refresh])

  const version = info?.version ?? status.current

  return (
    <section className="flex flex-col gap-5" data-slot="about-dialog">
      <header className="flex flex-col items-center gap-1 text-center">
        <img src={mark} alt="" width={56} height={56} className="mb-1 rounded-xl" />
        <h3 className="text-heading">Respo</h3>
        <p>
          <span data-slot="about-version">Version {version === '' ? '…' : version}</span>
          {info === null ? null : (
            <>
              <br />
              <span className="text-micro">
                Electron {info.electron} · Chromium {info.chromium} · Node {info.node}
              </span>
            </>
          )}
        </p>
      </header>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
        <p className="min-w-0 text-caption text-muted-foreground" data-slot="update-summary">
          {updateSummary(status)}
        </p>
        <UpdateAction />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        <ExternalLink href={REPO_URL}>GitHub</ExternalLink>
        <ExternalLink href={ISSUES_URL}>Report an issue</ExternalLink>
        <ExternalLink href={CHANGELOG_URL}>Changelog</ExternalLink>
      </div>

      <div className="flex items-center justify-center gap-1">
        <Button variant="ghost" size="xs" onClick={() => openResource('logs')}>
          <FolderOpenIcon />
          Open logs folder
        </Button>
        <Button variant="ghost" size="xs" onClick={() => openResource('notices')}>
          Third-party notices
        </Button>
      </div>

      <p className="text-center text-micro text-muted-foreground">
        MIT licensed. Free and open source.
      </p>
    </section>
  )
}
