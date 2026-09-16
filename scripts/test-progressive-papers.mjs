import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

// Exercise the real React/WebSocket handler with real image decoding.
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { Canvas } from '@react-three/fiber';
  import { CorkOrb } from './src/scenes/orb/components/CorkOrb';
  import { beginPaperLoadTiming } from './src/scenes/orb/utils/loadTiming';
  import { MemoryRouter } from 'react-router-dom';
  import { useOrbInitialLoad } from './src/scenes/orb/hooks/useOrbInitialLoad';
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
  const noop = () => {};
  const revealOrb = value => { window.orbVisible = value };
  function InitialApp() {
    const [papers, setPlacedPapers] = useState([]);
    useOrbInitialLoad({...options, setPlacedPapers, setOrbExists: revealOrb, setOrbShape: noop, setLastImageVector: noop});
    window.paperIds = papers.map(p => p.id);
    return React.createElement('div', null, papers.length);
  }
  if (location.pathname === '/cork-test') beginPaperLoadTiming();
  createRoot(document.getElementById('root')).render(location.pathname === '/cork-test'
    ? React.createElement(Canvas, null, React.createElement(CorkOrb, {
        shape: new URLSearchParams(location.search).get('shape') || 'sphere',
        onBeforeRender: (_renderer, _scene, _camera, _geometry, material) => {
          window.firstTexture ??= {repeat: material.map?.repeat.toArray(), anisotropy: material.map?.anisotropy,
            width: material.map?.image?.width, wrapS: material.map?.wrapS, minFilter: material.map?.minFilter};
        },
      }))
    : location.pathname === '/initial'
    ? React.createElement(MemoryRouter, null, React.createElement(InitialApp)) : React.createElement(App));
` }, bundle: true, write: false, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}' } })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const waiting = new Map()
const server = createServer((req, res) => {
  if (req.url === '/checks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return }
  if (req.url.endsWith('.png') || req.url === '/textures/cork.jpg') {
    const send = () => { if (res.writableEnded) return; res.setHeader('Content-Type', 'image/png'); res.end(png) }
    if (req.url.startsWith('/slow') || req.url === '/textures/cork.jpg') waiting.set(req.url, send)
    else send()
    return
  }
  res.end('<div id="root" style="width:600px;height:500px"></div><script type="module" src="/checks.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader'], executablePath: process.env.CHROMIUM_EXECUTABLE})
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
  let initialRequests = 0
  let releasePapers
  const paperGate = new Promise(resolve => { releasePapers = resolve })
  await page.route('**/api/orbs/test*', async route => {
    initialRequests++
    if (new URL(route.request().url()).searchParams.get('include_papers') === 'false') {
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({shape: 'sphere'})}); return
    }
    await paperGate
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({shape: 'sphere', papers: [{
      id: 'initial', user_id: 'user', source_url: '/initial.png', data: {},
      pin: {position: {x: 0, y: 0, z: 1}, color: '#fff'}, created_at: '2026-09-16T00:00:00Z',
    }]})})
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/initial`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.orbVisible === true)
  assert.deepEqual(await page.evaluate(() => window.paperIds), [], 'Cork must be revealed before delayed paper metadata')
  releasePapers()
  await page.waitForFunction(() => window.paperIds?.includes('initial'))
  assert.equal(initialRequests, 2, 'Cork metadata and paper metadata load independently')
  const stages = await page.evaluate(() => performance.getEntriesByType('measure').map(entry => entry.name))
  assert.ok(stages.includes('corkorb:rest-metadata'))
  assert.ok(stages.includes('corkorb:first-image-request'))
  assert.ok(stages.includes('corkorb:first-texture-ready'))
  for (const shape of ['sphere', 'cube', 'pyramid']) {
    waiting.delete('/textures/cork.jpg')
    const corkPage = await browser.newPage()
    corkPage.on('pageerror', error => console.error(error.message))
    const textureRequested = corkPage.waitForRequest(request => request.url().endsWith('/textures/cork.jpg'))
    await corkPage.goto(`http://127.0.0.1:${server.address().port}/cork-test?shape=${shape}`, {waitUntil: 'domcontentloaded'})
    await textureRequested
    await corkPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await corkPage.evaluate(() => window.firstTexture), undefined, `${shape}: no placeholder before texture download`)
    waiting.get('/textures/cork.jpg')()
    await corkPage.waitForFunction(() => window.firstTexture)
    assert.deepEqual(await corkPage.evaluate(() => window.firstTexture), {
      repeat: [3.6, 3.6], anisotropy: 16, width: 1, wrapS: 1000, minFilter: 1008,
    }, `${shape}: the very first draw must use the loaded, fully configured texture`)
    await corkPage.close()
  }
  console.log('Passed: progressive loading/races; parallel metadata; all 3 shapes first draw fully configured, without placeholders.')
} finally {
  for (const send of waiting.values()) send()
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
