import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import { ORB_EVENT } from '../../../three/constants/events'
import { usePinchGesture } from '../hooks/usePinchGesture'

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

type PointerPosition = { x: number; y: number }

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

  const spherical = useRef(new THREE.Spherical(3.5, Math.PI / 2, 0))
  const lastPointer = useRef<PointerPosition | null>(null)
  const velocity = useRef({ theta: 0, phi: 0 })
  const overrideRef = useRef<THREE.Spherical | null>(null)

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

  // Pinch-to-zoom gesture for touch devices
  usePinchGesture(
    gl.domElement,
    {
      onPinchStart: () => {
        // Pinch started - immediately stop any active single-finger drag to prevent rotation
        // This fixes the issue where pinching causes unexpected orb rotation
        if (draggingOrbRef.current) {
          setDraggingOrb(false)
          touchDragActiveRef.current = false
          touchStartRef.current = null
          lastPointer.current = null
        }
      },
      onPinchMove: (scale) => {
        if (!controlsEnabled) return
        const s = spherical.current
        
        // Apply pinch scale to zoom (radius)
        // Invert scale so pinch out = zoom in (like mouse wheel)
        const zoomFactor = 1 / scale
        s.radius = THREE.MathUtils.clamp(s.radius * zoomFactor, MIN_RADIUS, MAX_RADIUS)
      },
      onPinchEnd: () => {
        // Pinch ended
      },
    },
    controlsEnabled
  )

  // Track single-finger touch drag for better touch device support
  const touchDragActiveRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  // Use a ref to track dragging state so we don't need to recreate event listeners
  const draggingOrbRef = useRef(draggingOrb)
  
  // Keep ref in sync with prop
  useEffect(() => {
    draggingOrbRef.current = draggingOrb
  }, [draggingOrb])

  useEffect(() => {
    const dom = gl.domElement

    const handleStartDrag = (event: Event) => {
      if (!controlsEnabled) return
      const detail = (event as CustomEvent<PointerPosition>).detail
      lastPointer.current = detail
      // Mark that pointer events are handling the drag (prevents touch handlers from double-processing)
      touchDragActiveRef.current = false
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!controlsEnabled || !draggingOrbRef.current || !lastPointer.current) return
      
      // Allow touch events for single-finger rotation (pointer events work for touch too)
      // Two-finger gestures (pinch/twist) are handled separately by touch event handlers
      // and won't trigger pointer events in the same way

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
      if (!controlsEnabled || !draggingOrbRef.current) return
      setDraggingOrb(false)
      lastPointer.current = null
      touchDragActiveRef.current = false
      touchStartRef.current = null
    }

    const handlePointerCancel = () => {
      // Handle touch cancellation (e.g., when scrolling starts)
      if (!controlsEnabled || !draggingOrbRef.current) return
      setDraggingOrb(false)
      lastPointer.current = null
      touchDragActiveRef.current = false
      touchStartRef.current = null
    }

    // Handle single-finger touch drag (fallback for devices where pointer events don't work well)
    // IMPORTANT: TouchEvent handlers ONLY fire for actual touch input, NEVER for mouse clicks.
    // Mouse interactions trigger MouseEvent/PointerEvent, which are completely separate.
    // This means these handlers are completely isolated from desktop mouse logic.
    const handleTouchStart = (event: TouchEvent) => {
      if (!controlsEnabled) return
      // Only handle single-finger touches - two-finger gestures are handled by usePinchGesture
      if (event.touches.length !== 1) return
      
      // Check if pointer events are already handling this (normal case on real touch devices)
      // If draggingOrb is true but touchDragActiveRef is false, pointer events are handling it
      // In that case, we don't want to interfere - pointer events will update the camera
      if (draggingOrbRef.current && !touchDragActiveRef.current) {
        // Pointer events are handling it - don't interfere, just return
        return
      }
      
      // Fallback: Start dragging from touch event if pointer events didn't fire
      // This primarily helps with Chrome DevTools touch emulation where pointer events
      // might not fire reliably. On real touch devices, pointer events usually fire first.
      const touch = event.touches[0]
      touchDragActiveRef.current = true
      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
      lastPointer.current = { x: touch.clientX, y: touch.clientY }
      
      // Start dragging - works as fallback when pointer events don't fire
      setDraggingOrb(true)
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!controlsEnabled) return
      // Only handle single-finger touches - two-finger gestures are handled by usePinchGesture
      if (event.touches.length !== 1) {
        // If we were dragging with one finger but now have two fingers, stop dragging
        if (touchDragActiveRef.current && event.touches.length === 2) {
          touchDragActiveRef.current = false
          touchStartRef.current = null
          if (draggingOrbRef.current) {
            setDraggingOrb(false)
          }
        }
        return
      }
      
      // Only process if we're actively dragging (either from touch or pointer events)
      // This prevents conflicts - if pointer events are handling it, we don't double-process
      // The touchDragActiveRef tracks if touch initiated the drag, but we check draggingOrbRef
      // to ensure we only process when drag is actually active
      if (!draggingOrbRef.current || !lastPointer.current) return
      
      // If pointer events are handling this (normal case), they'll update the camera.
      // Touch handler only needs to update if pointer events aren't working.
      // Check if this is a touch-initiated drag (not pointer-initiated)
      if (!touchDragActiveRef.current) {
        // Pointer events are handling it - just update touch tracking ref but don't process
        return
      }
      
      const touch = event.touches[0]
      const dx = touch.clientX - lastPointer.current.x
      const dy = touch.clientY - lastPointer.current.y
      lastPointer.current = { x: touch.clientX, y: touch.clientY }

      const s = spherical.current

      s.theta -= dx * ROTATE_SENSITIVITY
      s.phi -= dy * ROTATE_SENSITIVITY
      s.phi = THREE.MathUtils.clamp(s.phi, MIN_PHI, MAX_PHI)

      velocity.current.theta = -dx * ROTATE_SENSITIVITY
      velocity.current.phi = -dy * ROTATE_SENSITIVITY
      
      // Prevent scrolling while dragging (only affects touch, not mouse)
      event.preventDefault()
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (!controlsEnabled) return
      // Only end drag if all touches are gone or we have 2 touches (pinch gesture)
      if (event.touches.length === 0) {
        touchDragActiveRef.current = false
        touchStartRef.current = null
        if (draggingOrbRef.current) {
          setDraggingOrb(false)
        }
        lastPointer.current = null
      } else if (event.touches.length === 2) {
        // Two-finger gesture started - stop single-finger drag
        touchDragActiveRef.current = false
        touchStartRef.current = null
        if (draggingOrbRef.current) {
          setDraggingOrb(false)
        }
      }
    }

    const handleTouchCancel = () => {
      if (!controlsEnabled) return
      touchDragActiveRef.current = false
      touchStartRef.current = null
      if (draggingOrbRef.current) {
        setDraggingOrb(false)
      }
      lastPointer.current = null
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!controlsEnabled) return
      const s = spherical.current

      const direction = event.deltaY > 0 ? 1 : -1
      const factor = 1 + direction * ZOOM_FACTOR

      s.radius = THREE.MathUtils.clamp(s.radius * factor, MIN_RADIUS, MAX_RADIUS)
    }

    window.addEventListener(ORB_EVENT.startDrag, handleStartDrag)
    dom.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    // Add touch event handlers for single-finger drag (fallback for better touch support)
    // Use capture phase to run after usePinchGesture (which also uses capture)
    // But only handle single-finger touches, which usePinchGesture ignores
    dom.addEventListener('touchstart', handleTouchStart, { passive: false, capture: false })
    dom.addEventListener('touchmove', handleTouchMove, { passive: false, capture: false })
    dom.addEventListener('touchend', handleTouchEnd, { passive: false, capture: false })
    dom.addEventListener('touchcancel', handleTouchCancel, { passive: false, capture: false })
    dom.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      window.removeEventListener(ORB_EVENT.startDrag, handleStartDrag)
      dom.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      dom.removeEventListener('touchstart', handleTouchStart)
      dom.removeEventListener('touchmove', handleTouchMove)
      dom.removeEventListener('touchend', handleTouchEnd)
      dom.removeEventListener('touchcancel', handleTouchCancel)
      dom.removeEventListener('wheel', handleWheel)
    }
  }, [gl, setDraggingOrb, controlsEnabled])

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

