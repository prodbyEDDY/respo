/**
 * Which page the session is *on*, as main sees it.
 *
 * Respo drives one page across many viewports, so "the current url" is not a
 * property of any one view — but two features in main need a single answer to
 * it: history records the page that was visited (once, not once per device),
 * and a clear needs the origin whose data is about to be deleted.
 *
 * The answer is the same one the address bar gives: the *leading* view — the
 * first device to report — is the one whose url counts. Five devices reporting
 * five redirect chains do not make five history entries, and a follower that
 * lags a navigation by a frame cannot decide whose cookies get cleared.
 *
 * Fed from the already-batched load events (CLAUDE.md §4); it costs one pass
 * over a batch that was going to be sent anyway.
 */

import type { LoadStatePayload } from '@shared/ipc'

/** A page worth remembering: the lead settled on it, and it is new. */
export type LeadPage = { url: string; title: string }

export type LeadTracker = {
  /**
   * Fold one batch in. Answers with the page to record, when the lead just
   * arrived somewhere it was not — and `null` the rest of the time, which is
   * most of the time.
   */
  apply(batch: readonly LoadStatePayload[]): LeadPage | null
  /** Drop a lead that left the canvas, so the next report re-elects one. */
  retain(deviceIds: readonly string[]): void
  /** The lead's url, or `null` before anything has loaded. */
  url(): string | null
  /** The device the address bar is following, for tests and diagnostics. */
  leadDeviceId(): string | null
}

export function createLeadTracker(): LeadTracker {
  let lead: string | null = null
  let url: string | null = null
  let recordedUrl: string | null = null
  let recordedTitle = ''

  return {
    apply(batch): LeadPage | null {
      let page: LeadPage | null = null

      for (const payload of batch) {
        // The first device to speak leads, exactly as in the renderer's store.
        lead ??= payload.deviceId
        if (payload.deviceId !== lead || payload.url === '') continue

        // Any state moves the url — a failed load is still where the session
        // is, and clearing that site's data is a reasonable thing to want.
        url = payload.url
        if (payload.state !== 'ready') continue

        const title = payload.title ?? ''
        // A title arriving after the url it belongs to is the same visit, but
        // it is worth passing on: the history entry it updates was written
        // before the page had said what it was called.
        if (payload.url === recordedUrl && title === recordedTitle) continue
        recordedUrl = payload.url
        recordedTitle = title
        page = { url: payload.url, title }
      }

      return page
    },

    retain(deviceIds): void {
      if (lead === null || deviceIds.includes(lead)) return
      lead = null
      // The url stays: the canvas is still showing that page until something
      // else loads, and a lead election is not a navigation.
    },

    url: () => url,
    leadDeviceId: () => lead
  }
}
