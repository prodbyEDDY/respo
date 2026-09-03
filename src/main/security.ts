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
 * The half of `PermissionsManager` this module needs.
 *
 * Narrow on purpose: the policy — who may use a camera, and whether anyone was
 * asked — is a decision, and decisions do not belong in the file whose job is to
 * hand Chromium a callback (`permissions.ts`).
 */
export interface PermissionGate {
  request(
    origin: string | null,
    permission: string,
    mediaTypes: readonly string[] | undefined,
    callback: (granted: boolean) => void
  ): void
  check(origin: string | null, permission: string, mediaType?: string): boolean
}

/**
 * Route the device session's permission questions through Respo's own policy.
 *
 * Without a handler Chromium's defaults apply and some permissions are granted
 * without anyone being asked, so a handler is mandatory. `gate` is `null` only
 * when there is no policy to consult — before the store exists, or in a test —
 * and then the answer is the W1 one: no, to everything.
 *
 * Note which side names the origin. Chromium reports the *requesting* url with
 * every question, and that — not whatever the toolbar happens to be showing —
 * is what a decision is remembered under: a third-party frame asking for a
 * location is asking on its own behalf.
 */
export function installDevicePermissionHandlers(gate: PermissionGate | null = null): void {
  const devices = session.fromPartition(DEVICE_PARTITION)

  devices.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (gate === null) {
      callback(false)
      return
    }
    // Electron's details type is a union — only a media request carries media
    // types — and a build where a member lacks `requestingUrl` must degrade to
    // the page's own url rather than fail to compile.
    const requestingUrl: string | undefined = details.requestingUrl
    const mediaTypes: readonly string[] | undefined =
      'mediaTypes' in details ? details.mediaTypes : undefined
    const requesting =
      requestingUrl === undefined || requestingUrl === ''
        ? (webContents?.getURL() ?? null)
        : requestingUrl
    gate.request(requesting, permission, mediaTypes, callback)
  })

  devices.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (gate === null) return false
    // `unknown` is Chromium saying it does not know which stream is being asked
    // about, which is not a question `media` can be answered from.
    const mediaType = details.mediaType === 'unknown' ? undefined : details.mediaType
    return gate.check(requestingOrigin, permission, mediaType)
  })
}
