import { GlobeAltIcon, StarIcon } from '@heroicons/react/24/outline'
import { cn } from '@renderer/lib/utils'

/**
 * One row under the address bar.
 *
 * Two sources, one list: pages the user kept, and pages they have been. `kind`
 * is only what the row is *marked* with — a star or a globe — because the
 * distinction matters when choosing but not when it lands: both are a url the
 * bar is about to load.
 */
export type AddressSuggestion = {
  kind: 'bookmark' | 'history'
  url: string
  title: string
  /** The site's own icon as a `data:` url, when main has one cached. */
  favicon?: string
}

export type AddressSuggestionsProps = {
  id: string
  items: readonly AddressSuggestion[]
  /** The row arrow keys are on, or `-1` for "none — Enter loads what is typed". */
  activeIndex: number
  onPick: (item: AddressSuggestion) => void
  onHover: (index: number) => void
}

/**
 * The list itself.
 *
 * Not a Radix menu, deliberately: this is a *listbox* attached to a text field
 * the user is still typing in, so focus must stay in the input and the arrow
 * keys have to be read there (`aria-activedescendant`). A menu would take focus
 * and turn every keystroke after the first arrow into a type-ahead search.
 */
export function AddressSuggestions({
  id,
  items,
  activeIndex,
  onPick,
  onHover
}: AddressSuggestionsProps): React.JSX.Element | null {
  if (items.length === 0) return null

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Suggestions"
      className={cn(
        'absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg',
        'border border-border bg-popover p-1 text-popover-foreground shadow-soft',
        // Motion budget: transform/opacity only, 150ms (DESIGN-SYSTEM.md).
        'origin-top duration-150 ease-out animate-in fade-in-0 zoom-in-95'
      )}
    >
      {items.map((item, index) => (
        <li
          key={`${item.kind}:${item.url}`}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          data-active={index === activeIndex ? 'true' : undefined}
          className={cn(
            'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5',
            'transition-colors duration-100 ease-out',
            index === activeIndex && 'bg-accent text-accent-foreground'
          )}
          // The list lives under a focused input, and a plain click would blur
          // it — closing the list — before the click could land.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(item)}
        >
          {item.favicon === undefined ? (
            item.kind === 'bookmark' ? (
              <StarIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
            ) : (
              <GlobeAltIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            // `data:` only — main downloads the icon through the device session
            // and hands over the bytes, so the toolbar never fetches anything.
            <img src={item.favicon} alt="" className="size-4 shrink-0 rounded-xs" />
          )}

          <span className="min-w-0 flex-1 truncate text-caption">
            {item.title === '' ? item.url : item.title}
          </span>
          <span className="max-w-[45%] truncate text-micro text-muted-foreground">{item.url}</span>
        </li>
      ))}
    </ul>
  )
}
