import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { PerspectiveCamera, Vector3, Quaternion } from 'three'

const output = 'node_modules/.cache/paper-orientation-check.mjs'
await build({entryPoints: ['src/scenes/orb/utils/paperOrientation.ts'], outfile: output,
  bundle: true, platform: 'node', format: 'esm', external: ['three']})
const { orientPaperToCamera } = await import(pathToFileURL(resolve(output)))
const right = new Vector3(), up = new Vector3()

for (const pole of [1, -1]) {
  const camera = new PerspectiveCamera()
  camera.position.set(0, pole * 3.5, 0)
  camera.up.set(0, 0, -pole)
  camera.lookAt(0, 0, 0)
  const screenRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
  let previous
  // Orbit around each pole, then pass straight through its singularity.
  const normals = Array.from({length: 361}, (_, i) => new Vector3(
    .12 * Math.cos(i * Math.PI / 180), pole, .12 * Math.sin(i * Math.PI / 180)).normalize())
  normals.push(...Array.from({length: 201}, (_, i) => new Vector3((i - 100) / 1000, pole, 0).normalize()))
  for (const [index, normal] of normals.entries()) {
    if (index === 361) previous = undefined // Start the independent straight crossing path.
    orientPaperToCamera(normal, camera.quaternion, 0, right, up)
    assert.ok(right.dot(screenRight) > .99, 'Paper must stay screen-right around/crossing a pole')
    assert.ok(Math.abs(right.dot(normal)) < 1e-10)
    assert.ok(Math.abs(up.dot(normal)) < 1e-10)
    if (previous) assert.ok(previous.dot(right) > .99, 'No abrupt 180-degree flip')
    previous = right.clone()
  }
  const normal = new Vector3(0, pole, 0)
  orientPaperToCamera(normal, camera.quaternion, 0, right, up)
  const expected = right.clone().applyQuaternion(new Quaternion().setFromAxisAngle(normal, Math.PI / 3))
  orientPaperToCamera(normal, camera.quaternion, Math.PI / 3, right, up)
  assert.ok(right.distanceTo(expected) < 1e-10, 'Manual rotation is applied after camera alignment')
  orientPaperToCamera(screenRight, camera.quaternion, 0, right, up)
  assert.ok(Math.abs(right.length() - 1) < 1e-10 && Math.abs(up.length() - 1) < 1e-10, 'Edge-on fallback remains valid')
}
console.log('Passed: both poles, circular drags, pole crossings, manual rotation, and edge-on fallback.')
