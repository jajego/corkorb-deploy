import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const bundle = await build({stdin: {resolveDir: process.cwd(), contents: `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { Canvas } from '@react-three/fiber';
  import { CorkOrb } from './src/scenes/orb/components/CorkOrb';
  const query = new URLSearchParams(location.search);
  const shape = query.get('shape') || 'sphere';
  const positions = {top: [0,3.5,0], side: [0,0,3.5], blend: [2.1,2.1,2.1]};
  createRoot(document.getElementById('root')).render(React.createElement(Canvas, {
    camera: {position: positions[query.get('view') || 'top'], up: [0,0,1], fov: 50},
    onCreated: ({camera}) => camera.lookAt(0,0,0),
  }, React.createElement('ambientLight', {intensity: 1.5}),
     React.createElement('directionalLight', {position: [3,5,4], intensity: 2}),
     React.createElement(CorkOrb, {shape, onBeforeRender: (_r,_s,_c,_g,material) => {
       window.materialKind = material.customProgramCacheKey();
       window.drawn = true;
     }})));
`}, bundle: true, write: false, format: 'esm', jsx: 'automatic', define: {'import.meta.env': '{}'}})
const cork = await readFile('public/textures/cork.jpg')
const server = createServer((req, res) => {
  if (req.url === '/checks.js') {res.setHeader('Content-Type', 'text/javascript');res.end(bundle.outputFiles[0].contents)}
  else if (req.url === '/textures/cork.jpg') {res.setHeader('Content-Type', 'image/jpeg');res.end(cork)}
  else res.end('<body style="margin:0;background:#eee"><div id="root" style="width:640px;height:640px"></div><script type="module" src="/checks.js"></script>')
})
await mkdir('node_modules/.cache/cork-triplanar', {recursive: true})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader'], executablePath: process.env.CHROMIUM_EXECUTABLE})
  const page = await browser.newPage({viewport: {width: 640, height: 640}})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  for (const [shape, view] of [['sphere','top'], ['sphere','side'], ['sphere','blend'], ['cube','blend'], ['pyramid','blend']]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?shape=${shape}&view=${view}`)
    await page.waitForFunction(() => window.drawn)
    assert.equal(await page.evaluate(() => window.materialKind === 'cork-triplanar-v1'), shape === 'sphere')
    await page.screenshot({path: `node_modules/.cache/cork-triplanar/${shape}-${view}.png`})
  }
  assert.deepEqual(errors, [], 'No shader compilation or WebGL errors')
  console.log('Passed: triplanar sphere at poles/side/blend; cube and pyramid retain standard material. Screenshots saved.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
