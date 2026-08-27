import { Button } from '@renderer/components/ui/button'
import { useSettings, type Theme } from '@renderer/stores/settings'

const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/**
 * Temporary theme switcher. Replaced by the real settings surface in W1/T7.
 */
function ThemeSwitcher(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {THEMES.map((option) => (
        <Button
          key={option}
          size="xs"
          variant={theme === option ? 'default' : 'ghost'}
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
          className="capitalize"
        >
          {option}
        </Button>
      ))}
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-heading-lg font-semibold text-foreground">Respo</h1>
        <p className="text-body text-muted-foreground">
          Responsive web development across every viewport at once.
        </p>
      </div>
      <ThemeSwitcher />
    </main>
  )
}

export default App
