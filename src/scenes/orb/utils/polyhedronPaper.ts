import * as THREE from 'three'

type PolyhedronShape = 'cube' | 'pyramid'

type Face = {
  vertices: readonly number[]
  normal: THREE.Vector3
  center: THREE.Vector3
}

type Polyhedron = {
  vertices: readonly THREE.Vector3[]
  faces: readonly Face[]
}

type PatchVertex = {
  position: THREE.Vector3
  uv: THREE.Vector2
}

export type PolyhedronPaperGeometry = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  colors: Float32Array
  indices?: Uint16Array
}

function makeFace(
  vertices: readonly THREE.Vector3[],
  vertexIds: readonly number[],
  normal: THREE.Vector3
): Face {
  const center = vertexIds.reduce(
    (result, vertexId) => result.add(vertices[vertexId]),
    new THREE.Vector3()
  ).divideScalar(vertexIds.length)
  return { vertices: vertexIds, normal: normal.normalize(), center }
}

const cubeVertices = [
  new THREE.Vector3(-1, -1, -1),
  new THREE.Vector3(1, -1, -1),
  new THREE.Vector3(1, 1, -1),
  new THREE.Vector3(-1, 1, -1),
  new THREE.Vector3(-1, -1, 1),
  new THREE.Vector3(1, -1, 1),
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(-1, 1, 1),
]

const pyramidVertices = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, -1, 1),
  new THREE.Vector3(1, -1, -1),
  new THREE.Vector3(-1, -1, -1),
  new THREE.Vector3(-1, -1, 1),
]

const polyhedra: Record<PolyhedronShape, Polyhedron> = {
  cube: {
    vertices: cubeVertices,
    faces: [
      makeFace(cubeVertices, [0, 1, 2, 3], new THREE.Vector3(0, 0, -1)),
      makeFace(cubeVertices, [4, 5, 6, 7], new THREE.Vector3(0, 0, 1)),
      makeFace(cubeVertices, [0, 3, 7, 4], new THREE.Vector3(-1, 0, 0)),
      makeFace(cubeVertices, [1, 2, 6, 5], new THREE.Vector3(1, 0, 0)),
      makeFace(cubeVertices, [0, 1, 5, 4], new THREE.Vector3(0, -1, 0)),
      makeFace(cubeVertices, [3, 2, 6, 7], new THREE.Vector3(0, 1, 0)),
    ],
  },
  pyramid: {
    vertices: pyramidVertices,
    faces: [
      makeFace(pyramidVertices, [0, 1, 2], new THREE.Vector3(2, 1, 0)),
      makeFace(pyramidVertices, [0, 2, 3], new THREE.Vector3(0, 1, -2)),
      makeFace(pyramidVertices, [0, 3, 4], new THREE.Vector3(-2, 1, 0)),
      makeFace(pyramidVertices, [0, 4, 1], new THREE.Vector3(0, 1, 2)),
      makeFace(pyramidVertices, [1, 4, 3, 2], new THREE.Vector3(0, -1, 0)),
    ],
  },
}

const EPSILON = 1e-8
const TIP_SEGMENTS = 32

function expandedPolyhedron(polyhedron: Polyhedron, offset: number): Polyhedron {
  if (offset === 0) return polyhedron

  const vertices = polyhedron.vertices.map((vertex, vertexIndex) => {
    const incidentFaces = polyhedron.faces.filter((face) =>
      face.vertices.includes(vertexIndex)
    )

    for (let first = 0; first < incidentFaces.length - 2; first += 1) {
      for (let second = first + 1; second < incidentFaces.length - 1; second += 1) {
        for (let third = second + 1; third < incidentFaces.length; third += 1) {
          const normals = [
            incidentFaces[first].normal,
            incidentFaces[second].normal,
            incidentFaces[third].normal,
          ]
          const matrix = new THREE.Matrix3().set(
            normals[0].x, normals[0].y, normals[0].z,
            normals[1].x, normals[1].y, normals[1].z,
            normals[2].x, normals[2].y, normals[2].z
          )
          if (Math.abs(matrix.determinant()) <= EPSILON) continue

          const shift = new THREE.Vector3(offset, offset, offset)
            .applyMatrix3(matrix.invert())
          return vertex.clone().add(shift)
        }
      }
    }

    return vertex.clone()
  })

  return {
    vertices,
    faces: polyhedron.faces.map((face) => makeFace(
      vertices,
      face.vertices,
      face.normal.clone()
    )),
  }
}

function closestFace(polyhedron: Polyhedron, normal: THREE.Vector3): number {
  return polyhedron.faces.reduce((closest, face, index) =>
    face.normal.dot(normal) > polyhedron.faces[closest].normal.dot(normal)
      ? index
      : closest
  , 0)
}

function adjacentFace(
  polyhedron: Polyhedron,
  faceIndex: number,
  edgeStart: number,
  edgeEnd: number
): number {
  return polyhedron.faces.findIndex((candidate, index) =>
    index !== faceIndex &&
    candidate.vertices.includes(edgeStart) &&
    candidate.vertices.includes(edgeEnd)
  )
}

function splitPatch(
  patch: readonly PatchVertex[],
  edgeStart: THREE.Vector3,
  inward: THREE.Vector3
): { inside: PatchVertex[]; outside: PatchVertex[] } {
  const inside: PatchVertex[] = []
  const outside: PatchVertex[] = []

  for (let index = 0; index < patch.length; index += 1) {
    const current = patch[index]
    const next = patch[(index + 1) % patch.length]
    const currentDistance = inward.dot(current.position) - inward.dot(edgeStart)
    const nextDistance = inward.dot(next.position) - inward.dot(edgeStart)
    const currentInside = currentDistance >= -EPSILON
    const nextInside = nextDistance >= -EPSILON
    const currentCopy = {
      position: current.position.clone(),
      uv: current.uv.clone(),
    }

    if (currentInside) inside.push(currentCopy)
    else outside.push(currentCopy)

    if (currentInside !== nextInside) {
      const amount = currentDistance / (currentDistance - nextDistance)
      const intersection = {
        position: current.position.clone().lerp(next.position, amount),
        uv: current.uv.clone().lerp(next.uv, amount),
      }
      inside.push({
        position: intersection.position.clone(),
        uv: intersection.uv.clone(),
      })
      outside.push(intersection)
    }
  }

  return { inside, outside }
}

function paperCoversVertex(
  polyhedron: Polyhedron,
  faceIndex: number,
  center: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  halfWidth: number,
  halfHeight: number
): boolean {
  return polyhedron.faces[faceIndex].vertices.some((vertexId) => {
    const fromCenter = polyhedron.vertices[vertexId].clone().sub(center)
    return Math.abs(fromCenter.dot(right)) <= halfWidth + EPSILON &&
      Math.abs(fromCenter.dot(up)) <= halfHeight + EPSILON
  })
}

function buildTipGeometry(
  polyhedron: Polyhedron,
  center: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  halfWidth: number,
  halfHeight: number
): PolyhedronPaperGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  for (let y = 0; y <= TIP_SEGMENTS; y += 1) {
    const v = y / TIP_SEGMENTS
    for (let x = 0; x <= TIP_SEGMENTS; x += 1) {
      const u = x / TIP_SEGMENTS
      const sourcePoint = center.clone()
        .addScaledVector(right, (u - 0.5) * halfWidth * 2)
        .addScaledVector(up, (v - 0.5) * halfHeight * 2)
      const direction = sourcePoint.normalize()
      let distance = Number.POSITIVE_INFINITY
      let surfaceNormal = polyhedron.faces[0].normal

      for (const face of polyhedron.faces) {
        const denominator = face.normal.dot(direction)
        if (denominator <= EPSILON) continue
        const candidate = face.normal.dot(face.center) / denominator
        if (candidate > 0 && candidate < distance) {
          distance = candidate
          surfaceNormal = face.normal
        }
      }

      const position = direction.multiplyScalar(distance)
      positions.push(position.x, position.y, position.z)
      normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z)
      uvs.push(u, 1 - v)

      const edgeFactor = Math.max(Math.abs(u * 2 - 1), Math.abs(v * 2 - 1))
      const shade = THREE.MathUtils.lerp(0.9, 1, 1 - Math.pow(edgeFactor, 1.5))
      colors.push(shade, shade, shade)
    }
  }

  const rowSize = TIP_SEGMENTS + 1
  for (let y = 0; y < TIP_SEGMENTS; y += 1) {
    for (let x = 0; x < TIP_SEGMENTS; x += 1) {
      const bottomLeft = y * rowSize + x
      const bottomRight = bottomLeft + 1
      const topLeft = bottomLeft + rowSize
      const topRight = topLeft + 1
      indices.push(bottomLeft, bottomRight, topLeft, bottomRight, topRight, topLeft)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  }
}

export function buildPolyhedronPaperGeometry(
  shape: PolyhedronShape,
  center: THREE.Vector3,
  normal: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  halfWidth: number,
  halfHeight: number,
  paperOffset: number
): PolyhedronPaperGeometry {
  const polyhedron = expandedPolyhedron(polyhedra[shape], paperOffset)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []

  const emit = (patch: readonly PatchVertex[], faceNormal: THREE.Vector3) => {
    for (let index = 1; index < patch.length - 1; index += 1) {
      for (const vertex of [patch[0], patch[index], patch[index + 1]]) {
        positions.push(vertex.position.x, vertex.position.y, vertex.position.z)
        normals.push(faceNormal.x, faceNormal.y, faceNormal.z)
        uvs.push(vertex.uv.x, 1 - vertex.uv.y)

        const edgeFactor = Math.max(
          Math.abs(vertex.uv.x * 2 - 1),
          Math.abs(vertex.uv.y * 2 - 1)
        )
        const shade = THREE.MathUtils.lerp(0.9, 1, 1 - Math.pow(edgeFactor, 1.5))
        colors.push(shade, shade, shade)
      }
    }
  }

  const route = (patch: PatchVertex[], faceIndex: number, depth: number): void => {
    if (patch.length < 3 || depth > 24) return
    const face = polyhedron.faces[faceIndex]

    for (let index = 0; index < face.vertices.length; index += 1) {
      const startId = face.vertices[index]
      const endId = face.vertices[(index + 1) % face.vertices.length]
      const edgeStart = polyhedron.vertices[startId]
      const edgeEnd = polyhedron.vertices[endId]
      const edge = edgeEnd.clone().sub(edgeStart)
      const inward = face.normal.clone().cross(edge).normalize()
      if (inward.dot(face.center.clone().sub(edgeStart)) < 0) inward.negate()

      const crossesEdge = patch.some((vertex) =>
        inward.dot(vertex.position) - inward.dot(edgeStart) < -EPSILON
      )
      if (!crossesEdge) continue

      const split = splitPatch(patch, edgeStart, inward)
      route(split.inside, faceIndex, depth + 1)

      const nextFaceIndex = adjacentFace(polyhedron, faceIndex, startId, endId)
      if (nextFaceIndex === -1) return
      const fold = new THREE.Quaternion().setFromUnitVectors(
        face.normal,
        polyhedron.faces[nextFaceIndex].normal
      )
      split.outside.forEach((vertex) => {
        vertex.position.sub(edgeStart).applyQuaternion(fold).add(edgeStart)
      })
      route(split.outside, nextFaceIndex, depth + 1)
      return
    }

    emit(patch, face.normal)
  }

  const expandedCenter = center.clone().addScaledVector(normal, paperOffset)
  const sourceFace = closestFace(polyhedron, normal)
  if (paperCoversVertex(
    polyhedron,
    sourceFace,
    expandedCenter,
    right,
    up,
    halfWidth,
    halfHeight
  )) {
    return buildTipGeometry(
      polyhedron,
      expandedCenter,
      right,
      up,
      halfWidth,
      halfHeight
    )
  }

  route([
    {
      position: expandedCenter.clone().addScaledVector(right, -halfWidth).addScaledVector(up, -halfHeight),
      uv: new THREE.Vector2(0, 0),
    },
    {
      position: expandedCenter.clone().addScaledVector(right, halfWidth).addScaledVector(up, -halfHeight),
      uv: new THREE.Vector2(1, 0),
    },
    {
      position: expandedCenter.clone().addScaledVector(right, halfWidth).addScaledVector(up, halfHeight),
      uv: new THREE.Vector2(1, 1),
    },
    {
      position: expandedCenter.clone().addScaledVector(right, -halfWidth).addScaledVector(up, halfHeight),
      uv: new THREE.Vector2(0, 1),
    },
  ], sourceFace, 0)

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
  }
}
