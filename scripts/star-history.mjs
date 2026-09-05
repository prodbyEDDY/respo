// Read-only GitHub requests; generated output contains only aggregate counts.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const repo = process.env.GITHUB_REPOSITORY || 'prodbyEDDY/respo'
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository')
const api = (path, args = []) =>
  JSON.parse(execFileSync('gh', ['api', path, ...args], { encoding: 'utf8' }))
const info = api(`repos/${repo}`)
const pages = api(`repos/${repo}/stargazers?per_page=100`, [
  '-H',
  'Accept: application/vnd.github.star+json',
  '--paginate',
  '--slurp'
])
const dates = pages
  .flat()
  .map((entry) => {
    const date = Date.parse(entry.starred_at)
    if (!Number.isFinite(date)) throw new Error('GitHub did not return star timestamps')
    return date
  })
  .sort((a, b) => a - b)
const day = 86400000
const start = Math.floor(Date.parse(info.created_at) / day) * day
const end = Math.max(start + day, Math.ceil(Date.now() / day) * day)
const max = Math.max(1, dates.length)
const x = (date) => 64 + ((date - start) / (end - start)) * 672
const y = (count) => 254 - (count / max) * 150
const daily = new Map()
for (const date of dates) {
  const bucket = Math.ceil(date / day) * day
  daily.set(bucket, (daily.get(bucket) || 0) + 1)
}
let count = 0
let path = 'M 64 254'
for (const [date, amount] of daily) {
  count += amount
  path += ` H ${x(date).toFixed(1)} V ${y(count).toFixed(1)}`
}
path += ' H 736'
const label = (date) => new Date(date).toISOString().slice(0, 10)
for (const theme of ['light', 'dark']) {
  const bg = theme === 'dark' ? '#161b22' : '#ffffff'
  const fg = theme === 'dark' ? '#e6edf3' : '#1f2328'
  const muted = theme === 'dark' ? '#8b949e' : '#656d76'
  const border = theme === 'dark' ? '#30363d' : '#d0d7de'
  writeFileSync(
    `docs/assets/star-history-${theme}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="324" viewBox="0 0 800 324" role="img" aria-labelledby="title desc">
<title id="title">Respo star history</title>
<desc id="desc">${count} current stars. Starred-at dates from GitHub, updated ${label(Date.now())}. Removed stars are not included.</desc>
<rect x=".5" y=".5" width="799" height="323" rx="12" fill="${bg}" stroke="${border}"/>
<g font-family="Arial, sans-serif" fill="${fg}">
<text x="32" y="40" font-size="20" font-weight="600">Star history</text>
<text x="768" y="40" text-anchor="end" font-size="16">${count} ${count === 1 ? 'star' : 'stars'}</text>
<text x="32" y="65" font-size="12" fill="${muted}">${repo} · Updated ${label(Date.now())}</text>
<path d="M 64 104 H 736 M 64 254 H 736" stroke="${border}" fill="none"/>
<text x="52" y="109" text-anchor="end" font-size="12" fill="${muted}">${max}</text>
<text x="52" y="258" text-anchor="end" font-size="12" fill="${muted}">0</text>
<path d="${path}" fill="none" stroke="#0086fc" stroke-width="3" stroke-linejoin="round"/>
<circle cx="736" cy="${y(count)}" r="4" fill="#0086fc"/>
<text x="64" y="280" font-size="12" fill="${muted}">${label(start)}</text>
<text x="736" y="280" text-anchor="end" font-size="12" fill="${muted}">${label(end)}</text>
<text x="32" y="307" font-size="11" fill="${muted}">Current stargazers by date · GitHub API</text>
</g></svg>\n`
  )
}
console.log(`Updated star history: ${count} stars`)
