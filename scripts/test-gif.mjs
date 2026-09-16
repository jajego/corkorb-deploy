// Set PLAYWRIGHT_MODULE to a bundled Playwright entry point, or install Playwright locally.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fixtures = JSON.parse(await readFile(new URL('./fixtures/gifs.json', import.meta.url), 'utf8'))
const bundle = await build({ entryPoints: ['scripts/gif-browser-checks.ts'], bundle: true, write: false, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}' } })
const server = createServer((req, res) => {
  if (req.url === '/checks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return }
  const fixture = fixtures.find(f => req.url === `/fixture/${f.name}.gif`)
  if (fixture) { res.setHeader('Content-Type', 'image/gif'); res.end(Buffer.from(fixture.base64, 'base64')); return }
  res.setHeader('Content-Type', 'text/html')
  res.end('<script type="module">import * as checks from "/checks.js"; window.checks = checks;</script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE })
  const page = await browser.newPage({ reducedMotion: 'no-preference' })
  page.on('pageerror', error => console.error(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => window.checks)
  console.log(await page.evaluate(fixtures => window.checks.runGifChecks(fixtures), fixtures))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(fixture => window.checks.checkReducedMotion(fixture), fixtures[0])
  console.log('Reduced-motion check passed')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
