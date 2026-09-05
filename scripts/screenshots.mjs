// Real Windows compositor captures, including WebContentsView. No stitched mockups.
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const html = await readFile(resolve('docs/assets/demo.html'))
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204).end()
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
})
await new Promise((done, fail) => {
  server.once('error', fail)
  server.listen(4178, '127.0.0.1', done)
})
const profile = await mkdtemp(resolve(tmpdir(), 'respo-screenshots-'))
const app = await electron.launch({
  args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
  env: { ...process.env, RESPO_START_URL: 'http://127.0.0.1:4178', RESPO_NO_UPDATER: '1' }
})
try {
  const page = await app.firstWindow()
  await page.locator('[data-load-state="ready"]').first().waitFor({ timeout: 30000 })
  await page.evaluate(async () => {
    const state = await window.respo.invoke('store:load')
    await window.respo.invoke('store:save', {
      suites: [
        {
          id: 'showcase',
          name: 'Responsive review',
          deviceIds: ['iphone-15-pro', 'ipad-mini', 'desktop-1024']
        }
      ],
      activeSuiteId: 'showcase',
      layout: { mode: 'flex', individualDeviceId: null },
      ui: { theme: 'light' },
      bookmarks: state.bookmarks
    })
  })
  await page.reload()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-load-state="ready"]').length === 3
  )
  await page
    .getByRole('button', { name: 'Emulate media, vision, network and location', exact: true })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Color scheme', exact: true })
    .getByRole('radio', { name: 'Light', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
  // Use the real zoom control, three rungs from 100% to 67%.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'More options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Zoom out', exact: true }).click()
  }
  await mkdir('docs/assets', { recursive: true })
  const capture = async (name) => {
    await page.mouse.move(2, 46)
    await page.waitForTimeout(400)
    const data = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const id = window.getMediaSourceId()
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1600, height: 1000 }
      })
      const source = sources.find((s) => s.id === id)
      if (!source || source.thumbnail.isEmpty())
        throw new Error('Windows did not return the Respo compositor surface')
      return source.thumbnail.toPNG().toString('base64')
    })
    await writeFile(`docs/assets/screenshot-${name}.png`, Buffer.from(data, 'base64'))
    console.log(`Captured ${name}`)
  }
  await capture('light')
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click()
  await page
    .getByRole('button', { name: 'Emulate media, vision, network and location', exact: true })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Color scheme', exact: true })
    .getByRole('radio', { name: 'Dark', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await capture('dark')
  await page
    .getByRole('button', { name: 'Emulate media, vision, network and location', exact: true })
    .click()
  await page.waitForFunction(() => document.querySelector('[data-native-snapshots]') !== null)
  await capture('emulation')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
  await page.getByRole('button', { name: 'Add or edit devices', exact: true }).click()
  await capture('devices')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 480))
  console.log(
    'Compact window overflow:',
    await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth
    }))
  )
} finally {
  await app.close()
  server.close()
}
