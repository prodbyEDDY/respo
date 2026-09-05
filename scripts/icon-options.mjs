// Reproducible vector concepts; the user-selected Monogram is the build source.
import { mkdir, writeFile } from 'node:fs/promises'
const tile = '<rect width="1024" height="1024" rx="224" fill="#0086fc"/>'
const marks = {
  viewport:
    '<rect x="192" y="240" width="624" height="464" rx="64" fill="none" stroke="white" stroke-width="72"/><path d="M432 704v80m-96 0h192" fill="none" stroke="white" stroke-width="64" stroke-linecap="round"/><rect x="584" y="392" width="316" height="464" rx="80" fill="#0086fc"/><rect x="620" y="432" width="244" height="384" rx="48" fill="none" stroke="white" stroke-width="56"/><path d="M716 754h52" stroke="white" stroke-width="28" stroke-linecap="round"/>',
  monogram:
    '<path d="M240 240h200v88H328v152h-88zm0 368h88v120h112v88H240zM552 240h104q152 0 152 144v40q0 144-152 144h-16l204 248H722L488 536v-56h164q56 0 56-56v-40q0-56-56-56H552z" fill="white"/>',
  adaptive:
    '<g fill="none" stroke="white" stroke-width="56"><rect x="180" y="228" width="220" height="568" rx="40"/><rect x="468" y="344" width="164" height="452" rx="36"/><rect x="700" y="476" width="116" height="320" rx="32"/></g>'
}
const svg = (mark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${tile}${mark}</svg>\n`
await mkdir('docs/design/icons', { recursive: true })
for (const [name, mark] of Object.entries(marks))
  await writeFile(`docs/design/icons/${name}.svg`, svg(mark))
await writeFile('build/icon.svg', svg(marks.monogram))
const names = ['Viewport', 'Monogram', 'Adaptive']
const descriptions = [
  'One page. Every device.',
  'A distinctive Respo initial.',
  'The rhythm of responsive layouts.'
]
const cells = Object.values(marks)
  .map((mark, i) => {
    const x = 70 + i * 360
    return `<svg x="${x}" y="76" width="240" height="240" viewBox="0 0 1024 1024">${tile}${mark}</svg><text x="${x}" y="364" font-size="24" font-weight="600">${names[i]}</text><text x="${x}" y="393" font-size="14" fill="#66635f">${descriptions[i]}</text><svg x="${x}" y="426" width="32" height="32" viewBox="0 0 1024 1024">${tile}${mark}</svg><svg x="${x + 56}" y="430" width="24" height="24" viewBox="0 0 1024 1024">${tile}${mark}</svg><svg x="${x + 104}" y="434" width="16" height="16" viewBox="0 0 1024 1024">${tile}${mark}</svg>`
  })
  .join('')
await writeFile(
  'docs/assets/icon-options.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="520" viewBox="0 0 1160 520"><rect width="1160" height="520" rx="20" fill="#fbfaf9"/><g font-family="Inter,Segoe UI,sans-serif" fill="#343433">${cells}</g></svg>\n`
)
