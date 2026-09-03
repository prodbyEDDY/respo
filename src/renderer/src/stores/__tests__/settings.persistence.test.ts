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
    // The store is a module singleton; each test starts from the default.
    useSettings.setState({ allowInsecureCertificates: false })
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

  it('starts with certificates enforced', () => {
    expect(useSettings.getState().allowInsecureCertificates).toBe(false)
  })

  it('posts the certificate switch when it changes', () => {
    useSettings.getState().setAllowInsecureCertificates(true)

    expect(useSettings.getState().allowInsecureCertificates).toBe(true)
    expect(savePersistedState).toHaveBeenCalledWith({
      security: { allowInsecureCertificates: true }
    })
  })

  it('says nothing when the switch is set to what it already is', () => {
    useSettings.getState().setAllowInsecureCertificates(false)
    expect(savePersistedState).not.toHaveBeenCalled()
  })

  it('hydrates the switch without writing it back', () => {
    useSettings.getState().hydrateSecurity({ allowInsecureCertificates: true })

    expect(useSettings.getState().allowInsecureCertificates).toBe(true)
    expect(savePersistedState).not.toHaveBeenCalled()
  })
})
