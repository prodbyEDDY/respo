import { describe, expect, it } from 'vitest'
import type { LoadStatePayload } from '@shared/ipc'
import { createLeadTracker } from '../lead-tracker'

function payload(deviceId: string, over: Partial<LoadStatePayload> = {}): LoadStatePayload {
  return { deviceId, state: 'ready', url: 'https://example.com/', ...over }
}

describe('createLeadTracker', () => {
  it('follows the first device to report', () => {
    const lead = createLeadTracker()
    lead.apply([payload('b'), payload('a')])

    expect(lead.leadDeviceId()).toBe('b')
  })

  it('answers with the page the lead settled on', () => {
    const lead = createLeadTracker()

    expect(lead.apply([payload('a', { title: 'Example' })])).toEqual({
      url: 'https://example.com/',
      title: 'Example'
    })
  })

  it('records one visit for five viewports', () => {
    const lead = createLeadTracker()
    const batch = ['a', 'b', 'c', 'd', 'e'].map((id) => payload(id, { title: 'Example' }))

    // One page across many viewports is one page.
    expect(lead.apply(batch)).toEqual({ url: 'https://example.com/', title: 'Example' })
    expect(lead.apply(batch)).toBeNull()
  })

  it('says nothing for a page that is still loading', () => {
    const lead = createLeadTracker()

    expect(lead.apply([payload('a', { state: 'loading' })])).toBeNull()
  })

  it('passes on a title that arrived after the url it belongs to', () => {
    const lead = createLeadTracker()
    lead.apply([payload('a')])

    expect(lead.apply([payload('a', { title: 'Example' })])).toEqual({
      url: 'https://example.com/',
      title: 'Example'
    })
  })

  it('ignores a follower that went somewhere of its own', () => {
    const lead = createLeadTracker()
    lead.apply([payload('a')])

    expect(lead.apply([payload('b', { url: 'https://other.test/' })])).toBeNull()
    expect(lead.url()).toBe('https://example.com/')
  })

  it('follows a failed load too — it is still where the session is', () => {
    const lead = createLeadTracker()
    lead.apply([payload('a', { state: 'failed', url: 'https://broken.test/' })])

    expect(lead.url()).toBe('https://broken.test/')
  })

  it('has no url before anything has loaded', () => {
    expect(createLeadTracker().url()).toBeNull()
  })

  it('re-elects when the lead leaves the canvas', () => {
    const lead = createLeadTracker()
    lead.apply([payload('a')])
    lead.retain(['b', 'c'])

    expect(lead.leadDeviceId()).toBeNull()
    lead.apply([payload('b', { url: 'https://second.test/' })])
    expect(lead.leadDeviceId()).toBe('b')
    expect(lead.url()).toBe('https://second.test/')
  })

  it('keeps the lead when it is still on the canvas', () => {
    const lead = createLeadTracker()
    lead.apply([payload('a')])
    lead.retain(['a', 'b'])

    expect(lead.leadDeviceId()).toBe('a')
  })

  it('keeps the page the canvas is showing when the lead is re-elected', () => {
    const lead = createLeadTracker()
    lead.apply([payload('a', { url: 'https://example.com/' })])
    lead.retain([])

    // A lead election is not a navigation: the frames are still on that page.
    expect(lead.url()).toBe('https://example.com/')
  })

  it('ignores an empty url, which is a view that has not committed anything', () => {
    const lead = createLeadTracker()

    expect(lead.apply([payload('a', { url: '' })])).toBeNull()
    expect(lead.leadDeviceId()).toBe('a')
    expect(lead.url()).toBeNull()
  })
})
