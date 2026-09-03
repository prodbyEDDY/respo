import { useMemo, useState } from 'react'
import { StarIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { normalizeUrl } from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useBookmarks } from '@renderer/stores/bookmarks'
import { selectPageTitle, useNavigation } from '@renderer/stores/navigation'

/**
 * Save this page, and say what it is called.
 *
 * The star behaves the way a browser's does, because that is the behaviour
 * people already have: clicking it on a page that is not saved *saves it* and
 * opens the editor on what was just saved, so the gesture is one click and the
 * name is still there to fix. Clicking it on a page that is saved opens the
 * same editor. Un-saving is "Remove" inside it, or `mod+d` — a control whose
 * click sometimes destroys the thing it is pointing at is not a control anyone
 * can use quickly.
 *
 * Edits are committed when the editor closes rather than per keystroke: the
 * document is written through main behind a debounce, and typing a name is not
 * twelve saves.
 */
export function BookmarkStar(): React.JSX.Element {
  const url = useNavigation((s) => s.url)
  const pageTitle = useNavigation(selectPageTitle)
  // Subscribed to the stored list and derived here: a selector that built its
  // answer per call would never compare equal to itself, and zustand would
  // re-render this until React gave up (React error #185).
  const items = useBookmarks((s) => s.items)
  const bookmark = useMemo(() => items.find((item) => item.url === url) ?? null, [items, url])

  const add = useBookmarks((s) => s.add)
  const update = useBookmarks((s) => s.update)
  const remove = useBookmarks((s) => s.remove)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  /** True while the editor is showing a bookmark this click just created. */
  const [justAdded, setJustAdded] = useState(false)

  const saved = bookmark !== null
  const loadable = normalizeUrl(url) !== null
  const label = saved ? 'Edit this bookmark' : 'Bookmark this page (Ctrl+D)'

  const commit = (): void => {
    if (editingId === null) return
    update(editingId, { title: draftTitle, url: draftUrl })
  }

  const openChange = (next: boolean): void => {
    if (!next) {
      commit()
      setOpen(false)
      setEditingId(null)
      return
    }

    // Saving *is* opening: there is nothing to edit until the page is kept.
    const target = bookmark ?? add(url, pageTitle)
    if (target === null) return
    setJustAdded(bookmark === null)
    setEditingId(target.id)
    setDraftTitle(target.title)
    setDraftUrl(target.url)
    setOpen(true)
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              aria-pressed={saved}
              data-bookmarked={saved ? 'true' : 'false'}
              disabled={!loadable}
              className={cn('rounded-full', saved && 'text-primary hover:text-primary')}
            >
              {saved ? <StarIconSolid /> : <StarIcon />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            openChange(false)
          }}
        >
          <p className="text-caption font-medium text-foreground">
            {justAdded ? 'Bookmark added' : 'Edit bookmark'}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bookmark-name" className="text-micro text-muted-foreground">
              Name
            </Label>
            <Input
              id="bookmark-name"
              value={draftTitle}
              autoFocus
              spellCheck={false}
              placeholder="Untitled"
              className="h-8 text-caption"
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bookmark-url" className="text-micro text-muted-foreground">
              URL
            </Label>
            <Input
              id="bookmark-url"
              value={draftUrl}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              aria-invalid={normalizeUrl(draftUrl) === null || undefined}
              className="h-8 text-caption"
              onChange={(event) => setDraftUrl(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-status-error hover:text-status-error"
              onClick={() => {
                if (editingId !== null) remove(editingId)
                setEditingId(null)
                setOpen(false)
              }}
            >
              Remove
            </Button>
            <Button type="submit" size="sm">
              Done
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
