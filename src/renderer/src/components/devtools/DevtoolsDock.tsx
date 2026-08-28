import { useCallback, useEffect, useRef } from 'react'
import {
  ArrowTopRightOnSquareIcon,
  Bars2Icon,
  ViewColumnsIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import type { DockPosition } from '@shared/ipc'
import { clampDockSize } from '@shared/persistence-types'
import type { Rect } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ipcBridge } from '@renderer/lib/ipc'
import { createRafBatcher } from '@renderer/lib/raf-batch'
import { cn } from '@renderer/lib/utils'
import { useDevices } from '@renderer/stores/devices'
import { usePanels } from '@renderer/stores/panels'

export type DevtoolsDockProps = {
  /** The device whose DevTools fills the dock. Never `null` when mounted. */
  deviceId: string
}

const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 }

function sameRect(a: Rect | null, b: Rect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Tell main where the strip is. Fire-and-forget, like every layout report. */
function sendBounds(rect: Rect): void {
  const bridge = ipcBridge()
  // Absent outside Electron (unit tests, the dev server in a plain browser).
  if (bridge === null) return
  void bridge.invoke('devtools:set-bounds', rect).catch((error: unknown) => {
    console.error('devtools:set-bounds failed', error)
  })
}

/** One of the two docked edges, as a toggle. */
function EdgeButton({
  edge,
  label,
  children
}: {
  edge: Exclude<DockPosition, 'undocked'>
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const dock = usePanels((s) => s.dock)
  const setDock = usePanels((s) => s.setDock)
  const active = dock === edge

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          onClick={() => setDock(edge)}
          className={cn(active ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The chrome around a docked DevTools frontend.
 *
 * Nothing is ever painted inside the panel region: the frontend is a
 * `WebContentsView` main composites on top of the whole window, glued to that
 * element's box the same way a device page is glued to its frame. Everything
 * this component draws — the header, the resize handle — has to stay outside
 * it, which is why the handle is a flex gutter rather than an overlay on the
 * edge: an overlay would sit under a native surface and never be clickable.
 *
 * The strip is reserved with ordinary flex layout, so the canvas beside it
 * simply gets smaller and every device frame re-measures itself. There is no
 * separate "shrink the canvas" path, and there is no CSS reaching into the
 * DevTools frontend.
 */
export function DevtoolsDock({ deviceId }: DevtoolsDockProps): React.JSX.Element {
  const dock = usePanels((s) => s.dock)
  const size = usePanels((s) => s.size)
  const close = usePanels((s) => s.close)
  const setDock = usePanels((s) => s.setDock)
  const name = useDevices((s) => s.allDevices.find((device) => device.id === deviceId)?.name)

  const asideRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bottom = dock !== 'right'

  /**
   * Report the strip, at most once per animation frame.
   *
   * Everything that can move it — the resize drag, a window resize, the edge
   * switch — funnels through this one batcher, which is the "no per-event IPC"
   * invariant (CLAUDE.md §4) applied to the dock.
   */
  const report = useRef<{ schedule: () => void; cancel: () => void } | null>(null)

  useEffect(() => {
    let last: Rect | null = null
    const batcher = createRafBatcher(() => {
      const element = panelRef.current
      if (element === null) return
      const box = element.getBoundingClientRect()
      const rect: Rect = { x: box.x, y: box.y, width: box.width, height: box.height }
      if (sameRect(last, rect)) return
      last = rect
      sendBounds(rect)
    })
    report.current = batcher

    const element = panelRef.current
    const observer =
      typeof ResizeObserver === 'undefined' || element === null
        ? null
        : new ResizeObserver(() => batcher.schedule())
    if (element !== null) observer?.observe(element)
    window.addEventListener('resize', batcher.schedule)
    batcher.schedule()

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', batcher.schedule)
      batcher.cancel()
      report.current = null
      // The strip is gone: main must stop painting a panel over what is canvas
      // again. An empty rect is the only way to say that.
      sendBounds(ZERO_RECT)
    }
  }, [])

  // Switching edges moves the strip without necessarily resizing the element
  // the observer watches.
  useEffect(() => {
    report.current?.schedule()
  }, [dock, size])

  /**
   * Drag the handle to resize.
   *
   * The size is written straight onto the element rather than into the store:
   * a pointer can fire a dozen events per frame, and a React render per event
   * would be the same waste as an IPC per event. The store hears the value the
   * drag settled on, once, which is also when it reaches disk.
   */
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const aside = asideRef.current
      if (aside === null || event.button !== 0) return
      event.preventDefault()

      const vertical = dock !== 'right'
      const box = aside.getBoundingClientRect()
      const startSize = vertical ? box.height : box.width
      const startAt = vertical ? event.clientY : event.clientX
      let next = startSize

      const onMove = (move: PointerEvent): void => {
        // The handle is on the inner edge, so the panel grows as the pointer
        // moves *away* from the window edge it is docked to.
        const delta = (vertical ? move.clientY : move.clientX) - startAt
        next = clampDockSize(startSize - delta)
        aside.style.setProperty(vertical ? 'height' : 'width', `${next}px`)
      }

      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.style.removeProperty('cursor')
        usePanels.getState().setSize(next)
      }

      // Held on the body so the cursor does not flicker back to an arrow every
      // time the pointer crosses out of the 4px handle mid-drag.
      document.body.style.setProperty('cursor', vertical ? 'ns-resize' : 'ew-resize')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [dock]
  )

  return (
    <aside
      ref={asideRef}
      data-testid="devtools-dock"
      data-dock={dock}
      aria-label={`DevTools for ${name ?? deviceId}`}
      style={bottom ? { height: size } : { width: size }}
      className={cn(
        'flex shrink-0 bg-card',
        'animate-in fade-in-0 duration-150 ease-out',
        bottom ? 'w-full flex-col border-t border-border' : 'h-full flex-row border-l border-border'
      )}
    >
      <div
        role="separator"
        aria-orientation={bottom ? 'horizontal' : 'vertical'}
        aria-label="Resize DevTools"
        onPointerDown={onPointerDown}
        className={cn(
          'shrink-0 bg-transparent transition-colors duration-150 ease-out hover:bg-primary/40',
          bottom ? 'h-1 w-full cursor-ns-resize' : 'h-full w-1 cursor-ew-resize'
        )}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
          <h2 className="truncate text-caption font-medium text-foreground">{name ?? deviceId}</h2>
          <span className="text-micro text-muted-foreground">DevTools</span>

          <div className="ml-auto flex items-center gap-0.5">
            <EdgeButton edge="bottom" label="Dock to bottom">
              <Bars2Icon />
            </EdgeButton>
            <EdgeButton edge="right" label="Dock to right">
              <ViewColumnsIcon />
            </EdgeButton>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move DevTools to its own window"
                  onClick={() => setDock('undocked')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowTopRightOnSquareIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move to its own window</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close DevTools"
                  onClick={() => close(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XMarkIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close DevTools</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/*
          The frontend's box. Deliberately empty: a `WebContentsView` composited
          over the window fills it, and anything drawn here would be hidden.
        */}
        <div ref={panelRef} data-testid="devtools-panel" className="min-h-0 min-w-0 flex-1" />
      </div>
    </aside>
  )
}
