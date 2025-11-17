import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useDrag, usePinch } from '@use-gesture/react'

import { ORB_EVENT } from '../../../three/constants/events'
import { useTouchDetection } from '../hooks/useTouchDetection'

const ROTATE_SENSITIVITY = 0.004
const DAMPING = 0.92
const EPS = 0.001
const MIN_PHI = EPS
const MAX_PHI = Math.PI - EPS
const MIN_RADIUS = 1.6
const MAX_RADIUS = 6.0
const ZOOM_FACTOR = 0.12
// Controls the pacing/speed of camera transitions when override target is set (e.g., zoom when entering attach mode)
// Higher values = faster transition, lower values = slower transition
// Range: 0.0 (never reaches target) to 1.0 (instant)
const CAMERA_OVERRIDE_LERP = 0.12

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function lerpAngle(current: number, target: number, alpha: number) {
  const delta = wrapAngle(target - current)
  return current + delta * alpha
}

type CameraControllerProps = {
  draggingOrb: boolean
  setDraggingOrb: (dragging: boolean) => void
  idleAutoRotateEnabled: boolean
  autoRotateSpeed?: number
  controlsEnabled: boolean
  overrideTarget?: { radius?: number; phi?: number; theta?: number } | null
  onSphericalChange?: (spherical: THREE.Spherical) => void
}

export function CameraController({
  draggingOrb,
  setDraggingOrb,
  idleAutoRotateEnabled,
  autoRotateSpeed = 0.05,
  controlsEnabled,
  overrideTarget = null,
  onSphericalChange,
}: CameraControllerProps) {
  const { camera, gl } = useThree()
  const isTouchDevice = useTouchDetection()

  const spherical = useRef(new THREE.Spherical(3.5, Math.PI / 2, 0))
  const velocity = useRef({ theta: 0, phi: 0 })
  const overrideRef = useRef<THREE.Spherical | null>(null)
  const initialPinchRadiusRef = useRef<number | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const draggingOrbRef = useRef(draggingOrb)
  
  // Keep ref in sync with prop
  useEffect(() => {
    draggingOrbRef.current = draggingOrb
  }, [draggingOrb])

  useEffect(() => {
    const s = spherical.current
    camera.position.setFromSpherical(s)
    camera.lookAt(0, 0, 0)
  }, [camera])

  useEffect(() => {
    if (overrideTarget) {
      const current = spherical.current
      const targetTheta = overrideTarget?.theta ?? current.theta
      overrideRef.current = new THREE.Spherical(
        overrideTarget?.radius ?? current.radius,
        overrideTarget?.phi ?? current.phi,
        current.theta + wrapAngle(targetTheta - current.theta)
      )
      velocity.current.theta = 0
      velocity.current.phi = 0
    } else {
      overrideRef.current = null
    }
  }, [overrideTarget])

  // Use @use-gesture/react for touch devices only
  // Desktop uses the original pointer event system below
  useDrag(
    ({ movement: [mx, my], dragging, first, last }) => {
      if (!controlsEnabled || !isTouchDevice) return
      
      if (first) {
        setDraggingOrb(true)
        velocity.current.theta = 0
        velocity.current.phi = 0
      }
      
      if (dragging) {
        const s = spherical.current
        s.theta -= mx * ROTATE_SENSITIVITY
        s.phi -= my * ROTATE_SENSITIVITY
        s.phi = THREE.MathUtils.clamp(s.phi, MIN_PHI, MAX_PHI)
        
        velocity.current.theta = -mx * ROTATE_SENSITIVITY
        velocity.current.phi = -my * ROTATE_SENSITIVITY
      }
      
      if (last) {
        setDraggingOrb(false)
      }
    },
    {
      target: gl.domElement,
      enabled: isTouchDevice && controlsEnabled,
      pointer: { buttons: [0, 1, 2, 3, 4] },
      preventDefault: false, // Don't prevent default to avoid passive listener errors
      filterTaps: true,
    }
  )

  // Use @use-gesture/react for pinch (zoom) - touch only
  usePinch(
    ({ offset: [scale], first, last }) => {
      if (!controlsEnabled || !isTouchDevice) return
      
      if (first) {
        // Store initial radius when pinch starts
        initialPinchRadiusRef.current = spherical.current.radius
        // Clear velocity when pinch starts to prevent rotation during pinch
        velocity.current.theta = 0
        velocity.current.phi = 0
      }
      
      if (initialPinchRadiusRef.current !== null) {
        const s = spherical.current
        // offset[0] is the accumulated scale from the start of the pinch
        // Invert so pinch out = zoom in (like mouse wheel)
        const zoomFactor = 1 / scale
        s.radius = THREE.MathUtils.clamp(
          initialPinchRadiusRef.current * zoomFactor,
          MIN_RADIUS,
          MAX_RADIUS
        )
      }
      
      if (last) {
        // Clear initial radius when pinch ends
        initialPinchRadiusRef.current = null
        velocity.current.theta = 0
        velocity.current.phi = 0
      }
    },
    {
      target: gl.domElement,
      enabled: isTouchDevice && controlsEnabled,
      preventDefault: false, // Don't prevent default to avoid passive listener errors
    }
  )

  // Desktop pointer event handlers (original implementation)
  useEffect(() => {
    if (!controlsEnabled || isTouchDevice) return undefined
    
    const dom = gl.domElement

    const handleStartDrag = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail
      lastPointer.current = detail
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingOrbRef.current || !lastPointer.current) return
      
      const dx = event.clientX - lastPointer.current.x
      const dy = event.clientY - lastPointer.current.y
      lastPointer.current = { x: event.clientX, y: event.clientY }

      const s = spherical.current
      s.theta -= dx * ROTATE_SENSITIVITY
      s.phi -= dy * ROTATE_SENSITIVITY
      s.phi = THREE.MathUtils.clamp(s.phi, MIN_PHI, MAX_PHI)

      velocity.current.theta = -dx * ROTATE_SENSITIVITY
      velocity.current.phi = -dy * ROTATE_SENSITIVITY
    }

    const handlePointerUp = () => {
      if (!draggingOrbRef.current) return
      setDraggingOrb(false)
      lastPointer.current = null
    }

    const handlePointerCancel = () => {
      if (!draggingOrbRef.current) return
      setDraggingOrb(false)
      lastPointer.current = null
    }

    window.addEventListener(ORB_EVENT.startDrag, handleStartDrag)
    dom.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      window.removeEventListener(ORB_EVENT.startDrag, handleStartDrag)
      dom.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [gl, controlsEnabled, isTouchDevice, setDraggingOrb])

  // Handle mouse wheel zoom (desktop)
  useEffect(() => {
    if (!controlsEnabled) return undefined
    
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const s = spherical.current
      const direction = event.deltaY > 0 ? 1 : -1
      const factor = 1 + direction * ZOOM_FACTOR
      s.radius = THREE.MathUtils.clamp(s.radius * factor, MIN_RADIUS, MAX_RADIUS)
    }

    const dom = gl.domElement
    dom.addEventListener('wheel', handleWheel, { passive: false })
    
    return () => {
      dom.removeEventListener('wheel', handleWheel)
    }
  }, [gl, controlsEnabled])

  // Handle custom startDrag event (for compatibility with existing code)
  // Only needed for desktop (touch devices use useDrag above)
  useEffect(() => {
    if (!controlsEnabled || isTouchDevice) return undefined
    
    const handleStartDrag = () => {
      setDraggingOrb(true)
      velocity.current.theta = 0
      velocity.current.phi = 0
    }

    window.addEventListener(ORB_EVENT.startDrag, handleStartDrag)
    
    return () => {
      window.removeEventListener(ORB_EVENT.startDrag, handleStartDrag)
    }
  }, [controlsEnabled, isTouchDevice, setDraggingOrb])

  useFrame((_, delta) => {
    const s = spherical.current
    const v = velocity.current

    const override = overrideRef.current

    if (override) {
      s.radius = THREE.MathUtils.lerp(s.radius, override.radius, CAMERA_OVERRIDE_LERP)
      s.phi = THREE.MathUtils.lerp(s.phi, override.phi, CAMERA_OVERRIDE_LERP)
      s.theta = lerpAngle(s.theta, override.theta, CAMERA_OVERRIDE_LERP)
      v.theta = 0
      v.phi = 0
    } else if (!draggingOrb) {
      s.theta += v.theta
      s.phi += v.phi

      v.theta *= DAMPING
      v.phi *= DAMPING

      if (
        idleAutoRotateEnabled &&
        Math.abs(v.theta) < 0.00002 &&
        Math.abs(v.phi) < 0.00002
      ) {
        s.theta += autoRotateSpeed * delta
      }
    } else if (!controlsEnabled) {
      v.theta = 0
      v.phi = 0
    }

    s.phi = THREE.MathUtils.clamp(s.phi, MIN_PHI, MAX_PHI)
    s.radius = THREE.MathUtils.clamp(s.radius, MIN_RADIUS, MAX_RADIUS)
    s.theta = wrapAngle(s.theta)

    camera.position.setFromSpherical(s)
    camera.lookAt(0, 0, 0)

    if (onSphericalChange) {
      onSphericalChange(s.clone())
    }
  })

  return null
}

