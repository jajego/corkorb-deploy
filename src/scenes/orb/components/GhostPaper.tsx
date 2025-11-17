import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import {
  PAPER_OFFSET,
  PAPER_SEGMENTS_X,
  PAPER_SEGMENTS_Y,
  PAPER_SPHERE_RADIUS,
} from './papers/constants'
import { getPaperBumpTexture } from './papers/paperTexture'

const outwardNormal = new THREE.Vector3()
const tangentRight = new THREE.Vector3()
const tangentUp = new THREE.Vector3()
const projectedRight = new THREE.Vector3()
const centerPosition = new THREE.Vector3()
const vertexPosition = new THREE.Vector3()
const vertexDirection = new THREE.Vector3()
const rayDirection = new THREE.Vector3()
const rayHit = new THREE.Vector3()
const rotationX = new THREE.Quaternion()
const rotationY = new THREE.Quaternion()
const rotationCombined = new THREE.Quaternion()
const worldUp = new THREE.Vector3(0, 1, 0)
const worldRight = new THREE.Vector3(1, 0, 0)

const quaternionBasis = new THREE.Quaternion()
const placeholderColor = new THREE.Color('#c8ccd3')
const whiteColor = new THREE.Color('#ffffff')
const darkBlueTint = new THREE.Color('#1e3a8a') // Dark blue for ghost paper overlay
const basisMatrix = new THREE.Matrix4()

export type GhostPaperTransform = {
  center: THREE.Vector3
  quaternion: THREE.Quaternion
  right: THREE.Vector3
  up: THREE.Vector3
}

type PointerState = {
  hasPointer: boolean
  x?: number
  y?: number
}

type GhostPaperProps = {
  texture: THREE.Texture | null
  aspect: number
  scale: number
  pointer: PointerState
  rotation?: number
  layerOffset?: number
  onTransformChange?: (transform: GhostPaperTransform) => void
  onGeometryChange?: (geometry: { positions: Float32Array; normals: Float32Array }) => void
}

function intersectRaySphere(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  radius: number,
  target: THREE.Vector3
): boolean {
  const a = direction.dot(direction)
  const b = 2 * origin.dot(direction)
  const c = origin.dot(origin) - radius * radius
  const discriminant = b * b - 4 * a * c

  if (discriminant < 0) return false

  const sqrt = Math.sqrt(discriminant)
  let t = (-b - sqrt) / (2 * a)
  if (t <= 0) {
    t = (-b + sqrt) / (2 * a)
    if (t <= 0) return false
  }

  target.copy(direction).multiplyScalar(t).add(origin)
  return true
}

export function GhostPaper({
  texture,
  aspect,
  scale,
  pointer,
  rotation = 0,
  layerOffset = 0,
  onTransformChange,
  onGeometryChange,
}: GhostPaperProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const geometryRef = useRef<THREE.PlaneGeometry>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const lastTextureRef = useRef<THREE.Texture | null>(null)
  const lastTextureReadyRef = useRef(false)
  const transformPayloadRef = useRef<GhostPaperTransform | null>(null)
  const geometryPayloadRef = useRef<{ positions: Float32Array; normals: Float32Array } | null>(null)
  const { camera, size, gl } = useThree()

  useEffect(() => {
    if (!texture) return
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.anisotropy =
      typeof gl.capabilities.getMaxAnisotropy === 'function'
        ? gl.capabilities.getMaxAnisotropy()
        : texture.anisotropy
    texture.needsUpdate = true
  }, [texture, gl])

  const geometry = useMemo(
    () => {
      const plane = new THREE.PlaneGeometry(1, 1, PAPER_SEGMENTS_X, PAPER_SEGMENTS_Y)
      const vertexCount = (PAPER_SEGMENTS_X + 1) * (PAPER_SEGMENTS_Y + 1)
      const colors = new Float32Array(vertexCount * 3)
      plane.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return plane
    },
    []
  )

  useFrame(() => {
    const mesh = meshRef.current
    const plane = geometryRef.current
    if (!mesh || !plane) return
    if (!(camera instanceof THREE.PerspectiveCamera)) return

    const pointerXScreen = pointer.hasPointer && pointer.x !== undefined ? pointer.x : size.width / 2
    const pointerYScreen = pointer.hasPointer && pointer.y !== undefined ? pointer.y : size.height / 2

    const ndcOriginalX = (pointerXScreen / size.width) * 2 - 1
    const ndcOriginalY = -(pointerYScreen / size.height) * 2 + 1
    const pointerX = THREE.MathUtils.clamp(ndcOriginalX, -1, 1)
    const pointerY = THREE.MathUtils.clamp(ndcOriginalY, -1, 1)

    const halfWidthWorld = scale * aspect
    const halfHeightWorld = scale

    rayDirection
      .set(pointerX, pointerY, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize()

    if (!intersectRaySphere(camera.position, rayDirection, PAPER_SPHERE_RADIUS, rayHit)) {
      return
    }

    const radius = PAPER_SPHERE_RADIUS + PAPER_OFFSET + layerOffset
    outwardNormal.copy(rayHit).normalize()
    centerPosition.copy(outwardNormal).multiplyScalar(radius)

    projectedRight.copy(worldUp).cross(outwardNormal)
    if (projectedRight.lengthSq() < 1e-6) {
      projectedRight.copy(worldRight).cross(outwardNormal)
    }
    projectedRight.normalize()

    tangentRight.copy(projectedRight)
    tangentUp.copy(outwardNormal).cross(tangentRight).normalize()

    if (rotation !== 0) {
      const rotationQuat = new THREE.Quaternion().setFromAxisAngle(outwardNormal, rotation)
      tangentRight.applyQuaternion(rotationQuat).normalize()
      tangentUp.applyQuaternion(rotationQuat).normalize()
    }

    const positions = plane.attributes.position as THREE.BufferAttribute
    const normals = plane.attributes.normal as THREE.BufferAttribute
    const colors = plane.attributes.color as THREE.BufferAttribute

    let index = 0
    for (let y = 0; y <= PAPER_SEGMENTS_Y; y++) {
      const v = (y / PAPER_SEGMENTS_Y - 0.5) * 2
      for (let x = 0; x <= PAPER_SEGMENTS_X; x++) {
        const u = (x / PAPER_SEGMENTS_X - 0.5) * 2

        const offsetRight = u * halfWidthWorld
        const offsetUp = v * halfHeightWorld

        const angleRight = offsetRight / radius
        const angleUp = offsetUp / radius

        rotationX.setFromAxisAngle(tangentUp, angleRight)
        rotationY.setFromAxisAngle(tangentRight, -angleUp)
        rotationCombined.multiplyQuaternions(rotationX, rotationY)

        vertexDirection.copy(outwardNormal).applyQuaternion(rotationCombined)
        vertexPosition.copy(vertexDirection).multiplyScalar(radius)

        positions.setXYZ(index, vertexPosition.x, vertexPosition.y, vertexPosition.z)
        normals.setXYZ(
          index,
          vertexDirection.x,
          vertexDirection.y,
          vertexDirection.z
        )

        const edgeFactor = Math.max(Math.abs(u), Math.abs(v))
        const shade = THREE.MathUtils.lerp(0.9, 1.0, 1 - Math.pow(edgeFactor, 1.5))
        colors.setXYZ(index, shade, shade, shade)
        index += 1
      }
    }

    positions.needsUpdate = true
    normals.needsUpdate = true
    colors.needsUpdate = true

    basisMatrix.makeBasis(tangentRight, tangentUp, outwardNormal)
    quaternionBasis.setFromRotationMatrix(basisMatrix)

    mesh.position.set(0, 0, 0)
    mesh.quaternion.identity()
    mesh.scale.set(1, 1, 1)
    mesh.visible = true

    const material = materialRef.current
    if (!material) return

    const bumpTexture = getPaperBumpTexture()
    material.bumpMap = bumpTexture
    material.bumpScale = 0.014
    material.roughnessMap = bumpTexture
    material.roughness = 0.9
    material.metalness = 0.02
    material.vertexColors = true

    const textureReady = Boolean(texture)
    if (
      textureReady !== lastTextureReadyRef.current ||
      (textureReady && texture !== lastTextureRef.current)
    ) {
      if (textureReady) {
        material.map = texture
        // Apply dark blue tint for ghost paper appearance (0.5 opacity overlay effect)
        // Multiply white by dark blue to create the tinted effect
        material.color.copy(whiteColor).multiply(darkBlueTint)
        material.opacity = 0.5
      } else {
        material.map = null
        material.color.copy(placeholderColor)
        material.opacity = 0.5
      }
      material.needsUpdate = true
      lastTextureReadyRef.current = textureReady
      lastTextureRef.current = textureReady ? texture : null
    }

    if (onTransformChange) {
      let payload = transformPayloadRef.current
      if (!payload) {
        payload = {
          center: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          right: new THREE.Vector3(),
          up: new THREE.Vector3(),
        }
        transformPayloadRef.current = payload
      }
      payload.center.copy(centerPosition)
      payload.quaternion.copy(quaternionBasis)
      payload.right.copy(tangentRight)
      payload.up.copy(tangentUp)
      onTransformChange(payload)
    }

    if (onGeometryChange) {
      const sourcePositions = positions.array as Float32Array
      const sourceNormals = normals.array as Float32Array
      let payload = geometryPayloadRef.current
      if (!payload || payload.positions.length !== sourcePositions.length || payload.normals.length !== sourceNormals.length) {
        payload = {
          positions: new Float32Array(sourcePositions.length),
          normals: new Float32Array(sourceNormals.length),
        }
        geometryPayloadRef.current = payload
      }
      payload.positions.set(sourcePositions)
      payload.normals.set(sourceNormals)
      onGeometryChange(payload)
    }
  })

  return (
    <mesh ref={meshRef} geometry={geometry} visible={false}>
      <primitive ref={geometryRef} object={geometry} attach="geometry" />
      <meshStandardMaterial
        ref={materialRef}
        transparent
        roughness={0.92}
        metalness={0}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        vertexColors
      />
    </mesh>
  )
}

