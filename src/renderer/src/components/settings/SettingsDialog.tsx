import { useState, type ComponentType, type RefObject } from 'react'
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  CircleStackIcon,
  CodeBracketIcon,
  ComputerDesktopIcon,
  InformationCircleIcon,
  RectangleGroupIcon
} from '@heroicons/react/24/outline'
import { AboutContent } from '@renderer/components/about/AboutDialog'
import { Segmented } from '@renderer/components/common/Segmented'
import { EmulateForm } from '@renderer/components/toolbar/EmulatePopover'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { clearBrowsingData, openLocalFile } from '@renderer/lib/browsing'
import { cn } from '@renderer/lib/utils'
import { useBookmarks } from '@renderer/stores/bookmarks'
import { useDebug } from '@renderer/stores/debug'
import { useDevices } from '@renderer/stores/devices'
import { useGuides } from '@renderer/stores/guides'
import { useHistory } from '@renderer/stores/history'
import { useLayout } from '@renderer/stores/layout'
import { useNavigation } from '@renderer/stores/navigation'
import { useNotices } from '@renderer/stores/notices'
import { usePanels } from '@renderer/stores/panels'
import { useSettings } from '@renderer/stores/settings'
import { useSync } from '@renderer/stores/sync'
import { AutoUpdateCheck, InsecureCertificates, ScreenshotSettings } from './ScreenshotSettings'

type SettingsSection =
  'general' | 'canvas' | 'emulation' | 'developer' | 'screenshots' | 'data' | 'about'
const SECTIONS = [
  {
    id: 'general',
    label: 'General',
    icon: ComputerDesktopIcon,
    description: 'Make Respo feel at home.',
    keywords: 'appearance theme dark light system home startup'
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: RectangleGroupIcon,
    description: 'Arrange previews and control how they work together.',
    keywords: 'layout horizontal column rows masonry zoom rotate sync mirror'
  },
  {
    id: 'emulation',
    label: 'Emulation',
    icon: AdjustmentsHorizontalIcon,
    description: 'Test websites in different environments. Applies to every device.',
    keywords:
      'color scheme dark light media print vision network location locale timezone motion contrast'
  },
  {
    id: 'developer',
    label: 'Developer tools',
    icon: CodeBracketIcon,
    description: 'Inspect layouts and configure your development environment.',
    keywords: 'devtools dock rulers guides outline debug certificates security'
  },
  {
    id: 'screenshots',
    label: 'Screenshots',
    icon: ArrowDownTrayIcon,
    description: 'Choose where captures go and how they look.',
    keywords: 'capture png jpeg folder format pixel density dpr'
  },
  {
    id: 'data',
    label: 'Browsing data',
    icon: CircleStackIcon,
    description: 'Manage saved pages and clear website data.',
    keywords: 'bookmarks history storage cache cookies file'
  },
  {
    id: 'about',
    label: 'About & updates',
    icon: InformationCircleIcon,
    description: 'Version, updates and project information.',
    keywords: 'version update automatic github logs license'
  }
] as const

function Group({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-6 last:border-0 last:pb-0">
      <div>
        <h3 className="text-body font-medium">{title}</h3>
        {hint && <p className="mt-1 text-caption text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <Label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span>{label}</span>
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
    </Label>
  )
}
function General(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const home = useBookmarks((s) => s.homeUrl)
  const url = useNavigation((s) => s.url)
  const setHome = useBookmarks((s) => s.setHome)
  return (
    <>
      <Group
        title="App appearance"
        hint="Changes Respo's interface. Website color schemes are controlled in Emulation."
      >
        <Segmented
          label="App appearance"
          value={theme}
          choices={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          onChange={setTheme}
        />
      </Group>
      <Group title="Home page" hint="The page to open when Respo starts.">
        <p className="break-all rounded-lg bg-muted/50 p-3 text-caption text-muted-foreground">
          {home || 'Default start page'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!url} onClick={() => setHome(url)}>
            Set this page as home
          </Button>
          <Button size="sm" variant="ghost" disabled={!home} onClick={() => setHome('')}>
            Clear home page
          </Button>
        </div>
      </Group>
    </>
  )
}
function CanvasSettings(): React.JSX.Element {
  const mode = useLayout((s) => s.mode)
  const zoom = useLayout((s) => s.zoom)
  const sync = useSync((s) => s.globalEnabled)
  const layouts = [
    { value: 'flex', label: 'Flexible rows', hint: 'Wrap to fit the window.' },
    { value: 'horizontal', label: 'Horizontal row', hint: 'One row. Scroll the canvas sideways.' },
    { value: 'column', label: 'Column', hint: 'One device below another.' },
    { value: 'masonry', label: 'Masonry', hint: 'Compact columns with fewer gaps.' },
    { value: 'individual', label: 'One device', hint: 'Focus on a single screen.' }
  ] as const
  return (
    <>
      <Group title="Preview layout">
        <div
          role="radiogroup"
          aria-label="Preview layout"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {layouts.map((layout) => (
            <Button
              key={layout.value}
              role="radio"
              aria-checked={mode === layout.value}
              tabIndex={mode === layout.value ? 0 : -1}
              onKeyDown={(event) => {
                const delta = ['ArrowRight', 'ArrowDown'].includes(event.key)
                  ? 1
                  : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                    ? -1
                    : 0
                if (!delta) return
                event.preventDefault()
                const next =
                  (layouts.findIndex((item) => item.value === layout.value) +
                    delta +
                    layouts.length) %
                  layouts.length
                const nextLayout = layouts[next]
                if (nextLayout) useLayout.getState().setMode(nextLayout.value)
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                  [next]?.focus()
              }}
              variant="outline"
              className={cn(
                'h-auto items-start justify-start whitespace-normal p-3 text-left',
                mode === layout.value && 'border-primary bg-primary/5'
              )}
              onClick={() => useLayout.getState().setMode(layout.value)}
            >
              <span>
                <span className="block text-caption font-medium">{layout.label}</span>
                <span className="mt-1 block text-micro font-normal text-muted-foreground">
                  {layout.hint}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </Group>
      <Group
        title="Canvas zoom"
        hint="Resize previews without changing the website's viewport. Ctrl + mouse wheel also works."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => useLayout.getState().zoomOut()}>
            Zoom out
          </Button>
          <output className="min-w-14 text-center text-caption tabular-nums">
            {Math.round(zoom * 100)}%
          </output>
          <Button variant="outline" size="sm" onClick={() => useLayout.getState().zoomIn()}>
            Zoom in
          </Button>
          <Button variant="ghost" size="sm" onClick={() => useLayout.getState().resetZoom()}>
            Reset zoom
          </Button>
        </div>
      </Group>
      <Group title="Devices">
        <Toggle
          label="Mirror interactions across devices"
          checked={sync}
          onChange={() => useSync.getState().toggleGlobal()}
        />
        <Button
          className="self-start"
          variant="outline"
          size="sm"
          onClick={() => useLayout.getState().rotateAll()}
        >
          Rotate all devices
        </Button>
      </Group>
    </>
  )
}
function Developer(): React.JSX.Element {
  const dock = usePanels((s) => s.dock)
  const active = useDevices((s) => s.active)
  const rulers = useGuides((s) => s.rulers)
  const outline = useDebug((s) => s.outline)
  return (
    <>
      <Group title="DevTools position">
        <Segmented
          label="DevTools position"
          value={dock}
          choices={[
            { value: 'bottom', label: 'Bottom' },
            { value: 'right', label: 'Right' },
            { value: 'undocked', label: 'Separate window' }
          ]}
          onChange={(value) => usePanels.getState().setDock(value)}
        />
      </Group>
      <Group title="Layout helpers">
        <Toggle
          label="Rulers on all devices"
          checked={active.length > 0 && active.every((d) => rulers[d.id])}
          onChange={(value) =>
            useGuides.getState().setRulersAll(
              active.map((d) => d.id),
              value
            )
          }
        />
        <Toggle
          label="Outline all elements"
          checked={outline}
          onChange={(value) => useDebug.getState().setOutline(value)}
        />
      </Group>
      <Group title="Security">
        <InsecureCertificates />
      </Group>
    </>
  )
}
function DataSettings({ onNavigate }: { onNavigate: () => void }): React.JSX.Element {
  const notice = useNotices((s) => s.notice)
  const bookmarks = useBookmarks((s) => s.items)
  return (
    <>
      <Group title="Saved pages">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            onNavigate()
            void openLocalFile()
          }}
        >
          Open file…
        </Button>
        {bookmarks.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            No bookmarks yet. Save a page with the star in the address bar.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {bookmarks.map((b) => (
              <Button
                variant="ghost"
                className="justify-start overflow-hidden"
                key={b.id}
                onClick={() => {
                  onNavigate()
                  useNavigation.getState().navigate(b.url)
                }}
              >
                <span className="truncate">{b.title || b.url}</span>
              </Button>
            ))}
          </div>
        )}
      </Group>
      <Group
        title="Clear website data"
        hint="Storage and cookies apply to the current website. Cache is shared across all websites."
      >
        <div className="flex flex-wrap gap-2">
          {(['storage', 'cookies', 'cache', 'all'] as const).map((target) => (
            <Button
              key={target}
              variant="outline"
              size="sm"
              onClick={() => void clearBrowsingData(target)}
            >
              {target === 'all' ? 'Clear all site data' : `Clear ${target}`}
            </Button>
          ))}
        </div>
      </Group>
      {notice && (
        <p
          role="status"
          className={cn(
            'text-caption',
            notice.tone === 'error' ? 'text-status-error' : 'text-muted-foreground'
          )}
        >
          {notice.text}
        </p>
      )}
      <Group title="Browsing history">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => useHistory.getState().clear()}
        >
          Clear history
        </Button>
      </Group>
    </>
  )
}
function About(): React.JSX.Element {
  return (
    <>
      <AboutContent />
      <AutoUpdateCheck />
    </>
  )
}
const PANELS: Record<SettingsSection, ComponentType<{ onNavigate: () => void }>> = {
  general: General,
  canvas: CanvasSettings,
  emulation: EmulateForm,
  developer: Developer,
  screenshots: ScreenshotSettings,
  data: DataSettings,
  about: About
}

export function SettingsDialog({
  open,
  onOpenChange,
  triggerRef
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('general')
  const [query, setQuery] = useState('')
  const current = SECTIONS.find((s) => s.id === section)!
  const filtered = SECTIONS.filter((s) =>
    `${s.label} ${s.keywords}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  const Panel = PANELS[section]
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) setQuery('')
      }}
    >
      <DialogContent
        className="settings-shell"
        aria-describedby="settings-description"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <aside className="settings-sidebar">
          <DialogTitle className="px-2 text-heading">Settings</DialogTitle>
          <DialogDescription id="settings-description" className="sr-only">
            Preferences are saved automatically.
          </DialogDescription>
          <Input
            aria-label="Search settings"
            placeholder="Find a setting…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <nav aria-label="Settings sections" className="settings-navigation">
            {filtered.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                aria-current={section === item.id ? 'page' : undefined}
                className={cn(
                  'w-full justify-start',
                  section === item.id && 'bg-accent text-accent-foreground'
                )}
                onClick={() => {
                  setSection(item.id)
                  setQuery('')
                }}
              >
                <item.icon />
                {item.label}
              </Button>
            ))}
            {filtered.length === 0 && (
              <p className="p-2 text-caption text-muted-foreground">No matching settings.</p>
            )}
          </nav>
          <Label className="settings-mobile-nav">
            Section
            <select
              aria-label="Settings section"
              value={section}
              onChange={(event) => setSection(event.target.value as SettingsSection)}
            >
              {SECTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Label>
          <p className="settings-saved text-micro text-muted-foreground">
            Changes saved automatically
          </p>
        </aside>
        <div className="settings-main" data-settings-panel>
          <header className="settings-heading">
            <h2 className="text-heading">{current.label}</h2>
            <p className="mt-1 text-caption text-muted-foreground">{current.description}</p>
          </header>
          <div className="settings-content" key={section}>
            <Panel onNavigate={() => onOpenChange(false)} />
          </div>
          <footer className="flex shrink-0 justify-end border-t border-border px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
