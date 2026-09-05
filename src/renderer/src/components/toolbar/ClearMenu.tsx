import { TrashIcon } from '@heroicons/react/24/outline'
import type { ClearTarget } from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { clearBrowsingData } from '@renderer/lib/browsing'

/**
 * Forget this site's data, in one menu.
 *
 * One control rather than four buttons: clearing is something a developer does
 * often but never *urgently*, and four destructive icons in a toolbar is four
 * chances to hit the wrong one. The chords beside each row are the fast path
 * for the person who does this twenty times an hour.
 *
 * The renderer names the kind and nothing else — which site's data this is, is
 * main's answer, from the url the views are actually on (`main/clear-data.ts`).
 */
type ClearItem = { target: ClearTarget; label: string; chord: string }

const ITEMS: readonly ClearItem[] = [
  { target: 'storage', label: 'Storage', chord: 'Ctrl Alt Q' },
  { target: 'cookies', label: 'Cookies', chord: 'Ctrl Alt A' },
  { target: 'cache', label: 'Cache', chord: 'Ctrl Alt Z' }
]

export function ClearMenu(): React.JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Clear browsing data">
              <TrashIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Clear storage, cookies or the cache</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Clear for this site</DropdownMenuLabel>
        {ITEMS.map((item) => (
          <DropdownMenuItem key={item.target} onSelect={() => void clearBrowsingData(item.target)}>
            {item.label}
            <DropdownMenuShortcut>{item.chord}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-status-error focus:text-status-error"
          onSelect={() => void clearBrowsingData('all')}
        >
          Everything
          <DropdownMenuShortcut>Ctrl Alt ⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
