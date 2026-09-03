import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@renderer/lib/utils'

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>): React.JSX.Element {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(
  props: React.ComponentProps<typeof PopoverPrimitive.Trigger>
): React.JSX.Element {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor(
  props: React.ComponentProps<typeof PopoverPrimitive.Anchor>
): React.JSX.Element {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

/**
 * A small surface anchored to what opened it.
 *
 * Same shell as the dropdown menu — border, popover ground, soft shadow, the
 * 150ms transform/opacity entrance the design system allows — but it holds a
 * *form* rather than a list of commands, so it keeps focus and its own keyboard
 * behaviour instead of Radix's roving menu semantics.
 */
function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-soft outline-hidden',
          // Motion budget: transform/opacity only, 120-180ms (DESIGN-SYSTEM.md).
          'origin-(--radix-popover-content-transform-origin) duration-150 ease-out',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
