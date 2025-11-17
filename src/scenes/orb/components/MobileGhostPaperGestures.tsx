import { useThree } from '@react-three/fiber'
import { useDrag, usePinch } from '@use-gesture/react'
import { useRef } from 'react'

import { useTwistGesture } from '../hooks/useTwistGesture'

type MobileGhostPaperGesturesProps = {
  enabled: boolean
  onDrag: (x: number, y: number) => void
  onPinchScale: (scale: number) => void
  onTwistRotate: (rotation: number) => void
}

/**
 * Component that handles touch gestures for ghost paper positioning on mobile.
 * Uses @use-gesture/react for drag and pinch gestures, and the existing twist gesture for rotation.
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

  // Drag gesture for moving the ghost paper
  useDrag(
    ({ xy: [x, y], dragging, first, last }) => {
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

  // Pinch gesture for scaling the ghost paper
  usePinch(
    ({ offset: [scale], first, last }) => {
      if (!enabled) return
      
      if (first) {
        initialScaleRef.current = 1.0
      }
      
      // offset[0] is the accumulated scale from the start of the pinch
      // Pass the accumulated scale to the handler
      onPinchScale(scale)
      
      if (last) {
        initialScaleRef.current = 1.0
      }
    },
    {
      target: gl.domElement,
      enabled,
      preventDefault: true,
    }
  )

  // Twist gesture for rotating the ghost paper (using existing hook since usePinch doesn't support rotation)
  useTwistGesture(
    gl.domElement,
    {
      onTwistStart: () => {
        // Twist started
      },
      onTwistMove: (rotation) => {
        if (!enabled || !onTwistRotate) return
        onTwistRotate(rotation)
      },
      onTwistEnd: () => {
        // Twist ended
      },
    },
    enabled && !!onTwistRotate
  )

  return null
}

