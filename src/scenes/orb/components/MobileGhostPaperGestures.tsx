import { useThree } from '@react-three/fiber'
import { useDrag, usePinch } from '@use-gesture/react'
import { useRef } from 'react'

type MobileGhostPaperGesturesProps = {
  enabled: boolean
  onDrag: (x: number, y: number) => void
  onPinchScale: (scale: number) => void
  onTwistRotate: (rotation: number) => void
}

/**
 * Component that handles touch gestures for ghost paper positioning on mobile.
 * Uses @use-gesture/react for drag, pinch, and rotate gestures.
 * Must be rendered inside a Canvas context to access the WebGL renderer's DOM element.
 */
export function MobileGhostPaperGestures({
  enabled,
  onDrag,
  onPinchScale,
  onTwistRotate,
}: MobileGhostPaperGesturesProps) {
  const { gl } = useThree()
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const initialScaleRef = useRef<number>(1.0)
  const lastRotationRef = useRef<number>(0)

  // Drag gesture for moving the ghost paper
  useDrag(
    ({ xy: [x, y], movement: [mx, my], dragging, first, last }) => {
      if (!enabled) return
      
      if (first) {
        // Store the initial pointer position
        dragStartRef.current = { x, y }
      }
      
      if (dragging && dragStartRef.current) {
        // Use the current pointer position directly
        onDrag(x, y)
      }
      
      if (last) {
        dragStartRef.current = null
      }
    },
    {
      target: gl.domElement,
      enabled,
      preventDefault: true,
      filterTaps: true, // Filter out taps, only handle drags
    }
  )

  // Pinch gesture for scaling and rotating the ghost paper
  usePinch(
    ({ offset: [scale], rotation, first, last }) => {
      if (!enabled) return
      
      if (first) {
        initialScaleRef.current = 1.0
        lastRotationRef.current = rotation
      }
      
      // offset[0] is the accumulated scale from the start of the pinch
      // Pass the accumulated scale to the handler
      onPinchScale(scale)
      
      // rotation is in radians, accumulated from the start
      // Calculate delta rotation
      const deltaRotation = rotation - lastRotationRef.current
      lastRotationRef.current = rotation
      
      if (Math.abs(deltaRotation) > 0.001) {
        onTwistRotate(deltaRotation)
      }
      
      if (last) {
        initialScaleRef.current = 1.0
        lastRotationRef.current = 0
      }
    },
    {
      target: gl.domElement,
      enabled,
      preventDefault: true,
    }
  )

  return null
}

