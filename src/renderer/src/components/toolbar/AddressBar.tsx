import { useRef, useState } from 'react'
import { GlobeAltIcon } from '@heroicons/react/24/outline'
import { Input } from '@renderer/components/ui/input'
import { useNavigation } from '@renderer/stores/navigation'

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

  // Derived, not synchronised: the field mirrors the store until the user takes
  // it over, which needs no effect and therefore cannot cascade a render.
  const value = editing ? draft : url

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
        className="h-8 rounded-full pr-3 pl-8 text-caption"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setDraft(url)
          setEditing(true)
          // Click-to-replace, the way every browser bar behaves.
          event.target.select()
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            navigate(value)
            inputRef.current?.blur()
            return
          }
          if (event.key === 'Escape') {
            // Drop the draft; `value` falls back to the store on the next render.
            setEditing(false)
            inputRef.current?.blur()
          }
        }}
      />
    </div>
  )
}
