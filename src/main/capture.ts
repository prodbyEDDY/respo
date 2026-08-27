import { desktopCapturer, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Dev-only window grabs for the R1 spike.
 *
 * `webContents.capturePage` is useless here: it renders the page, and the
 * device views are *not* in the page — they are native child views composited
 * over it. `desktopCapturer` grabs what the compositor actually produced, which
 * is the only way to see whether views and frames line up.
 */
export async function captureWindow(
  window: BrowserWindow,
  directory: string,
  name: string
): Promise<string | null> {
  if (window.isDestroyed()) return null

  const [width = 1400, height = 900] = window.getContentSize()
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width, height }
  })

  const title = window.getTitle()
  const source =
    sources.find((candidate) => candidate.name === title) ??
    sources.find((candidate) => candidate.name.includes('Respo'))
  if (source === undefined || source.thumbnail.isEmpty()) return null

  await mkdir(directory, { recursive: true })
  const file = join(directory, `${name}.png`)
  await writeFile(file, source.thumbnail.toPNG())
  return file
}
