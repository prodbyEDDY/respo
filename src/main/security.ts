/**
 * Main-process security policy (spec §7a).
 *
 * Everything here guards a boundary where a *page* — not the user — gets to
 * hand main an argument: a popup url, a permission request. The rule is the
 * same in both cases: nothing the page asks for is granted implicitly.
 */

import { session, shell } from 'electron'

/**
 * The session every device view shares. Declared here so the permission policy
 * and the view `webPreferences` can never drift onto two different partitions.
 */
export const DEVICE_PARTITION = 'persist:respo'

/** The only schemes Respo will ever hand to the operating system. */
const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Open a url in the user's default browser — but only when it is a web url.
 *
 * `shell.openExternal` passes its argument to the OS handler, so an unfiltered
 * call is a remote code lever: a page that calls `window.open()` with an
 * `ms-msdt:`, `smb:` or `file:` url gets whatever Windows has registered for
 * that scheme, launched with the user's own privileges. Anything that is not
 * http(s) is dropped silently — a page's popup is not worth a dialog.
 */
export function openExternalSafe(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return
  void shell.openExternal(parsed.href)
}

/**
 * Deny every permission the device session asks for.
 *
 * Without a handler Chromium's defaults apply and some permissions are granted
 * without anyone being asked. Respo grants nothing silently; the ask-UI that
 * lets the user say yes per origin arrives in a later wave, and until then
 * "no" is the only correct answer.
 */
export function installDevicePermissionHandlers(): void {
  const devices = session.fromPartition(DEVICE_PARTITION)
  devices.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  devices.setPermissionCheckHandler(() => false)
}
