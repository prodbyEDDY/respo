import { MoonIcon, SunIcon } from '@heroicons/react/24/outline'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useSettings } from '@renderer/stores/settings'
import { AddressBar } from './AddressBar'
import { NavControls } from './NavControls'

/** Light/dark in one click. `system` stays reachable from the overflow menu. */
function ThemeToggle(): React.JSX.Element {
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  const setTheme = useSettings((s) => s.setTheme)

  const dark = resolvedTheme === 'dark'
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The window's single toolbar: history on the left, the address on the middle,
 * and the view controls on the right.
 *
 * Fixed 48px so the canvas geometry below it is stable — the device views are
 * native surfaces positioned against it, and a toolbar that changes height
 * would move every one of them.
 */
export function TopBar(): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
      <NavControls />
      <AddressBar />
      <div className="flex items-center gap-0.5">
        <ThemeToggle />
      </div>
    </header>
  )
}
