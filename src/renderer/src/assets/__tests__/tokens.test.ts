import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@tailwindcss/node'
import { beforeAll, describe, expect, it } from 'vitest'

const assetsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = resolve(assetsDir, 'main.css')
const source = readFileSync(cssPath, 'utf8')

/** Utilities we want compiled so their declarations can be asserted. */
const CANDIDATES = ['p-4', 'gap-2', 'rounded-full', 'rounded-lg', 'text-body', 'bg-background']

let built = ''

function rule(selector: string): string {
  const match = built.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))
  if (match === null) throw new Error(`utility ${selector} was not generated`)
  return match[0]
}

beforeAll(async () => {
  const compiler = await compile(source, { base: assetsDir, onDependency: () => {} })
  built = compiler.build(CANDIDATES)
}, 60_000)

describe('design tokens', () => {
  it('leaves the stock Tailwind spacing scale intact (p-4 === 1rem)', () => {
    expect(built).toContain('--spacing: 0.25rem')
    expect(rule('.p-4')).toContain('calc(var(--spacing) * 4)')
  })

  it('leaves rounded-full intact', () => {
    expect(rule('.rounded-full')).toContain('infinity')
  })

  it('maps rounded-lg onto the shadcn --radius base', () => {
    expect(rule('.rounded-lg')).toContain('var(--radius)')
  })

  it('does not redefine Tailwind scale namespaces with Family raw values', () => {
    // These are the collisions called out in the W1 design review: `--spacing-N`
    // rescales every padding/margin utility, and a bare `--font-family` is not
    // namespaced. Family values live under `--respo-*` instead.
    expect(source).not.toMatch(/^\s*--spacing-\d/m)
    expect(source).not.toMatch(/^\s*--font-family:/m)
  })

  it('gives every line-height and tracking token a unit', () => {
    const numeric = [...source.matchAll(/^\s*--respo-(?:leading|tracking)-[\w-]+:\s*([^;]+);/gm)]
    expect(numeric.length).toBeGreaterThan(0)
    for (const [, value] of numeric) {
      expect(value).toMatch(/(px|rem|em)$/)
    }
  })
})

describe('shadcn semantic tokens', () => {
  const light = source.slice(source.indexOf('--background: #fbfaf9'))
  const dark = source.slice(source.indexOf('.dark {'))

  it.each([
    ['--background', '#fbfaf9'],
    ['--foreground', '#343433'],
    ['--card', '#ffffff'],
    ['--muted', '#f2f0ed'],
    ['--primary', '#0086fc'],
    ['--secondary', '#f6f4ef'],
    ['--destructive', '#ff2b3a'],
    ['--radius', '10px']
  ])('light %s is %s', (token, value) => {
    expect(light).toMatch(new RegExp(`${token}:\\s*${value};`))
  })

  it.each([
    ['--background', '#151413'],
    ['--foreground', '#f2f0ed'],
    ['--card', '#1e1d1b'],
    ['--muted', '#2a2927'],
    ['--primary', '#4da3ff'],
    ['--primary-foreground', '#10131a'],
    ['--secondary', '#242322'],
    ['--border', '#2a2927']
  ])('dark %s is %s', (token, value) => {
    expect(dark).toMatch(new RegExp(`${token}:\\s*${value};`))
  })
})
