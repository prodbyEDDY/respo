// Rasterize the Respo mark (build/icon.svg) into every icon the build needs.
//
//   node scripts/icons.mjs
//
// Outputs (all derived from the one SVG, never edited by hand):
//   build/icon.png            1024² — electron-builder's source of truth
//   build/icon.ico            16…256 — Windows exe, taskbar, alt-tab
//   build/installerIcon.ico   same — NSIS installer / uninstaller
//   build/uninstallerIcon.ico
//   build/icon.icns           macOS bundle (png2icons, pure JS)
//   resources/icon.png        512² — BrowserWindow icon in dev / unpackaged runs
//   src/renderer/src/assets/respo-mark.svg  — the About dialog's copy
//
// Tooling licences: sharp (Apache-2.0), png-to-ico (MIT), png2icons (MIT).

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import png2icons from 'png2icons'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => resolve(root, ...parts)

/** The sizes a Windows .ico is expected to carry (Explorer picks per DPI). */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(svg, size) {
  // Rasterize straight from the vector at the target size rather than
  // downsampling one big PNG: crisp hairlines at 16 px, no resampling blur.
  return sharp(svg, { density: Math.ceil((72 * size) / 1024) * 4 })
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  const svgPath = at('build', 'icon.svg')
  const svg = await readFile(svgPath)

  const png1024 = await render(svg, 1024)
  await writeFile(at('build', 'icon.png'), png1024)

  const png512 = await render(svg, 512)
  await mkdir(at('resources'), { recursive: true })
  await writeFile(at('resources', 'icon.png'), png512)

  const icoFrames = await Promise.all(ICO_SIZES.map((size) => render(svg, size)))
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

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
