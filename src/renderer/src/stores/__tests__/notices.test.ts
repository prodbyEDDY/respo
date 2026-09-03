import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_NOTICE_MS, NOTICE_MS, useNotices } from '../notices'

describe('notices store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useNotices.setState({ notice: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says one line', () => {
    useNotices.getState().say('ok', 'Bookmark added')

    expect(useNotices.getState().notice).toMatchObject({ tone: 'ok', text: 'Bookmark added' })
  })

  it('takes itself away', () => {
    useNotices.getState().say('ok', 'Bookmark added')
    vi.advanceTimersByTime(NOTICE_MS)

    expect(useNotices.getState().notice).toBeNull()
  })

  it('leaves a refusal up for longer — it usually names something to do next', () => {
    useNotices.getState().say('error', 'Clearing failed')
    vi.advanceTimersByTime(NOTICE_MS)
    expect(useNotices.getState().notice).not.toBeNull()

    vi.advanceTimersByTime(ERROR_NOTICE_MS - NOTICE_MS)
    expect(useNotices.getState().notice).toBeNull()
  })

  it('lets the newest one win', () => {
    useNotices.getState().say('ok', 'first')
    useNotices.getState().say('ok', 'second')

    expect(useNotices.getState().notice?.text).toBe('second')
  })

  it('never lets a stale timer take down the notice that replaced it', () => {
    useNotices.getState().say('ok', 'first')
    vi.advanceTimersByTime(NOTICE_MS - 1)
    useNotices.getState().say('ok', 'second')
    vi.advanceTimersByTime(1)

    expect(useNotices.getState().notice?.text).toBe('second')
  })

  it('is dismissed by the user too', () => {
    useNotices.getState().say('ok', 'first')
    useNotices.getState().dismiss()

    expect(useNotices.getState().notice).toBeNull()
  })

  it('ignores a dismissal aimed at a notice that is already gone', () => {
    useNotices.getState().say('ok', 'first')
    const stale = (useNotices.getState().notice?.id ?? 0) - 1
    useNotices.getState().dismiss(stale)

    expect(useNotices.getState().notice?.text).toBe('first')
  })
})
