// Print the CHANGELOG.md section for one version, for the GitHub release body.
//
//   node scripts/release-notes.mjs 0.1.0            # the "## [0.1.0]" section
//   node scripts/release-notes.mjs v0.1.0 > notes.md
//
// Exits 1 when the version has no section: a release without notes is a
// release nobody can read, and the workflow should stop rather than publish it.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The lines between `## [version]` and the next `## ` heading, trimmed. */
export function sectionFor(changelog, version) {
  const wanted = version.replace(/^v/, '')
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => {
    const match = /^## \[([^\]]+)\]/.exec(line)
    return match !== null && match[1] === wanted
  })
  if (start === -1) return null

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) {
      end = i
      break
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
}

const version = process.argv[2]
if (version === undefined || version === '') {
  console.error('usage: node scripts/release-notes.mjs <version>')
  process.exit(2)
}

const notes = sectionFor(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), version)
if (notes === null || notes === '') {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}

const tag = `v${version.replace(/^v/, '')}`
process.stdout.write(
  `${notes}\n\n---\n\n` +
    `**Install:** download \`Respo-Setup-${version.replace(/^v/, '')}.exe\` below and run it. ` +
    `Windows SmartScreen may warn because the build is not code-signed — click *More info → Run anyway*. ` +
    `Existing installs update themselves from this release.\n\n` +
    `Full changelog: https://github.com/prodbyEDDY/respo/blob/${tag}/CHANGELOG.md\n`
)
