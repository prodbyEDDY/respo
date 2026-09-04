import { useEffect, useMemo, useRef, useState } from 'react'
import { guidesKeyOf } from '@shared/persistence-types'
import { cn } from '@renderer/lib/utils'
import {
  GRAB_RADIUS,
  guideAt,
  pageCoordinate,
  planTicks,
  RULER_SIZE,
  stripPosition
} from '@renderer/lib/rulers'
import { selectGuides, useGuides, type GuideAxis } from '@renderer/stores/guides'

/** How far off the strip a marker has to be dragged to be dropped. */
const DROP_DISTANCE = 24

type Axis = 'x' | 'y'

type RulerProps = {
  deviceId: string
  axis: Axis
  /** The strip's length in screen pixels: the frame's width or height. */
  length: number
  zoom: number
  /** The page coordinate at the strip's start — the scroll offset. */
  offset: number
  /** Guides on this axis (`v` for the top strip, `h` for the left one). */
  guides: readonly number[]
  onAdd: (position: number) => void
  onMove: (index: number, position: number) => void
  onRemove: (index: number) => void
}

/** The strip's guide axis: the top ruler makes vertical lines. */
function guideAxisOf(axis: Axis): GuideAxis {
  return axis === 'x' ? 'v' : 'h'
}

/**
 * Paint one strip: ticks and labels from the plan, a marker per guide.
 *
 * Canvas rather than DOM: a strip redraws on every scroll frame, and a few
 * hundred tick elements re-laid out per frame is exactly the kind of work the
 * canvas budget forbids. Drawn in device pixels so the hairlines stay crisp
 * at any display density.
 */
function paint(
  canvas: HTMLCanvasElement,
  axis: Axis,
  length: number,
  zoom: number,
  offset: number,
  guides: readonly number[],
  colors: { ink: string; muted: string; accent: string; ground: string }
): void {
  const dpr = window.devicePixelRatio || 1
  const width = axis === 'x' ? length : RULER_SIZE
  const height = axis === 'x' ? RULER_SIZE : length
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.ground
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = colors.muted
  ctx.fillStyle = colors.ink
  ctx.lineWidth = 1
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'top'

  const { ticks } = planTicks(length, zoom, offset)
  ctx.beginPath()
  for (const tick of ticks) {
    const size = tick.major ? RULER_SIZE : RULER_SIZE * 0.35
    const at = tick.at + 0.5
    if (axis === 'x') {
      ctx.moveTo(at, RULER_SIZE - size)
      ctx.lineTo(at, RULER_SIZE)
    } else {
      ctx.moveTo(RULER_SIZE - size, at)
      ctx.lineTo(RULER_SIZE, at)
    }
  }
  ctx.stroke()

  for (const tick of ticks) {
    if (!tick.major) continue
    const label = String(tick.value)
    if (axis === 'x') {
      ctx.fillText(label, tick.at + 2, 1)
    } else {
      ctx.save()
      ctx.translate(1, tick.at + 2)
      ctx.rotate(Math.PI / 2)
      ctx.fillText(label, 0, -9)
      ctx.restore()
    }
  }

  // Markers: a small triangle pointing at the page, one per guide.
  ctx.fillStyle = colors.accent
  for (const value of guides) {
    const at = stripPosition(value, zoom, offset)
    if (at < -GRAB_RADIUS || at > length + GRAB_RADIUS) continue
    ctx.beginPath()
    if (axis === 'x') {
      ctx.moveTo(at - 4, RULER_SIZE - 7)
      ctx.lineTo(at + 4, RULER_SIZE - 7)
      ctx.lineTo(at, RULER_SIZE - 1)
    } else {
      ctx.moveTo(RULER_SIZE - 7, at - 4)
      ctx.lineTo(RULER_SIZE - 7, at + 4)
      ctx.lineTo(RULER_SIZE - 1, at)
    }
    ctx.closePath()
    ctx.fill()
  }
}

/** The theme's colours, read once per paint from the document's tokens. */
function themeColors(element: HTMLElement): {
  ink: string
  muted: string
  accent: string
  ground: string
} {
  const style = getComputedStyle(element)
  return {
    ink: style.getPropertyValue('--muted-foreground').trim() || '#7e7e7d',
    muted: style.getPropertyValue('--border').trim() || '#e5e5e5',
    accent: style.getPropertyValue('--primary').trim() || '#0086fc',
    ground: style.getPropertyValue('--card').trim() || '#ffffff'
  }
}

/**
 * One ruler strip. All of the interaction lives here, on the strip, because
 * the page under it is a native view no DOM event can cross:
 *
 * - click on the strip → a guide at that page coordinate
 * - drag a marker along the strip → the guide moves; the value follows the
 *   pointer in a small label
 * - drag a marker off the strip, or double-click it → the guide is removed
 */
function Ruler({
  deviceId,
  axis,
  length,
  zoom,
  offset,
  guides,
  onAdd,
  onMove,
  onRemove
}: RulerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<{ at: number; value: number } | null>(null)
  // The guide being dragged, by its *value*: the store keeps each axis sorted,
  // so an index is stale the moment a marker crosses another one.
  const drag = useRef<{ value: number; pointerId: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    paint(canvas, axis, length, zoom, offset, guides, themeColors(canvas))
  }, [axis, length, zoom, offset, guides])

  const along = (event: React.PointerEvent<HTMLCanvasElement>): number => {
    const box = event.currentTarget.getBoundingClientRect()
    return axis === 'x' ? event.clientX - box.left : event.clientY - box.top
  }
  const across = (event: React.PointerEvent<HTMLCanvasElement>): number => {
    const box = event.currentTarget.getBoundingClientRect()
    return axis === 'x' ? event.clientY - box.top : event.clientX - box.left
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        data-ruler={axis}
        data-device-id={deviceId}
        role="slider"
        aria-label={axis === 'x' ? 'Horizontal ruler' : 'Vertical ruler'}
        aria-valuenow={hover?.value ?? 0}
        className={cn(
          'block touch-none select-none',
          axis === 'x' ? 'cursor-col-resize' : 'cursor-row-resize'
        )}
        style={
          axis === 'x'
            ? { width: length, height: RULER_SIZE }
            : { width: RULER_SIZE, height: length }
        }
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const at = along(event)
          const index = guideAt(at, guides, zoom, offset)
          event.currentTarget.setPointerCapture(event.pointerId)
          if (index === null) {
            // A click: the guide is created here and dragged from here.
            const value = pageCoordinate(at, zoom, offset)
            onAdd(value)
            drag.current = { value, pointerId: event.pointerId }
            return
          }
          drag.current = { value: guides[index] ?? 0, pointerId: event.pointerId }
        }}
        onPointerMove={(event) => {
          const at = along(event)
          const value = pageCoordinate(at, zoom, offset)
          setHover({ at, value })
          const current = drag.current
          if (current === null || current.pointerId !== event.pointerId) return
          const index = guides.indexOf(current.value)
          if (index < 0) return
          // Off the strip is "let go of it": the marker is dropped, and the
          // pointer coming back does not pick it up again.
          if (Math.abs(across(event) - RULER_SIZE / 2) > RULER_SIZE / 2 + DROP_DISTANCE) {
            drag.current = null
            onRemove(index)
            return
          }
          if (value === current.value) return
          current.value = value
          onMove(index, value)
        }}
        onPointerUp={(event) => {
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const at = axis === 'x' ? event.clientX - box.left : event.clientY - box.top
          const index = guideAt(at, guides, zoom, offset)
          if (index !== null) onRemove(index)
        }}
      />
      {hover === null ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute z-10 rounded-sm bg-foreground px-1 text-[10px] leading-4 text-background tabular-nums',
            axis === 'x' ? '-top-4' : '-left-1'
          )}
          style={
            axis === 'x'
              ? { left: Math.min(length - 32, Math.max(0, hover.at - 14)) }
              : {
                  top: Math.min(length - 16, Math.max(0, hover.at - 8)),
                  transform: 'translateX(-100%)'
                }
          }
        >
          {hover.value}
        </span>
      )}
    </div>
  )
}

export type RulersProps = {
  deviceId: string
  /** The device's viewport in CSS pixels, as rotated. */
  width: number
  height: number
  zoom: number
  children: React.ReactNode
}

/**
 * The two strips around a frame, and the corner between them.
 *
 * Rendered around the viewport element rather than over it: main glues the
 * native view to that element's box, and the strips have to sit *outside* it
 * to be seen at all. The frame grows by one strip on each of two sides while
 * rulers are showing.
 */
export function Rulers({
  deviceId,
  width,
  height,
  zoom,
  children
}: RulersProps): React.JSX.Element {
  const key = guidesKeyOf(width, height)
  const guides = useGuides((s) => selectGuides(s, key))
  const scroll = useGuides((s) => s.scroll[deviceId])
  const addGuide = useGuides((s) => s.addGuide)
  const moveGuide = useGuides((s) => s.moveGuide)
  const removeGuide = useGuides((s) => s.removeGuide)
  const offset = useMemo(() => scroll ?? { x: 0, y: 0 }, [scroll])
  const screenWidth = Math.round(width * zoom)
  const screenHeight = Math.round(height * zoom)

  const strip = (axis: Axis): React.JSX.Element => {
    const guideAxis = guideAxisOf(axis)
    return (
      <Ruler
        deviceId={deviceId}
        axis={axis}
        length={axis === 'x' ? screenWidth : screenHeight}
        zoom={zoom}
        offset={axis === 'x' ? offset.x : offset.y}
        guides={guides[guideAxis]}
        onAdd={(position) => addGuide(key, guideAxis, position)}
        onMove={(index, position) => moveGuide(key, guideAxis, index, position)}
        onRemove={(index) => removeGuide(key, guideAxis, index)}
      />
    )
  }

  return (
    <div
      data-rulers="on"
      className="grid rounded-md border border-border bg-card shadow-hairline"
      style={{ gridTemplateColumns: `${RULER_SIZE}px ${screenWidth}px` }}
    >
      <div
        className="border-r border-b border-border"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />
      <div className="border-b border-border">{strip('x')}</div>
      <div className="border-r border-border">{strip('y')}</div>
      {children}
    </div>
  )
}
