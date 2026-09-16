import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Optional saved server response lets this compare real legacy papers before/after compaction.
const fixtures = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : []
const bundle = await build({stdin: {resolveDir: process.cwd(), contents: `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { Canvas, useThree } from '@react-three/fiber';
  import * as THREE from 'three';
  import { PinnedPaper } from './src/scenes/orb/components/PinnedPaper';
  function Probe() { window.scene = useThree(s => s.scene); return null; }
  function App() {
    const [props, setProps] = useState(null);
    window.install = setProps;
    return React.createElement(Canvas, null, React.createElement(Probe),
      props && React.createElement(PinnedPaper, {...props, texture: null, pins: []}));
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
  window.capture = async props => {
    window.install(props);
    await new Promise(resolve => setTimeout(resolve, 100));
    let result;
    window.scene.traverse(o => { if (o.isMesh) {
      o.updateMatrixWorld(true);
      result = {positions: Array.from(o.geometry.attributes.position.array),
        normals: Array.from(o.geometry.attributes.normal.array), matrix: o.matrixWorld.toArray()};
    }});
    return result;
  };
  window.sample = (shape, i) => {
    const normal = new THREE.Vector3(i + 1, 2, 3).normalize();
    const center = normal.clone().multiplyScalar(1.008 + i * .001);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
    const right = new THREE.Vector3(1,0,0).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0,1,0).applyQuaternion(quaternion);
    if (shape === 'cube') {center.set(.7, .2, 1.024); quaternion.identity();right.set(1,0,0);up.set(0,1,0);}
    return {shape, center, quaternion, right, up, scale: .25, aspect: 1.4, layerOffset: i*.001};
  };
`}, bundle: true, write: false, format: 'esm', jsx: 'automatic', define: {'import.meta.env': '{}'}})
const server = createServer((req, res) => {
  if (req.url === '/checks.js') {res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents)}
  else res.end('<div id="root" style="width:600px;height:500px"></div><script type="module" src="/checks.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader'], executablePath: process.env.CHROMIUM_EXECUTABLE})
  const page = await browser.newPage()
  page.on('pageerror', error => console.error(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => window.install && window.scene)
  for (const shape of ['sphere', 'cube', 'pyramid']) {
    for (let i = 0; i < 3; i++) {
      const equal = await page.evaluate(async ({shape, i}) => {
        const props = window.sample(shape, i);
        const rebuilt = await window.capture(props);
        const stored = await window.capture({...props, positions: new Float32Array(rebuilt.positions), normals: new Float32Array(rebuilt.normals)});
        return JSON.stringify(rebuilt) === JSON.stringify(stored);
      }, {shape, i})
      assert.ok(equal, shape + ': compact and explicit geometry must have identical world transforms')
    }
  }
  for (const orb of fixtures) for (const paper of orb.papers) {
    const d = paper.data;
    if (!d?.positions?.length) continue
    const equal = await page.evaluate(async ({d, shape}) => {
      const props = {...d, shape, right: d.basisRight, up: d.basisUp,
        positions: new Float32Array(d.positions), normals: new Float32Array(d.normals)};
      const stored = await window.capture(props);
      const rebuilt = await window.capture({...props, positions: undefined, normals: undefined});
      return JSON.stringify(stored) === JSON.stringify(rebuilt);
    }, {d, shape: orb.shape})
    assert.ok(equal, 'Legacy paper geometry must remain unchanged: ' + paper.id)
  }
  console.log('Passed compact geometry/world-transform checks for all shapes and supplied legacy papers.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
