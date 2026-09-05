import { View, WebContentsView, type BrowserWindow } from 'electron'
import type { SurfaceSnapshot } from '@shared/ipc'
import type { Rect } from '@shared/types'

/** A single native layer can yield to DOM menus without disturbing device state. */
export class UiSurfaces {
  readonly root = new View()

  constructor(window: BrowserWindow) {
    window.contentView.addChildView(this.root)
    const resize = (): void => {
      const [width = 0, height = 0] = window.getContentSize()
      this.root.setBounds({ x: 0, y: 0, width, height })
    }
    resize()
    window.on('resize', resize)
    // A renderer reload/crash must never leave the native layer hidden.
    window.webContents.on('did-start-loading', () => this.setCovered(false))
    window.webContents.on('render-process-gone', () => this.setCovered(false))
  }

  setCovered(covered: boolean): void {
    this.root.setVisible(!covered)
  }

  async snapshots(): Promise<SurfaceSnapshot[]> {
    const candidates: { view: WebContentsView; bounds: Rect; clip: Rect }[] = []
    const visit = (parent: View, origin: Rect): void => {
      for (const view of parent.children) {
        if (!view.getVisible()) continue
        const local = view.getBounds()
        const bounds = { ...local, x: local.x + origin.x, y: local.y + origin.y }
        const x = Math.max(bounds.x, origin.x)
        const y = Math.max(bounds.y, origin.y)
        const width = Math.min(bounds.x + bounds.width, origin.x + origin.width) - x
        const height = Math.min(bounds.y + bounds.height, origin.y + origin.height) - y
        if (width <= 0 || height <= 0) continue
        const clip = { x, y, width, height }
        if (view instanceof WebContentsView) candidates.push({ view, bounds, clip })
        else visit(view, clip)
      }
    }
    visit(this.root, this.root.getBounds())
    const result: SurfaceSnapshot[] = []
    // Small viewport captures, at most three in flight. Never full-page shots.
    for (let i = 0; i < candidates.length; i += 3) {
      await Promise.all(
        candidates.slice(i, i + 3).map(async ({ view, bounds, clip }) => {
          const wc = view.webContents
          if (wc.isDestroyed() || wc.isCrashed()) return
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            const image = await Promise.race([
              wc.capturePage(
                {
                  x: clip.x - bounds.x,
                  y: clip.y - bounds.y,
                  width: clip.width,
                  height: clip.height
                },
                { stayHidden: true }
              ),
              new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), 250)
              })
            ])
            if (image && !image.isEmpty()) result.push({ ...clip, image: image.toDataURL() })
          } catch {
            // A closing/crashed view must not block a menu or permission prompt.
          } finally {
            clearTimeout(timer)
          }
        })
      )
    }
    return result
  }
}
