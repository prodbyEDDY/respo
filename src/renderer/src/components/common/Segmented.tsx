import { cn } from '@renderer/lib/utils'

export type SegmentedChoice<T> = { value: T; label: string }

export type SegmentedProps<T extends string | number> = {
  /** What the group is, for assistive technology. Not rendered. */
  label: string
  value: T
  choices: readonly SegmentedChoice<T>[]
  onChange: (value: T) => void
  className?: string
}

/**
 * A segmented picker: two or four choices that are one click apart.
 *
 * A radio group rather than a row of toggles, so the control says which one is
 * on without the user inferring it from the ones that are off — and so a
 * screen reader says the same thing. Just the row: a caption above it and a
 * hint below are the caller's, because a settings dialog and a toolbar popover
 * want different amounts of both.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  choices,
  onChange,
  className
}: SegmentedProps<T>): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex gap-0.5 rounded-md bg-muted p-0.5', className)}
    >
      {choices.map((choice) => (
        <button
          key={String(choice.value)}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          tabIndex={choice.value === value ? 0 : -1}
          onKeyDown={(event) => {
            const index = choices.findIndex((item) => item.value === choice.value)
            const delta =
              event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? -1
                  : 0
            if (!delta) return
            event.preventDefault()
            const nextIndex = (index + delta + choices.length) % choices.length
            const next = choices[nextIndex]
            if (next) onChange(next.value)
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              [nextIndex]?.focus()
          }}
          onClick={() => onChange(choice.value)}
          className={cn(
            'flex flex-1 items-center justify-center rounded-sm px-2 py-0.5',
            'text-micro font-medium transition-colors duration-150 ease-out outline-none',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
            choice.value === value
              ? 'bg-card text-foreground shadow-hairline'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}
