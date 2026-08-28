import { beforeEach, describe, expect, it, vi } from 'vitest'

const { savePersistedState } = vi.hoisted(() => ({ savePersistedState: vi.fn() }))
vi.mock('@renderer/lib/persistence', () => ({
  savePersistedState,
  loadPersistedState: vi.fn()
}))

import { useSettings } from '../settings'

describe('settings store — persistence', () => {
  beforeEach(() => {
    savePersistedState.mockClear()
  })

  it('setTheme posts the choice to main', () => {
    useSettings.getState().setTheme('dark')
    expect(savePersistedState).toHaveBeenCalledWith({ ui: { theme: 'dark' } })
  })

  it('hydrate applies a stored theme without writing it back', () => {
    useSettings.getState().hydrate('light')
    expect(useSettings.getState().theme).toBe('light')
    expect(useSettings.getState().resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})
