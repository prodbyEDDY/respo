import { useState } from 'react'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import type { AuthCredentials, AuthPrompt } from '@shared/ipc'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { selectChallenge, useAuth } from '@renderer/stores/auth'

type ChallengeFormProps = {
  challenge: AuthPrompt
  onRespond: (id: string, credentials: AuthCredentials | null) => void
}

/**
 * The fields, for exactly one challenge.
 *
 * Mounted with the challenge's id as its `key`, which is what makes a second
 * server asking a *new* pair of empty fields rather than the first server's
 * credentials still sitting in the form. Deliberately a remount and not an
 * effect that clears them: an effect is a chance to forget, and what would be
 * left behind is a password.
 */
function ChallengeForm({ challenge, onRespond }: ChallengeFormProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <LockClosedIcon aria-hidden="true" className="size-4 shrink-0" />
          Sign in
        </DialogTitle>
        <DialogDescription>
          {`${challenge.isProxy ? 'The proxy' : 'The server'} at ${challenge.host} is asking for a username and password.`}
        </DialogDescription>
        {challenge.realm === undefined ? null : (
          <p className="truncate text-micro text-muted-foreground" title={challenge.realm}>
            {challenge.realm}
          </p>
        )}
      </DialogHeader>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onRespond(challenge.id, { username, password })
          // Handed over; there is no reason for the renderer to keep holding it.
          setPassword('')
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auth-username" className="text-micro text-muted-foreground">
            Username
          </Label>
          <Input
            id="auth-username"
            value={username}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="h-8 text-caption"
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auth-password" className="text-micro text-muted-foreground">
            Password
          </Label>
          <Input
            id="auth-password"
            type="password"
            value={password}
            // Nothing here is saved anywhere, and inviting the platform to save
            // it would make that untrue.
            autoComplete="off"
            className="h-8 text-caption"
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRespond(challenge.id, null)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Sign in
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

/**
 * The password dialog, for the one case where a browser has to have one.
 *
 * Modal, unlike the permission prompt, and that is the honest shape: the page
 * behind it is a 401 and there is nothing to do with it until this is answered
 * or dismissed. One dialog no matter how many viewports hit the same server —
 * the coalescing happens in main (`auth.ts`).
 *
 * The credentials live in the form below and nowhere else. They are handed to
 * main on submit; nothing reaches the store, the document, or a log. Cancelling
 * is a decision, not an error: the request goes on without credentials and the
 * server answers with whatever it answers.
 */
export function AuthDialog(): React.JSX.Element {
  const challenge = useAuth(selectChallenge)
  const respond = useAuth((s) => s.respond)

  return (
    <Dialog
      open={challenge !== null}
      onOpenChange={(next) => {
        // Escape, the close button, a click on the overlay: all of them are "no
        // credentials", and all of them have to *answer* the challenge — a
        // dialog dismissed without a reply would leave the request hanging.
        if (!next && challenge !== null) respond(challenge.id, null)
      }}
    >
      <DialogContent className="max-w-sm" data-slot="auth-dialog">
        {challenge === null ? null : (
          <ChallengeForm key={challenge.id} challenge={challenge} onRespond={respond} />
        )}
      </DialogContent>
    </Dialog>
  )
}
