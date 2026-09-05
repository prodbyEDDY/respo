import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SurfaceSnapshot } from '@shared/ipc'
import { ipcBridge } from '@renderer/lib/ipc'

const FLOATING = [
  'dialog-overlay',
  'dialog-content',
  'popover-content',
  'dropdown-menu-content',
  'dropdown-menu-sub-content',
  'select-content',
  'tooltip-content',
  'address-suggestions'
]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(',')

/** Native Chromium surfaces are above every CSS z-index. Keep a still beneath
 * floating UI, yielding the native layer only after the still has painted. */
export function NativeSurfaceGuard(): React.JSX.Element | null {
  const [snapshots, setSnapshots] = useState<SurfaceSnapshot[] | null>(null)

  useEffect(() => {
    const bridge = ipcBridge()
    if (!bridge) return
    let open = false
    let generation = 0
    let frame = 0
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    // Interactive tools (emulation, overflow highlighting, sliders) must still
    // show their result while the popover is open. Refresh on interaction, at
    // most once per 100ms, rather than streaming screenshots of an idle canvas.
    const refresh = (event: Event): void => {
      if (
        !open ||
        refreshTimer ||
        refreshing ||
        !document.querySelector('[data-slot="popover-content"], [data-settings-panel]')
      )
        return
      if (
        event.type === 'pointerover' &&
        !(event.target instanceof Element && event.target.closest('[data-overflow-item]'))
      )
        return
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        if (!open) return
        const token = generation
        refreshing = true
        void bridge
          .invoke('ui:surface-snapshots')
          .then((images) => {
            if (token === generation) setSnapshots(images)
          })
          .catch(() => undefined)
          .finally(() => {
            refreshing = false
          })
      }, 100)
    }
    const interactions = ['input', 'change', 'click', 'keyup', 'pointerover']
    for (const type of interactions) document.addEventListener(type, refresh, true)
    const check = (): void => {
      frame = 0
      const next = document.querySelector(FLOATING) !== null
      if (next === open) return
      open = next
      const token = ++generation
      if (next) {
        void bridge
          .invoke('ui:surface-snapshots')
          .then((images) => {
            if (token === generation) setSnapshots(images)
          })
          .catch(() => {
            if (token === generation) setSnapshots([])
          })
      } else {
        void bridge.invoke('ui:cover-surfaces', false).finally(() => {
          if (token === generation) setSnapshots(null)
        })
      }
    }
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(check)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    check()
    return () => {
      generation++
      observer.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(refreshTimer)
      for (const type of interactions) document.removeEventListener(type, refresh, true)
      void bridge.invoke('ui:cover-surfaces', false)
    }
  }, [])

  useLayoutEffect(() => {
    if (snapshots === null) return
    void ipcBridge()?.invoke('ui:cover-surfaces', true)
  }, [snapshots])

  if (snapshots === null) return null
  return createPortal(
    <div
      data-native-snapshots
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-20 overflow-hidden"
    >
      {snapshots.map((shot, i) => (
        <img
          key={i}
          src={shot.image}
          alt=""
          className="absolute"
          style={{ left: shot.x, top: shot.y, width: shot.width, height: shot.height }}
        />
      ))}
    </div>,
    document.body
  )
}
