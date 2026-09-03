import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobeAltIcon, HomeIcon } from '@heroicons/react/24/outline'
import { normalizeUrl } from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { mergeSuggestions } from '@renderer/lib/suggestions'
import { cn } from '@renderer/lib/utils'
import { useBookmarks } from '@renderer/stores/bookmarks'
import { useHistory } from '@renderer/stores/history'
import { useNavigation } from '@renderer/stores/navigation'
import { AddressSuggestions, type AddressSuggestion } from './AddressSuggestions'
import { BookmarkStar } from './BookmarkStar'

/** Long enough to be seen, short enough not to be an error state. */
const INVALID_HINT_MS = 1500

/** The listbox's id, for `aria-controls`/`aria-activedescendant`. */
const LIST_ID = 'address-suggestions'

/**
 * The one place a session's url is typed.
 *
 * The input is uncontrolled by the store on purpose: while the field has focus
 * it belongs to the user, and a redirect landing in the store mid-sentence must
 * not rewrite what they are typing. Focus leaves, the store wins again.
 *
 * Focused, it also offers where to go: bookmarks first, then the pages main
 * remembers, filtered by what is typed. The list is a listbox rather than a
 * menu because focus has to stay in the field — the arrow keys are read here
 * and the row they are on travels as `aria-activedescendant`.
 */
export function AddressBar(): React.JSX.Element {
  const url = useNavigation((s) => s.url)
  const navigate = useNavigation((s) => s.navigate)
  const homeUrl = useBookmarks((s) => s.homeUrl)
  const bookmarks = useBookmarks((s) => s.items)
  const historyRows = useHistory((s) => s.suggestions)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derived, not synchronised: the field mirrors the store until the user takes
  // it over, which needs no effect and therefore cannot cascade a render.
  const value = editing ? draft : url

  // Both halves are stored values and the merge happens here, memoized: a
  // zustand selector that built a new array every call would never compare
  // equal to itself and would re-render this until React gave up (error #185).
  const suggestions = useMemo(
    () => mergeSuggestions(editing ? draft : '', bookmarks, historyRows),
    [editing, draft, bookmarks, historyRows]
  )
  const open = listOpen && suggestions.length > 0
  const active = open && activeIndex >= 0 ? suggestions[activeIndex] : undefined

  useEffect(
    () => () => {
      if (invalidTimer.current !== null) clearTimeout(invalidTimer.current)
    },
    []
  )

  const closeList = (): void => {
    setListOpen(false)
    setActiveIndex(-1)
  }

  /**
   * Say no without getting in the way.
   *
   * A url that cannot be loaded is almost always a typo the user is about to
   * fix, so the answer is a destructive ring that fades on its own — not a
   * dialog, not a message that has to be dismissed, and not a silently ignored
   * Enter key, which is what this replaces.
   */
  const submit = (input: string): void => {
    if (normalizeUrl(input) === null) {
      setInvalid(true)
      if (invalidTimer.current !== null) clearTimeout(invalidTimer.current)
      invalidTimer.current = setTimeout(() => setInvalid(false), INVALID_HINT_MS)
      return
    }

    setInvalid(false)
    closeList()
    navigate(input)
    inputRef.current?.blur()
  }

  const pick = (item: AddressSuggestion): void => {
    setDraft(item.url)
    submit(item.url)
  }

  /** Arrow keys walk the list; `-1` is "load what is actually typed". */
  const move = (delta: number): void => {
    if (!open) {
      setListOpen(true)
      return
    }
    const last = suggestions.length - 1
    const next = activeIndex + delta
    setActiveIndex(next < -1 ? last : next > last ? -1 : next)
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <GlobeAltIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        data-slot="address-input"
        aria-label="Address"
        placeholder="Enter a url"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        {...(active === undefined ? {} : { 'aria-activedescendant': `${LIST_ID}-${activeIndex}` })}
        data-invalid={invalid ? 'true' : undefined}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-8 rounded-full pl-8 text-caption',
          // Room for the star, and for the home button when there is one.
          homeUrl === '' ? 'pr-9' : 'pr-16',
          // Colour only, 150ms — the field must not move (DESIGN-SYSTEM.md).
          'transition-[color,box-shadow,border-color] duration-150 ease-out',
          invalid && 'border-destructive ring-[3px] ring-destructive/30'
        )}
        onChange={(event) => {
          setDraft(event.target.value)
          setActiveIndex(-1)
          setListOpen(true)
          // Debounced inside the store: a keystroke is not a message, a pause
          // in typing is (CLAUDE.md §4).
          useHistory.getState().setQuery(event.target.value)
          // Typing is the correction; stop objecting the moment it starts.
          if (invalid) setInvalid(false)
        }}
        onFocus={(event) => {
          setDraft(url)
          setEditing(true)
          setListOpen(true)
          setActiveIndex(-1)
          // An empty query answers with the most recent pages, which is what a
          // freshly focused address bar should be offering.
          useHistory.getState().refresh('')
          // Click-to-replace, the way every browser bar behaves.
          event.target.select()
        }}
        onBlur={() => {
          setEditing(false)
          closeList()
          useHistory.getState().reset()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            move(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (event.key === 'Enter') {
            submit(active?.url ?? value)
            return
          }
          if (event.key === 'Escape') {
            // Innermost surface first: the list is what Escape closes while it
            // is open, and only then does a second press drop the draft.
            if (open) {
              closeList()
              return
            }
            // `value` falls back to the store on the next render.
            setEditing(false)
            setInvalid(false)
            inputRef.current?.blur()
          }
        }}
      />

      <div className="absolute right-1 flex items-center gap-0.5">
        {homeUrl === '' ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Go to your home page"
                className="rounded-full"
                onClick={() => navigate(homeUrl)}
              >
                <HomeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Home — {homeUrl}</TooltipContent>
          </Tooltip>
        )}
        <BookmarkStar />
      </div>

      {open ? (
        <AddressSuggestions
          id={LIST_ID}
          items={suggestions}
          activeIndex={activeIndex}
          onPick={pick}
          onHover={setActiveIndex}
        />
      ) : null}
    </div>
  )
}
