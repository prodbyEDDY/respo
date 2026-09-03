import type { ClearTarget } from '@shared/ipc'
import { useNavigation } from '@renderer/stores/navigation'
import { useNotices } from '@renderer/stores/notices'
import { ipcBridge } from './ipc'

/**
 * The two browser-level gestures that are a round trip to main and a sentence
 * back: clearing a site's data, and opening a local page.
 *
 * Plain functions rather than a store because there is no state to keep — the
 * result is a notice, and the notice store already owns that.
 */

/** What one target is called in the sentence the toolbar shows. */
const CLEARED: Record<ClearTarget, string> = {
  storage: 'storage',
  cookies: 'cookies',
  cache: 'the cache',
  all: 'storage, cookies and the cache'
}

/** `https://example.com` reads better as `example.com` in a one-line notice. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/**
 * Ask main to forget something, and say what happened.
 *
 * The *kind* travels, never an origin: main is the side that knows what the
 * views are showing, and it is the side that decides whose data this is
 * (`main/clear-data.ts`). Every view is reloaded on the other side of a
 * successful clear.
 */
export async function clearBrowsingData(target: ClearTarget): Promise<void> {
  const bridge = ipcBridge()
  const notices = useNotices.getState()
  if (bridge === null) return

  try {
    const result = await bridge.invoke('data:clear', target)
    if (!result.ok) {
      notices.say(
        'error',
        result.reason === 'no-origin'
          ? 'There is no site here to clear.'
          : 'Clearing failed — nothing was removed.'
      )
      return
    }

    notices.say(
      'ok',
      result.origin === null
        ? `Cleared ${CLEARED[target]}`
        : `Cleared ${CLEARED[target]} for ${hostOf(result.origin)}`
    )
  } catch (error) {
    console.error('data:clear failed', error)
    notices.say('error', 'Clearing failed — nothing was removed.')
  }
}

/**
 * Open a local page through main's file dialog.
 *
 * Main runs the dialog and hands back a `file:` url, already through the scheme
 * filter — the renderer never learns or names a path (CLAUDE.md §7). Dismissing
 * the dialog is a decision, not a failure, and says nothing.
 */
export async function openLocalFile(): Promise<void> {
  const bridge = ipcBridge()
  if (bridge === null) return

  try {
    const url = await bridge.invoke('file:open')
    if (url === null) return
    useNavigation.getState().navigate(url)
  } catch (error) {
    console.error('file:open failed', error)
    useNotices.getState().say('error', 'That file could not be opened.')
  }
}
