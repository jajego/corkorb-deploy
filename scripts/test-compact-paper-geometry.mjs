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
  function Probe() { window.scene = useThree(s => s.scene); window.three = useThree(); return null; }
  function App() {
    const [props, setProps] = useState(null);
    window.install = setProps;
    return React.createElement(Canvas, null, React.createElement(Probe),
      React.createElement('ambientLight', {intensity: 3}),
      ...(props ? (Array.isArray(props) ? props : [props]).map((p, i) => React.createElement(PinnedPaper, {key: i, texture: null, pins: [], ...p})) : []));
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
  window.checkStack = async () => {
    const texture = rgba => {const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.needsUpdate = true; return t;};
    const green = texture([0,255,0,255]), red = texture([255,0,0,255]), clear = texture([255,0,0,0]);
    const base = {shape: 'sphere', center: new THREE.Vector3(0,0,1.008), quaternion: new THREE.Quaternion(), scale: .3, aspect: 1, layerOffset: 0};
    const pixel = async papers => {
      window.install(papers);
      await new Promise(resolve => setTimeout(resolve, 100));
      const {gl, scene, camera} = window.three;
      gl.render(scene, camera);
      const ctx = gl.getContext(), out = new Uint8Array(4);
      ctx.readPixels(Math.floor(ctx.drawingBufferWidth/2), Math.floor(ctx.drawingBufferHeight/2), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, out);
      return Array.from(out);
    };
    const bottom = {...base, texture: green, renderOrder: 1};
    const top = {...base, texture: red, renderOrder: 2};
    const covered = await pixel([top, bottom]); // Arrival/React order must not decide stacking.
    const hole = await pixel([{...top, texture: clear}, bottom]);
    const deleted = await pixel([bottom]);
    green.dispose(); red.dispose(); clear.dispose();
    return {covered, hole, deleted};
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
  const stack = await page.evaluate(() => window.checkStack())
  assert.ok(stack.covered[0] > stack.covered[1] * 2, 'Newer paper renders on top at the same height')
  assert.ok(stack.hole[1] > stack.hole[0] + 50, 'Transparent pixels reveal the lower paper')
  assert.deepEqual(stack.hole, stack.deleted, 'Transparent top and deleted top expose the same lower pixels')
  for (const offset of [0, .1, .5]) {
    const radii = await page.evaluate(async offset => {
      const props = window.sample('sphere', 0);
      props.layerOffset = offset;
      props.center.normalize().multiplyScalar(1.008 + offset);
      const result = await window.capture(props);
      return result.positions.filter((_, i) => i % 3 === 0).map((_, i) => Math.hypot(...result.positions.slice(i*3, i*3+3)));
    }, offset)
    assert.ok(radii.every(r => Math.abs(r - 1.008) < 1e-6), 'Legacy/global paper count cannot raise geometry')
  }
  for (const shape of ['sphere', 'cube', 'pyramid']) {
    const result = await page.evaluate(async shape => {
      const props = window.sample(shape, 0);
      const normal = props.center.clone().set(0, 0, 1).applyQuaternion(props.quaternion);
      const base = await window.capture(props);
      const lifted = {...props, center: props.center.clone().addScaledVector(normal, .5), layerOffset: .5};
      const lowered = await window.capture(lifted);
      const pin = {id: 'pin', position: lifted.center.clone(), normal, color: '#f00'};
      await window.capture({...lifted, pins: [pin]});
      let pinPosition;
      window.scene.traverse(o => {if (o.geometry?.type === 'SphereGeometry') pinPosition = o.position.clone();});
      const expectedPin = props.center.clone().addScaledVector(normal, .012);
      return {
        geometryEqual: shape === 'sphere' || base.positions.every((v, i) => Math.abs(v - lowered.positions[i]) < 1e-6),
        pinError: pinPosition.distanceTo(expectedPin),
      };
    }, shape)
    assert.ok(result.geometryEqual, shape + ': legacy lift removed without moving footprint')
    assert.ok(result.pinError < 1e-6, shape + ': pin follows lowered paper')
  }
  for (const shape of ['sphere', 'cube', 'pyramid']) {
    for (let i = 0; i < 3; i++) {
      const equal = await page.evaluate(async ({shape, i}) => {
        const props = window.sample(shape, i);
        const rebuilt = await window.capture(props);
        // Legacy vertices include the saved lift; rendering now removes that lift.
        const positions = new Float32Array(rebuilt.positions.map((v, j) => v + rebuilt.normals[j] * props.layerOffset));
        const stored = await window.capture({...props, positions, normals: new Float32Array(rebuilt.normals)});
        return rebuilt.positions.every((v, j) => Math.abs(v - stored.positions[j]) < 1e-6)
          && JSON.stringify(rebuilt.matrix) === JSON.stringify(stored.matrix);
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
      return stored.positions.every((v, j) => Math.abs(v - rebuilt.positions[j]) < 1e-6)
        && JSON.stringify(stored.matrix) === JSON.stringify(rebuilt.matrix);
    }, {d, shape: orb.shape})
    assert.ok(equal, 'Legacy paper geometry must remain unchanged: ' + paper.id)
  }
  console.log('Passed: draw order, transparent overlap, deletion, legacy lift removal, pins, and compact/stored geometry on all shapes.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
