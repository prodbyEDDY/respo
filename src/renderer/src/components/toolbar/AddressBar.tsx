import { useEffect, useRef, useState } from 'react'
import { GlobeAltIcon } from '@heroicons/react/24/outline'
import { normalizeUrl } from '@shared/ipc'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useNavigation } from '@renderer/stores/navigation'

/** Long enough to be seen, short enough not to be an error state. */
const INVALID_HINT_MS = 1500

/**
 * The one place a session's url is typed.
 *
 * The input is uncontrolled by the store on purpose: while the field has focus
 * it belongs to the user, and a redirect landing in the store mid-sentence must
 * not rewrite what they are typing. Focus leaves, the store wins again.
 */
export function AddressBar(): React.JSX.Element {
  const url = useNavigation((s) => s.url)
  const navigate = useNavigation((s) => s.navigate)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derived, not synchronised: the field mirrors the store until the user takes
  // it over, which needs no effect and therefore cannot cascade a render.
  const value = editing ? draft : url

  useEffect(
    () => () => {
      if (invalidTimer.current !== null) clearTimeout(invalidTimer.current)
    },
    []
  )

  /**
   * Say no without getting in the way.
   *
   * A url that cannot be loaded is almost always a typo the user is about to
   * fix, so the answer is a destructive ring that fades on its own — not a
   * dialog, not a message that has to be dismissed, and not a silently ignored
   * Enter key, which is what this replaces.
   */
  const submit = (): void => {
    if (normalizeUrl(value) === null) {
      setInvalid(true)
      if (invalidTimer.current !== null) clearTimeout(invalidTimer.current)
      invalidTimer.current = setTimeout(() => setInvalid(false), INVALID_HINT_MS)
      return
    }

    setInvalid(false)
    navigate(value)
    inputRef.current?.blur()
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      {/* Favicon placeholder. Real favicons arrive with the session work. */}
      <GlobeAltIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        aria-label="Address"
        placeholder="Enter a url"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        data-invalid={invalid ? 'true' : undefined}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-8 rounded-full pr-3 pl-8 text-caption',
          // Colour only, 150ms — the field must not move (DESIGN-SYSTEM.md).
          'transition-[color,box-shadow,border-color] duration-150 ease-out',
          invalid && 'border-destructive ring-[3px] ring-destructive/30'
        )}
        onChange={(event) => {
          setDraft(event.target.value)
          // Typing is the correction; stop objecting the moment it starts.
          if (invalid) setInvalid(false)
        }}
        onFocus={(event) => {
          setDraft(url)
          setEditing(true)
          // Click-to-replace, the way every browser bar behaves.
          event.target.select()
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            submit()
            return
          }
          if (event.key === 'Escape') {
            // Drop the draft; `value` falls back to the store on the next render.
            setEditing(false)
            setInvalid(false)
            inputRef.current?.blur()
          }
        }}
      />
    </div>
  )
}
