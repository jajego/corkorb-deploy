import assert from 'node:assert/strict'
import * as THREE from 'three'

import { buildPolyhedronPaperGeometry } from '../src/scenes/orb/utils/polyhedronPaper.ts'

function verifyUndistortedTriangles(geometry, halfWidth, halfHeight) {
  assert.ok(geometry.positions.length > 18)

  for (let offset = 0; offset < geometry.positions.length; offset += 9) {
    const normal = geometry.normals.slice(offset, offset + 3)
    for (let vertex = 1; vertex < 3; vertex += 1) {
      assert.deepEqual(
        Array.from(geometry.normals.slice(offset + vertex * 3, offset + vertex * 3 + 3)),
        Array.from(normal)
      )
    }

    for (const [start, end] of [[0, 1], [1, 2], [2, 0]]) {
      const positionStart = new THREE.Vector3().fromArray(geometry.positions, offset + start * 3)
      const positionEnd = new THREE.Vector3().fromArray(geometry.positions, offset + end * 3)
      const uvOffset = offset / 3 * 2
      const uvStart = new THREE.Vector2().fromArray(geometry.uvs, uvOffset + start * 2)
      const uvEnd = new THREE.Vector2().fromArray(geometry.uvs, uvOffset + end * 2)
      const sourceDistance = Math.hypot(
        (uvEnd.x - uvStart.x) * halfWidth * 2,
        (uvEnd.y - uvStart.y) * halfHeight * 2
      )
      assert.ok(Math.abs(positionStart.distanceTo(positionEnd) - sourceDistance) < 1e-6)
    }
  }
}

function verifyClosedFold(geometry) {
  const verticesByUv = new Map()
  for (let vertex = 0; vertex < geometry.positions.length / 3; vertex += 1) {
    const uv = new THREE.Vector2().fromArray(geometry.uvs, vertex * 2)
    const key = `${uv.x.toFixed(6)},${uv.y.toFixed(6)}`
    const entry = {
      position: new THREE.Vector3().fromArray(geometry.positions, vertex * 3),
      normal: new THREE.Vector3().fromArray(geometry.normals, vertex * 3),
    }
    verticesByUv.set(key, [...(verticesByUv.get(key) ?? []), entry])
  }

  let foundFold = false
  for (const vertices of verticesByUv.values()) {
    for (const first of vertices) {
      for (const second of vertices) {
        if (first.normal.distanceTo(second.normal) < 1e-6) continue
        assert.ok(first.position.distanceTo(second.position) < 1e-6)
        foundFold = true
      }
    }
  }
  assert.equal(foundFold, true)
}

function verifyContinuousTip(geometry) {
  assert.ok(geometry.indices)
  assert.equal(geometry.positions.length / 3, 33 * 33)
  assert.equal(geometry.uvs.length / 2, 33 * 33)
  assert.ok([...geometry.positions].every(Number.isFinite))

  const uniqueUvs = new Set()
  for (let offset = 0; offset < geometry.uvs.length; offset += 2) {
    uniqueUvs.add(`${geometry.uvs[offset]},${geometry.uvs[offset + 1]}`)
  }
  assert.equal(uniqueUvs.size, geometry.uvs.length / 2)
}

const cube = buildPolyhedronPaperGeometry(
  'cube',
  new THREE.Vector3(0.8, 0, 1),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  0.5,
  0.4,
  0.024
)
verifyUndistortedTriangles(cube, 0.5, 0.4)
verifyClosedFold(cube)

const pyramid = buildPolyhedronPaperGeometry(
  'pyramid',
  new THREE.Vector3(0.8, -1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  0.5,
  0.4,
  0.024
)
verifyUndistortedTriangles(pyramid, 0.5, 0.4)
verifyClosedFold(pyramid)

const cubeTip = buildPolyhedronPaperGeometry(
  'cube',
  new THREE.Vector3(0.8, 0.8, 1),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  0.5,
  0.5,
  0.024
)
verifyContinuousTip(cubeTip)

const pyramidNormal = new THREE.Vector3(2, 1, 0).normalize()
const pyramidRight = new THREE.Vector3(0, 0, -1)
const pyramidUp = pyramidNormal.clone().cross(pyramidRight).normalize()
const pyramidTip = buildPolyhedronPaperGeometry(
  'pyramid',
  new THREE.Vector3(0.1, 0.8, 0),
  pyramidNormal,
  pyramidRight,
  pyramidUp,
  0.5,
  0.5,
  0.024
)
verifyContinuousTip(pyramidTip)

console.log('polyhedron edges stay exact and tips use one continuous surface')
