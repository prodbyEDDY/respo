import { describe, expect, it } from 'vitest'
import { cn } from '../utils'

describe('Respo type utilities', () => {
  it('keeps every custom font size when adding a semantic text color', () => {
    for (const size of ['micro', 'caption', 'body', 'subheading', 'heading', 'heading-lg']) {
      expect(cn(`text-${size}`, 'text-foreground')).toBe(`text-${size} text-foreground`)
    }
  })
  it('still resolves real size and color overrides independently', () => {
    expect(cn('text-caption text-muted-foreground', 'text-sm text-primary')).toBe(
      'text-sm text-primary'
    )
  })
})
