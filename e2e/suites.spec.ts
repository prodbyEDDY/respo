import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { PROBE_URL } from './probe'

const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = resolve(ROOT, 'out', 'main', 'index.js')

/** A throwaway profile: this spec rearranges a document and then writes it. */
const userDataDir = mkdtempSync(join(tmpdir(), 'respo-suites-'))

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

/** Device ids of the frames on the canvas, in canvas order. */
function canvasOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="canvas"] [data-device-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-device-id') ?? ''))
}

/** Device ids of the chips in the suite row, in suite order. */
function chipOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="suite-devices"] [data-suite-device-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-suite-device-id') ?? ''))
}

/**
 * The suite is the canvas: what is in it, and in what order.
 *
 * Every layer of task 5 in one path — the membership toggle on a card, the
 * drag in the suites panel, the store, and the `views:sync-devices` round trip
 * that turns all of it into native views.
 */
test('a suite decides which devices are on the canvas, and in what order', async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      RESPO_START_URL: PROBE_URL
    }
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-load-state="ready"]')).toHaveCount(5)

    const before = await canvasOrder(page)
    expect(before).toHaveLength(5)

    // The toolbar names the suite the canvas is resolved from.
    await expect(page.getByTestId('suite-selector')).toHaveText(/Default/)

    await page.getByLabel('Add or edit devices').click()
    await expect(page.getByTestId('device-manager')).toBeVisible()
    expect(await chipOrder(page)).toEqual(before)

    // Membership, in one click from the card.
    await page.getByRole('button', { name: /^Phones/ }).click()
    await page.getByLabel('Add iPhone SE to the suite').click()
    await expect(page.locator('[data-suite-device-id]')).toHaveCount(6)
    expect(await chipOrder(page)).toEqual([...before, 'iphone-se'])

    // And back out again — the same control, the other way.
    await page.getByLabel('Remove iPhone SE from the suite').click()
    await expect(page.locator('[data-suite-device-id]')).toHaveCount(5)

    // Escape belongs to the topmost surface: the dialog closes, the library
    // behind it stays open.
    await page.getByRole('button', { name: 'New suite' }).click()
    await expect(page.getByLabel('Suite name')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('Suite name')).toBeHidden()
    await expect(page.getByTestId('device-manager')).toBeVisible()

    // And to the field that has focus: Escape in the address bar drops what was
    // typed there, and takes the library with it if nobody is looking.
    await page.getByLabel('Address').click()
    await page.keyboard.type('nonsense')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('device-manager')).toBeVisible()

    // Reorder by dragging the first chip past the second.
    const first = page.locator(`[data-suite-device-id="${before[0]}"]`)
    const second = page.locator(`[data-suite-device-id="${before[1]}"]`)
    const from = await first.boundingBox()
    const to = await second.boundingBox()
    if (from === null || to === null) throw new Error('suite chips are not on screen')

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // Past the sensor's activation distance first, then onto the target in
    // steps: dnd-kit decides the drop from the pointer's own movement.
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 })
    await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()

    const reordered = [before[1], before[0], ...before.slice(2)]
    await expect.poll(() => chipOrder(page), { message: 'the chip never moved' }).toEqual(reordered)

    // Back to the canvas: the frames are in the order the suite now holds.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect.poll(() => canvasOrder(page)).toEqual(reordered)
  } finally {
    await app.close()
  }
})
