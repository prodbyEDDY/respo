import { useNavigation } from '@renderer/stores/navigation'
import { useNotices } from '@renderer/stores/notices'
import { ipcBridge } from './ipc'

/**
 * The browser-level gestures that are a round trip to main and a sentence back.
 *
 * Plain functions rather than a store because there is no state to keep — the
 * result is a notice, and the notice store already owns that.
 */

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
