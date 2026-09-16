import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

// Exercise the real React/WebSocket handler with real image decoding.
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { useOrbWebSocketHandlers } from './src/scenes/orb/hooks/useOrbWebSocketHandlers';
  const ref = current => ({ current });
  const options = {
    orbId: 'test', userId: 'user', placedPapersRef: ref([]),
    optimisticPapersRef: ref(new Map()), optimisticPapersByIdRef: ref(new Map()),
    optimisticallyDeletedPapersRef: ref(new Map()), optimisticallyDeletedSourceUrlsRef: ref(new Set()),
    deletionInProgressRef: ref(new Set()), processingPapersRef: ref(new Set()), pendingDeletionsRef: ref(new Set()),
    websocketHasLoadedPapersRef: ref(false), initialConnectionCompleteRef: ref(false), seenUsersRef: ref(new Set()),
    sendMessage: async () => {}, showToast: () => () => {}, setCameraOverride: () => {},
  };
  function App() {
    const [papers, setPlacedPapers] = useState([]);
    const [, setLastImageVector] = useState(null);
    window.handlers = useOrbWebSocketHandlers({...options, setPlacedPapers, setLastImageVector});
    window.paperIds = papers.map(p => p.id);
    return React.createElement('div', null, papers.length);
  }
  window.paper = id => ({id, user_id: 'user', source_url: '/' + id + '.png', data: {},
    pin: {position: {x: 0, y: 0, z: 1}, color: '#fff'}, created_at: '2026-09-16T00:00:00Z'});
  createRoot(document.getElementById('root')).render(React.createElement(App));
` }, bundle: true, write: false, format: 'esm', define: { 'import.meta.env': '{}' } })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const waiting = new Map()
const server = createServer((req, res) => {
  if (req.url === '/checks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return }
  if (req.url.endsWith('.png')) {
    const send = () => { if (res.writableEnded) return; res.setHeader('Content-Type', 'image/png'); res.end(png) }
    if (req.url.startsWith('/slow')) waiting.set(req.url, send)
    else send()
    return
  }
  res.end('<div id="root"></div><script type="module" src="/checks.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE})
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => window.handlers)
  await page.evaluate(() => {
    window.finished = false
    window.handlers.onState([...Array.from({length: 20}, (_, i) => window.paper('fast' + i)), window.paper('slow1')])
      .then(() => { window.finished = true })
  })
  await page.waitForFunction(() => window.paperIds.length === 20)
  assert.equal(await page.evaluate(() => window.finished), false, 'Fast papers must render while the slow image is pending')
  await page.evaluate(() => window.handlers.onPaperCreated(window.paper('live')))
  await page.waitForFunction(() => window.paperIds.includes('live'))
  await page.evaluate(() => window.handlers.onPaperDeleted('slow1'))
  waiting.get('/slow1.png')()
  await page.waitForFunction(() => window.finished)
  assert.equal(await page.evaluate(() => window.paperIds.includes('slow1')), false, 'Pending deletion must not reappear')
  assert.equal(await page.evaluate(() => window.paperIds.includes('live')), true, 'Live additions must survive snapshot loading')

  await page.evaluate(() => { window.oldLoad = window.handlers.onState([window.paper('slow2')]) })
  await page.evaluate(() => window.handlers.onState([window.paper('new')]))
  await page.waitForFunction(() => window.paperIds.includes('new'))
  waiting.get('/slow2.png')()
  await page.evaluate(() => window.oldLoad)
  assert.deepEqual(await page.evaluate(() => window.paperIds), ['new'], 'Superseded snapshot must not reappear')
  console.log('Passed: 20 papers render before delayed image; deletion during load; newer snapshot wins.')
} finally {
  for (const send of waiting.values()) send()
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
