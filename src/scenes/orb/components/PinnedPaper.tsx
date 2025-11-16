import { useEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

import {
  PAPER_OFFSET,
  PAPER_SEGMENTS_X,
  PAPER_SEGMENTS_Y,
  PAPER_SPHERE_RADIUS,
} from './papers/constants'
import { getPaperBumpTexture } from './papers/paperTexture'
import { formatTimestamp } from '../../../utils/formatTimestamp'

const radius = PAPER_SPHERE_RADIUS + PAPER_OFFSET
const vertexPosition = new THREE.Vector3()
const normalVec = new THREE.Vector3()
const identityQuaternion = new THREE.Quaternion()

type Vector3Like = THREE.Vector3 | { x: number; y: number; z: number }
type QuaternionLike = THREE.Quaternion | { x: number; y: number; z: number; w: number }

export type PinData = {
  id: string
  position: Vector3Like
  color: string
}

type PinnedPaperProps = {
  texture: THREE.Texture | null
  aspect: number
  scale: number
  center: Vector3Like
  quaternion: QuaternionLike
  right?: Vector3Like
  up?: Vector3Like
  positions?: Float32Array
  normals?: Float32Array
  pins?: PinData[]
  layerOffset?: number
  rotation?: number
  interactive?: boolean
  showTooltip?: boolean
  onAddPin?: (worldPosition: THREE.Vector3) => void
  onPinHoverChange?: (hovering: boolean) => void
  onRemove?: () => void
  userId?: string
  username?: string | null
  createdAt?: string
  canDelete?: boolean
}

const PIN_SIZE = 0.014
const PIN_OFFSET = 0.012
const pinNormal = new THREE.Vector3(0, 0, 1)

export function PinnedPaper({
  texture,
  aspect,
  scale,
  center,
  quaternion,
  right,
  up,
  positions,
  normals,
  pins = [],
  layerOffset = 0,
  rotation = 0,
  interactive = false,
  showTooltip = false,
  onAddPin,
  onPinHoverChange,
  onRemove,
  userId,
  username,
  createdAt,
  canDelete = true,
}: PinnedPaperProps) {
  const meshRef = useRef<THREE.Mesh>(null)
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
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null)
  const [visiblePinIds, setVisiblePinIds] = useState<Set<string>>(new Set())
  const { camera } = useThree()
  
  // Temporary vectors for visibility calculations (reused each frame)
  const screenPosition = useMemo(() => new THREE.Vector3(), [])
  const pinToCamera = useMemo(() => new THREE.Vector3(), [])
  const tempSurfaceNormal = useMemo(() => new THREE.Vector3(), [])
  
  // Reusable Set for visibility calculations (avoid allocations every frame)
  const newVisiblePinIdsRef = useRef<Set<string>>(new Set())
  
  // Throttle state updates to reduce React reconciliation overhead
  const lastStateUpdateRef = useRef<number>(0)
  const pendingUpdateRef = useRef<Set<string> | null>(null)
  
  // Memoize formatted timestamp to avoid creating Date objects on every render
  // Uses utility function to handle timezone conversion consistently
  const formattedTimestamp = useMemo(() => formatTimestamp(createdAt), [createdAt])

  const centerVec = useMemo(() => {
    if (center instanceof THREE.Vector3) return center.clone()
    return new THREE.Vector3(center.x, center.y, center.z)
  }, [center])

  const quaternionValue = useMemo(() => {
    if (quaternion instanceof THREE.Quaternion) return quaternion.clone()
    return new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  }, [quaternion])

  const surfaceNormal = useMemo(() => centerVec.clone().normalize(), [centerVec])

  const basisRight = useMemo(() => {
    const vector = right
      ? right instanceof THREE.Vector3
        ? right.clone()
        : new THREE.Vector3(right.x, right.y, right.z)
      : new THREE.Vector3(1, 0, 0).applyQuaternion(quaternionValue)
    if (vector.lengthSq() < 1e-8) {
      vector.copy(new THREE.Vector3(1, 0, 0).applyQuaternion(quaternionValue))
    }
    if (!right && rotation !== 0) {
      vector.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(surfaceNormal, rotation))
    }
    return vector.normalize()
  }, [right, quaternionValue, rotation, surfaceNormal])

  const basisUp = useMemo(() => {
    const vector = up
      ? up instanceof THREE.Vector3
        ? up.clone()
        : new THREE.Vector3(up.x, up.y, up.z)
      : new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionValue)
    if (vector.lengthSq() < 1e-8) {
      vector.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionValue))
    }
    vector.normalize()

    const orthogonal = basisRight.clone().cross(centerVec.clone().normalize()).normalize()
    if (vector.dot(orthogonal) < 0) vector.multiplyScalar(-1)
    if (!up && rotation !== 0) {
      vector.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(surfaceNormal, rotation)).normalize()
    }
    return vector
  }, [up, quaternionValue, basisRight, centerVec, rotation, surfaceNormal])
  const halfWidth = useMemo(() => scale * aspect, [scale, aspect])
  const halfHeight = useMemo(() => scale, [scale])

  useEffect(() => {
    const positionsAttr = geometry.attributes.position as THREE.BufferAttribute
    const normalsAttr = geometry.attributes.normal as THREE.BufferAttribute
    const colorsAttr = geometry.attributes.color as THREE.BufferAttribute

    if (positions && normals && positions.length && normals.length) {
      positionsAttr.array.set(positions)
      normalsAttr.array.set(normals)
      let index = 0
      for (let y = 0; y <= PAPER_SEGMENTS_Y; y++) {
        const v = (y / PAPER_SEGMENTS_Y - 0.5) * 2
        for (let x = 0; x <= PAPER_SEGMENTS_X; x++) {
          const u = (x / PAPER_SEGMENTS_X - 0.5) * 2
          const edgeFactor = Math.max(Math.abs(u), Math.abs(v))
          const shade = THREE.MathUtils.lerp(0.88, 1.0, 1 - Math.pow(edgeFactor, 1.5))
          colorsAttr.setXYZ(index, shade, shade, shade)
          index += 1
        }
      }
    } else {
      const currentRadius = centerVec.length()
      const baseRadius = currentRadius > 0 ? currentRadius : radius + layerOffset

      const rotationX = new THREE.Quaternion()
      const rotationY = new THREE.Quaternion()
      const rotationCombined = new THREE.Quaternion()

      let index = 0
      for (let y = 0; y <= PAPER_SEGMENTS_Y; y++) {
        const v = (y / PAPER_SEGMENTS_Y - 0.5) * 2
        for (let x = 0; x <= PAPER_SEGMENTS_X; x++) {
          const u = (x / PAPER_SEGMENTS_X - 0.5) * 2

          const offsetRight = u * halfWidth
          const offsetUp = v * halfHeight
          const angleRight = offsetRight / baseRadius
          const angleUp = offsetUp / baseRadius

          rotationX.setFromAxisAngle(basisUp, angleRight)
          rotationY.setFromAxisAngle(basisRight, -angleUp)
          rotationCombined.multiplyQuaternions(rotationX, rotationY)

          normalVec.copy(centerVec.clone().normalize()).applyQuaternion(rotationCombined)
          vertexPosition.copy(normalVec).multiplyScalar(baseRadius)

          positionsAttr.setXYZ(index, vertexPosition.x, vertexPosition.y, vertexPosition.z)
          normalsAttr.setXYZ(index, normalVec.x, normalVec.y, normalVec.z)

          const edgeFactor = Math.max(Math.abs(u), Math.abs(v))
          const shade = THREE.MathUtils.lerp(0.88, 1.0, 1 - Math.pow(edgeFactor, 1.5))
          colorsAttr.setXYZ(index, shade, shade, shade)
          index += 1
        }
      }
    }

    positionsAttr.needsUpdate = true
    normalsAttr.needsUpdate = true
    colorsAttr.needsUpdate = true
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
  }, [geometry, centerVec, basisRight, basisUp, halfWidth, halfHeight, positions, normals, layerOffset])

  useEffect(() => {
    const material = materialRef.current
    if (!material) return

    const bumpTexture = getPaperBumpTexture()
    material.bumpMap = bumpTexture
    material.bumpScale = 0.018
    material.roughnessMap = bumpTexture
    material.roughness = 0.88
    material.metalness = 0.04
    material.vertexColors = true
    material.color.set('#f8f4ea')

    if (texture) {
      material.map = texture
      material.color.set('#ffffff')
    } else {
      material.map = null
      material.color.set('#f0eee6')
    }
    material.needsUpdate = true
  }, [texture])

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive || !onAddPin) return
    event.stopPropagation()
    onAddPin(event.point.clone())
  }

  const pinMeshes = useMemo(() => {
    return pins.map((pin) => {
      const basePosition =
        pin.position instanceof THREE.Vector3
          ? pin.position.clone()
          : new THREE.Vector3(pin.position.x, pin.position.y, pin.position.z)

      const offsetPosition = basePosition.clone()
      pinNormal
        .set(0, 0, 1)
        .applyQuaternion(quaternionValue)
        .normalize()
      offsetPosition.addScaledVector(pinNormal, PIN_OFFSET)

      const color = pin.color ?? '#ff4d4f'

      return { id: pin.id, position: offsetPosition, basePosition, color }
    })
  }, [pins, quaternionValue])

  // Check visibility of pins when showTooltip is enabled
  useFrame(() => {
    if (!showTooltip || pins.length === 0) {
      if (visiblePinIds.size > 0) {
        setVisiblePinIds(new Set())
      }
      return
    }

    // Reuse Set from ref and clear it (avoid allocation every frame)
    const newVisiblePinIds = newVisiblePinIdsRef.current
    newVisiblePinIds.clear()
    
    for (const pinMesh of pinMeshes) {
      // Project pin position to screen coordinates
      // Note: project() modifies the vector in place, so we copy the basePosition first
      screenPosition.copy(pinMesh.basePosition)
      screenPosition.project(camera)
      
      // Check if pin is within viewport bounds (with some margin)
      // Normalized device coordinates: x and y range from -1 to 1
      // z is the depth (also normalized, but we check separately)
      // Margin keeps tooltips visible even when pin is slightly outside viewport
      const margin = 0.30 // 30% margin - keeps tooltips visible longer before hiding
      const inViewport = 
        screenPosition.x >= -1 - margin && screenPosition.x <= 1 + margin &&
        screenPosition.y >= -1 - margin && screenPosition.y <= 1 + margin &&
        screenPosition.z >= -1 && screenPosition.z <= 1 // Check depth (z is normalized)
      
      if (!inViewport) continue
      
      // Check if pin is facing the camera (not on the back side of the orb)
      // Vector from pin position to camera position
      pinToCamera.copy(camera.position).sub(pinMesh.basePosition).normalize()
      // Surface normal at pin location (pointing outward from orb center)
      tempSurfaceNormal.copy(pinMesh.basePosition).normalize()
      // Dot product: positive = facing camera, negative = back side
      // Using a threshold (-0.3) instead of 0 allows tooltips to stay visible
      // even when pin is slightly angled away from camera but still in viewport
      const dotProduct = tempSurfaceNormal.dot(pinToCamera)
      const facingCamera = dotProduct > -0.18
      
      if (facingCamera) {
        newVisiblePinIds.add(pinMesh.id)
      }
    }
    
    // Only update state if visibility changed (avoid unnecessary re-renders)
    // Use Set-based comparison instead of array spread to avoid allocations
    let hasChanged = false
    if (newVisiblePinIds.size !== visiblePinIds.size) {
      hasChanged = true
    } else {
      // Compare Sets element by element without creating arrays
      for (const id of newVisiblePinIds) {
        if (!visiblePinIds.has(id)) {
          hasChanged = true
          break
        }
      }
      // Also check if any IDs were removed (only if sizes are equal and we haven't found a new ID)
      if (!hasChanged) {
        for (const id of visiblePinIds) {
          if (!newVisiblePinIds.has(id)) {
            hasChanged = true
            break
          }
        }
      }
    }
    
    // Throttle state updates to reduce React reconciliation overhead
    // Update immediately if changed, but limit frequency to every ~16ms (60fps)
    if (hasChanged) {
      const now = performance.now()
      const timeSinceLastUpdate = now - lastStateUpdateRef.current
      
      if (timeSinceLastUpdate >= 16) {
        // Create a new Set instance for state (React requires immutable updates)
        setVisiblePinIds(new Set(newVisiblePinIds))
        lastStateUpdateRef.current = now
        pendingUpdateRef.current = null
      } else {
        // Store pending update to apply later
        pendingUpdateRef.current = new Set(newVisiblePinIds)
      }
    }
  })
  
  // Apply pending updates on next frame if throttled
  useFrame(() => {
    if (pendingUpdateRef.current !== null) {
      const now = performance.now()
      const timeSinceLastUpdate = now - lastStateUpdateRef.current
      
      if (timeSinceLastUpdate >= 16) {
        setVisiblePinIds(pendingUpdateRef.current)
        lastStateUpdateRef.current = now
        pendingUpdateRef.current = null
      }
    }
  })

  const usesWorldSpaceGeometry = Boolean(positions && normals)

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geometry}
        quaternion={usesWorldSpaceGeometry ? identityQuaternion : quaternionValue}
        onPointerDown={handlePointerDown}
      >
        <meshStandardMaterial
          ref={materialRef}
          transparent
          roughness={0.92}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      {pinMeshes.map((pin) => {
        const isHovered = hoveredPinId === pin.id
        const isVisible = showTooltip ? visiblePinIds.has(pin.id) : true
        return (
          <group key={pin.id}>
            <mesh
              position={pin.position}
              scale={isHovered ? 2 : 1}
              onPointerOver={(event) => {
                event.stopPropagation()
                if (hoveredPinId !== pin.id) {
                  setHoveredPinId(pin.id)
                  onPinHoverChange?.(true)
                }
              }}
              onPointerOut={(event) => {
                event.stopPropagation()
                if (hoveredPinId === pin.id) {
                  setHoveredPinId(null)
                  onPinHoverChange?.(false)
                }
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (!canDelete) return
                if (hoveredPinId === pin.id) {
                  setHoveredPinId(null)
                  onPinHoverChange?.(false)
                }
                onRemove?.()
              }}
            >
              <sphereGeometry args={[PIN_SIZE, 16, 16]} />
              <meshStandardMaterial color={pin.color} metalness={0.1} roughness={0.35} />
            </mesh>
            {(isHovered || (showTooltip && isVisible)) && (
              <Html
                position={pin.position}
                style={{ pointerEvents: 'none' }}
              >
                <div className="pin-tooltip">
                  <div className="pin-tooltip__user">{username || userId || 'Unknown user'}</div>
                  {formattedTimestamp ? (
                    <div className="pin-tooltip__timestamp">
                      {formattedTimestamp}
                    </div>
                  ) : null}
                </div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}

