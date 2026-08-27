import { describe, it, expect } from 'vitest'
import { useSettings } from '../settings'

describe('settings store', () => {
  it('defaults to system theme', () => {
    expect(useSettings.getState().theme).toBe('system')
  })
  it('setTheme dark resolves dark and toggles class', () => {
    useSettings.getState().setTheme('dark')
    expect(useSettings.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
