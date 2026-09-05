// Radix restores focus as a surface unmounts. That focus belongs to dismissal,
// not to a fresh request for a tooltip (including when Escape was used).
let restoreUntil = 0
export function suppressRestoredTooltip(): void {
  restoreUntil = performance.now() + 300
}
export function isRestoringFocus(): boolean {
  return performance.now() < restoreUntil
}
