import { useEffect } from 'react'
import { useDevices } from '@renderer/stores/devices'
import { useGuides } from '@renderer/stores/guides'
import { useLayout } from '@renderer/stores/layout'
import { useSync } from '@renderer/stores/sync'

/**
 * Whether a key event is `alt+r` — no ctrl, no cmd, no shift — with the
 * Cyrillic letter on the same key accepted, as everywhere.
 */
function isRulerChord(event: KeyboardEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  const key = event.key.toLowerCase()
  return key === 'r' || key === 'к'
}

/**
 * `alt+r` toggles the rulers of the device the pointer is on — the lead —
 * and, with no lead, of every device at once.
 *
 * The lead rather than "the last one clicked": pointing is how a device is
 * chosen everywhere else in Respo (mirroring, popups), and the hand is
 * already there when the thought "let me measure this" arrives.
 */
export function useRulerHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleRulerKey)
    return () => {
      window.removeEventListener('keydown', handleRulerKey)
    }
  }, [])
}

/** The whole of the behaviour, as a plain listener (see the other hotkey hooks). */
export function handleRulerKey(event: KeyboardEvent): void {
  if (!isRulerChord(event)) return
  if (useLayout.getState().view !== 'canvas') return
  if (typeof document !== 'undefined' && document.querySelector('[data-slot="dialog-content"]')) {
    return
  }
  event.preventDefault()

  const guides = useGuides.getState()
  const lead = useSync.getState().leadDeviceId
  if (lead !== null) {
    guides.toggleRulers(lead)
    return
  }
  const ids = useDevices.getState().active.map((device) => device.id)
  const allOn = ids.length > 0 && ids.every((id) => guides.rulers[id] === true)
  guides.setRulersAll(ids, !allOn)
}
