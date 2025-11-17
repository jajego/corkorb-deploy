import { useThree } from '@react-three/fiber'
import { useDrag, usePinch } from '@use-gesture/react'
import { useRef } from 'react'

type MobileGhostPaperGesturesProps = {
  enabled: boolean
  onDrag: (x: number, y: number) => void
  onPinchTransform: (transform: { scale: number; rotation: number; x: number; y: number }) => void
  onInteractionStart?: () => void
  onInteractionEnd?: () => void
}

/**
 * Component that handles touch gestures for ghost paper positioning on mobile.
 * Uses @use-gesture/react for drag and combined pinch (scale + rotate + drag) gestures.
 * Must be rendered inside a Canvas context to access the WebGL renderer's DOM element.
 */
export function MobileGhostPaperGestures({
  enabled,
  onDrag,
  onPinchTransform,
  onInteractionStart,
  onInteractionEnd,
}: MobileGhostPaperGesturesProps) {
  const { gl } = useThree()
  const isPinchingRef = useRef(false)
  const lastAngleRef = useRef<number | null>(null)
  const initialScaleRef = useRef<number>(1.0)
  const initialRotationRef = useRef<number>(0)

  // Single-finger drag for positioning the ghost paper
  // Disabled when pinch is active to prevent conflicts
  useDrag(
    ({ xy: [x, y], dragging, first, last }) => {
      if (!enabled || isPinchingRef.current) return
      
      if (first) {
        onInteractionStart?.()
      }
      
      if (dragging) {
        // Update pointer position to move ghost paper
        onDrag(x, y)
      }
      
      if (last) {
        onInteractionEnd?.()
      }
    },
    {
      target: gl.domElement,
      enabled,
      preventDefault: true,
      filterTaps: true, // Filter out taps, only handle drags
      threshold: 5, // Require 5px movement before considering it a drag
    }
  )

  // Two-finger pinch gesture for combined scale + rotate + drag
  usePinch(
    ({ offset: [scale], first, last, event }) => {
      if (!enabled) return
      
      // Get touch points from the native event
      const touchEvent = event as TouchEvent
      const touches = touchEvent?.touches
      
      // Calculate center point and rotation from touch points
      let centerX = window.innerWidth / 2
      let centerY = window.innerHeight / 2
      let rotationDelta = 0
      
      if (touches && touches.length === 2) {
        const touch1 = touches[0]
        const touch2 = touches[1]
        
        // Calculate center point between fingers
        centerX = (touch1.clientX + touch2.clientX) / 2
        centerY = (touch1.clientY + touch2.clientY) / 2
        
        // Calculate angle between touch points for rotation
        const dx = touch2.clientX - touch1.clientX
        const dy = touch2.clientY - touch1.clientY
        const currentAngle = Math.atan2(dy, dx)
        
        if (first) {
          // Mark pinch as active
          isPinchingRef.current = true
          initialScaleRef.current = 1.0
          initialRotationRef.current = 0
          lastAngleRef.current = currentAngle
          onInteractionStart?.()
        } else if (lastAngleRef.current !== null) {
          // Calculate rotation delta
          rotationDelta = currentAngle - lastAngleRef.current
          lastAngleRef.current = currentAngle
        }
      } else if (first) {
        // Fallback if touches not available
        isPinchingRef.current = true
        initialScaleRef.current = 1.0
        initialRotationRef.current = 0
        lastAngleRef.current = 0
        onInteractionStart?.()
      }
      
      // Apply sensitivity damping
      const MOBILE_SCALE_SENSITIVITY = 0.5
      const MOBILE_ROTATION_SENSITIVITY = 0.5
      
      // Scale: offset[0] starts at 1.0, apply damping
      const dampedScale = 1.0 + (scale - 1.0) * MOBILE_SCALE_SENSITIVITY
      
      // Rotation: apply damping
      const dampedRotation = rotationDelta * MOBILE_ROTATION_SENSITIVITY
      
      // Call combined transform handler
      onPinchTransform({
        scale: dampedScale,
        rotation: dampedRotation,
        x: centerX,
        y: centerY,
      })
      
      if (last) {
        // Mark pinch as inactive
        isPinchingRef.current = false
        initialScaleRef.current = 1.0
        initialRotationRef.current = 0
        lastAngleRef.current = null
        onInteractionEnd?.()
      }
    },
    {
      target: gl.domElement,
      enabled,
      preventDefault: true,
      threshold: 0.05, // Require 5% scale change before triggering
    }
  )

  return null
}

