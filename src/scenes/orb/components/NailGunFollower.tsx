import { useFrame, useThree } from '@react-three/fiber'
import { Hud, useGLTF } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

import { OrbLights } from './OrbLights'

const NAILGUN_MODEL_PATH = '/models/nailgun.glb'
const POSITION_LERP = 0.2
const ROTATION_LERP = 0.35
const CAMERA_PLANE_DEPTH = 1.9
const GUN_FORWARD_OFFSET = -0.12
const MAX_YAW = THREE.MathUtils.degToRad(26)
const BASE_SIDE_YAW = THREE.MathUtils.degToRad(18)
const IDLE_PITCH = THREE.MathUtils.degToRad(-3)
const POINTER_EDGE_RADIUS = 0.92

// Positioning values (default)
const LATERAL_BASE_OFFSET_POSITIONING = 0.36
const LATERAL_EDGE_OFFSET_POSITIONING = 0.28
const GUN_VERTICAL_OFFSET_POSITIONING = 0.14
const MODEL_SCALE_POSITIONING = 0.43
const SCALE_EDGE_FACTOR_POSITIONING = 0.12

// Pinning values (pressed against orb)
const LATERAL_BASE_OFFSET_PINNING = 0.10
const LATERAL_EDGE_OFFSET_PINNING = 0.08
const GUN_VERTICAL_OFFSET_PINNING = 0.05
const MODEL_SCALE_PINNING = 0.23
const SCALE_EDGE_FACTOR_PINNING = 0.25

// Transition speed (higher = faster transition)
const TRANSITION_LERP = 0.3

const pointerNDCOriginal = new THREE.Vector2()
const pointerNDC = new THREE.Vector2()
const forwardVec = new THREE.Vector3()
const rightVec = new THREE.Vector3()
const upVec = new THREE.Vector3()
const pointerDir = new THREE.Vector3()
const tmpVec = new THREE.Vector3()
const worldTarget = new THREE.Vector3()
const targetQuaternion = new THREE.Quaternion()
const adjustQuaternion = new THREE.Quaternion()
const adjustEuler = new THREE.Euler(0, 0, 0, 'YXZ')

type PointerMetrics = {
  pointerX: number
  pointerY: number
  pointerRadius: number
  side: number
  mirrored: boolean
  centerBlend: number
}

function computePointerMetrics(
  pointer: { x: number; y: number },
  size: { width: number; height: number },
  ndcOriginal: THREE.Vector2,
  ndc: THREE.Vector2
): PointerMetrics {
  const clampedX = THREE.MathUtils.clamp(pointer.x / size.width, 0, 1)
  const clampedY = THREE.MathUtils.clamp(pointer.y / size.height, 0, 1)

  ndcOriginal.set(clampedX * 2 - 1, -(clampedY * 2 - 1))
  ndc.copy(ndcOriginal)

  const radiusSquared = ndc.lengthSq()
  const maxRadiusSquared = POINTER_EDGE_RADIUS * POINTER_EDGE_RADIUS
  if (radiusSquared > maxRadiusSquared) {
    ndc.multiplyScalar(Math.sqrt(maxRadiusSquared / radiusSquared))
  }

  const pointerX = ndc.x
  const pointerY = ndc.y
  const side = pointerX >= 0 ? 1 : -1

  return {
    pointerX,
    pointerY,
    pointerRadius: ndcOriginal.length(),
    side,
    mirrored: side === 1,
    centerBlend: Math.min(1, Math.abs(pointerX)),
  }
}

function applyCameraBasis(
  camera: THREE.PerspectiveCamera,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3
) {
  camera.getWorldDirection(forward).normalize()
  right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
  up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize()
}

function buildScreenSpaceTarget(
  camera: THREE.PerspectiveCamera,
  size: { width: number; height: number },
  metrics: PointerMetrics,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  pointerDirection: THREE.Vector3,
  scratch: THREE.Vector3,
  out: THREE.Vector3,
  lateralBaseOffset: number,
  lateralEdgeOffset: number,
  gunVerticalOffset: number
) {
  pointerDirection.copy(forward).multiplyScalar(CAMERA_PLANE_DEPTH)

  const halfHeight =
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAMERA_PLANE_DEPTH
  const halfWidth = halfHeight * (size.width / size.height)

  out.copy(camera.position).add(pointerDirection)

  scratch.copy(right).multiplyScalar(metrics.pointerX * halfWidth)
  out.add(scratch)

  scratch.copy(up).multiplyScalar(metrics.pointerY * halfHeight)
  out.add(scratch)

  const lateralOffset =
    lateralBaseOffset + lateralEdgeOffset * metrics.centerBlend
  scratch.copy(right).multiplyScalar(lateralOffset * metrics.side)
  out.add(scratch)

  scratch.copy(up).multiplyScalar(gunVerticalOffset)
  out.add(scratch)

  scratch.copy(forward).multiplyScalar(GUN_FORWARD_OFFSET)
  out.add(scratch)
}

function updateGroupOrientation(
  group: THREE.Group,
  camera: THREE.PerspectiveCamera,
  metrics: PointerMetrics,
  firstFrame: boolean
) {
  targetQuaternion.copy(camera.quaternion)

  const yawTowardCenter = THREE.MathUtils.clamp(
    -metrics.pointerX * MAX_YAW,
    -MAX_YAW,
    MAX_YAW
  )
  const sideBias = metrics.side === 1 ? BASE_SIDE_YAW : -BASE_SIDE_YAW

  adjustEuler.set(IDLE_PITCH, sideBias + yawTowardCenter, 0)
  adjustQuaternion.setFromEuler(adjustEuler)
  targetQuaternion.multiply(adjustQuaternion)

  if (firstFrame) {
    group.quaternion.copy(targetQuaternion)
  } else {
    group.quaternion.slerp(targetQuaternion, ROTATION_LERP)
  }
}

type NailGunFollowerProps = {
  active: boolean
  pointer: {
    hasPointer: boolean
    x?: number
    y?: number
  }
  isPinning?: boolean
}

export function NailGunFollower({ active, pointer, isPinning = false }: NailGunFollowerProps) {
  const groupRef = useRef<THREE.Group>(null)
  const modelRef = useRef<THREE.Group>(null)
  const wasVisibleRef = useRef(false)
  const { camera, size } = useThree()
  const gltf = useGLTF(NAILGUN_MODEL_PATH)
  
  // Interpolated values that smoothly transition between positioning and pinning
  const lateralBaseOffsetRef = useRef(LATERAL_BASE_OFFSET_POSITIONING)
  const lateralEdgeOffsetRef = useRef(LATERAL_EDGE_OFFSET_POSITIONING)
  const gunVerticalOffsetRef = useRef(GUN_VERTICAL_OFFSET_POSITIONING)
  const modelScaleRef = useRef(MODEL_SCALE_POSITIONING)
  const scaleEdgeFactorRef = useRef(SCALE_EDGE_FACTOR_POSITIONING)

  const modelScene = useMemo(() => {
    const scene = gltf.scene.clone(true)
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = false
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material]
        materials.forEach((material) => {
          material.side = THREE.DoubleSide
          material.needsUpdate = true
        })
      }
    })

    const bounds = new THREE.Box3().setFromObject(scene)
    const size = bounds.getSize(new THREE.Vector3())
    const topOffset = bounds.max.y
    scene.position.y -= topOffset
    scene.userData.topOffset = topOffset
    scene.userData.height = size.y

    return scene
  }, [gltf])

  useFrame(() => {
    const group = groupRef.current
    const model = modelRef.current
    if (!group || !model) return

    // Smoothly interpolate between positioning and pinning values
    const targetLateralBaseOffset = isPinning
      ? LATERAL_BASE_OFFSET_PINNING
      : LATERAL_BASE_OFFSET_POSITIONING
    const targetLateralEdgeOffset = isPinning
      ? LATERAL_EDGE_OFFSET_PINNING
      : LATERAL_EDGE_OFFSET_POSITIONING
    const targetGunVerticalOffset = isPinning
      ? GUN_VERTICAL_OFFSET_PINNING
      : GUN_VERTICAL_OFFSET_POSITIONING
    const targetModelScale = isPinning
      ? MODEL_SCALE_PINNING
      : MODEL_SCALE_POSITIONING
    const targetScaleEdgeFactor = isPinning
      ? SCALE_EDGE_FACTOR_PINNING
      : SCALE_EDGE_FACTOR_POSITIONING

    // Lerp current values towards target values
    lateralBaseOffsetRef.current = THREE.MathUtils.lerp(
      lateralBaseOffsetRef.current,
      targetLateralBaseOffset,
      TRANSITION_LERP
    )
    lateralEdgeOffsetRef.current = THREE.MathUtils.lerp(
      lateralEdgeOffsetRef.current,
      targetLateralEdgeOffset,
      TRANSITION_LERP
    )
    gunVerticalOffsetRef.current = THREE.MathUtils.lerp(
      gunVerticalOffsetRef.current,
      targetGunVerticalOffset,
      TRANSITION_LERP
    )
    modelScaleRef.current = THREE.MathUtils.lerp(
      modelScaleRef.current,
      targetModelScale,
      TRANSITION_LERP
    )
    scaleEdgeFactorRef.current = THREE.MathUtils.lerp(
      scaleEdgeFactorRef.current,
      targetScaleEdgeFactor,
      TRANSITION_LERP
    )

    const visible = active && pointer.hasPointer
    group.visible = visible
    if (!visible || pointer.x == null || pointer.y == null) {
      wasVisibleRef.current = false
      return
    }

    if (!(camera instanceof THREE.PerspectiveCamera)) {
      wasVisibleRef.current = false
      return
    }

    const metrics = computePointerMetrics(
      { x: pointer.x!, y: pointer.y! },
      size,
      pointerNDCOriginal,
      pointerNDC
    )

    applyCameraBasis(camera, forwardVec, rightVec, upVec)
    buildScreenSpaceTarget(
      camera,
      size,
      metrics,
      forwardVec,
      rightVec,
      upVec,
      pointerDir,
      tmpVec,
      worldTarget,
      lateralBaseOffsetRef.current,
      lateralEdgeOffsetRef.current,
      gunVerticalOffsetRef.current
    )

    const { mirrored, pointerRadius } = metrics

    if (!wasVisibleRef.current) {
      group.position.copy(worldTarget)
    } else {
      group.position.lerp(worldTarget, POSITION_LERP)
    }

    updateGroupOrientation(
      group,
      camera,
      metrics,
      !wasVisibleRef.current
    )

    const edgeFactor = THREE.MathUtils.clamp(pointerRadius, 0, 1)
    const dynamicScale = modelScaleRef.current * (1 - scaleEdgeFactorRef.current * edgeFactor)

    model.scale.set(
      dynamicScale * (mirrored ? -1 : 1),
      dynamicScale,
      dynamicScale
    )
    model.rotation.set(0, 0, 0)
    wasVisibleRef.current = true
  })

  return (
    <Hud>
      <OrbLights />
      <group ref={groupRef} visible={false}>
        <group ref={modelRef}>
          <primitive object={modelScene} />
        </group>
      </group>
    </Hud>
  )
}

useGLTF.preload(NAILGUN_MODEL_PATH)

