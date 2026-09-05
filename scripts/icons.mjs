// Rasterize the Respo mark (build/icon.svg) into every icon the build needs.
//
//   npm run icons        (= electron scripts/icons.mjs)
//
// Runs *inside Electron*: Chromium is the rasterizer, so the pipeline adds no
// image library to the tree — the two remaining helpers (png-to-ico, png2icons)
// are pure-JS MIT packagers of PNGs we already have. Each size is rendered
// straight from the vector into a window of exactly that size, never
// downsampled from one big PNG: crisp hairlines at 16 px, no resampling blur.
//
// Outputs (all derived from the one SVG, never edited by hand):
//   build/icon.png            1024² — electron-builder's source of truth
//   build/icon.ico            16…256 — Windows exe, taskbar, alt-tab
//   build/installerIcon.ico   same — NSIS installer / uninstaller
//   build/uninstallerIcon.ico
//   build/icon.icns           macOS bundle (png2icons)
//   resources/icon.png        512² — BrowserWindow icon in dev / unpackaged runs
//   src/renderer/src/assets/respo-mark.svg  — the About dialog's copy

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeImage } from 'electron'
import pngToIco from 'png-to-ico'
import png2icons from 'png2icons'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => resolve(root, ...parts)

/** The sizes a Windows .ico is expected to carry (Explorer picks per DPI). */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * Render the SVG at one size and answer the PNG bytes.
 *
 * The page draws the vector into a `<canvas>` of exactly that size and hands
 * back `toDataURL('image/png')`: the canvas keeps its own alpha, so the
 * rounded tile's corners come out transparent without asking the compositor
 * for a transparent window (offscreen + `transparent` is a Viz error), and the
 * display's scale factor never enters into it. The alpha check at the end is
 * what proves the corners.
 */
async function render(page, svg, size) {
  const svgUrl = `data:image/svg+xml;base64,${svg.toString('base64')}`
  const dataUrl = await page.webContents.executeJavaScript(
    `new Promise((done, fail) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = ${size}
        canvas.height = ${size}
        canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
        done(canvas.toDataURL('image/png'))
      }
      img.onerror = () => fail(new Error('the SVG did not decode'))
      img.src = ${JSON.stringify(svgUrl)}
    })`
  )
  const image = nativeImage.createFromDataURL(dataUrl)
  const { width, height } = image.getSize()
  if (width !== size || height !== size) {
    throw new Error(`icon ${size}: rendered ${width}×${height}`)
  }
  // Top-left pixel is outside the rounded tile: it must be transparent.
  const alpha = image.toBitmap()[3]
  if (alpha !== 0) throw new Error(`icon ${size}: corner is not transparent (alpha ${alpha})`)
  return image.toPNG()
}

/** One hidden page for every render; nothing is ever shown. */
function openPage() {
  const page = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  })
  return page
}

async function main() {
  const svgPath = at('build', 'icon.svg')
  const svg = await readFile(svgPath)
  const page = openPage()
  await page.loadURL('data:text/html;charset=utf-8,<!doctype html><meta charset="utf-8">')

  const png1024 = await render(page, svg, 1024)
  await writeFile(at('build', 'icon.png'), png1024)

  const png512 = await render(page, svg, 512)
  await mkdir(at('resources'), { recursive: true })
  await writeFile(at('resources', 'icon.png'), png512)

  const icoFrames = []
  for (const size of ICO_SIZES) icoFrames.push(await render(page, svg, size))
  // Kept open until the end: closing the last window quits an Electron app.
  page.destroy()
  const ico = await pngToIco(icoFrames)
  await writeFile(at('build', 'icon.ico'), ico)
  await copyFile(at('build', 'icon.ico'), at('build', 'installerIcon.ico'))
  await copyFile(at('build', 'icon.ico'), at('build', 'uninstallerIcon.ico'))

  const icns = png2icons.createICNS(png1024, png2icons.BICUBIC, 0)
  if (icns === null) throw new Error('png2icons could not build icon.icns')
  await writeFile(at('build', 'icon.icns'), icns)

  const markDir = at('src', 'renderer', 'src', 'assets')
  await mkdir(markDir, { recursive: true })
  await copyFile(svgPath, resolve(markDir, 'respo-mark.svg'))

  console.log(
    [
      `build/icon.png     ${png1024.length} B`,
      `build/icon.ico     ${ico.length} B (${ICO_SIZES.join('/')})`,
      `build/icon.icns    ${icns.length} B`,
      `resources/icon.png ${png512.length} B`,
      'src/renderer/src/assets/respo-mark.svg'
    ].join('\n')
  )
}

// Electron quits when its last window closes; the render page is closed
// before the icns and the summary are written, so that default must not run.
app.on('window-all-closed', () => undefined)

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    }
  )
