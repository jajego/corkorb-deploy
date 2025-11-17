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
  const isPinchingRef = useRef(false)
  const isTwistingRef = useRef(false)

  // Drag gesture for moving the ghost paper
  // Disabled when pinch or twist is active to prevent conflicts
  useDrag(
    ({ xy: [x, y], dragging, first, last }) => {
      if (!enabled) return
      
      // Don't handle drag if pinch or twist is active (2-finger gesture)
      if (isPinchingRef.current || isTwistingRef.current) return
      
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
      threshold: 5, // Require 5px movement before considering it a drag
    }
  )

  // Pinch gesture for scaling the ghost paper
  usePinch(
    ({ offset: [scale], first, last }) => {
      if (!enabled) return
      
      if (first) {
        initialScaleRef.current = 1.0
        isPinchingRef.current = true // Mark pinch as active
      }
      
      // offset[0] is the accumulated scale from the start of the pinch (starts at 1.0)
      // Reduce sensitivity by applying a damping factor
      // Scale of 2.0 becomes 1.5, scale of 0.5 becomes 0.75, etc.
      const dampedScale = 1.0 + (scale - 1.0) * 0.5 // 50% sensitivity
      onPinchScale(dampedScale)
      
      if (last) {
        initialScaleRef.current = 1.0
        isPinchingRef.current = false // Mark pinch as inactive
      }
    },
    {
      target: gl.domElement,
      enabled,
      preventDefault: true,
      threshold: 0.05, // Require 5% scale change before triggering
    }
  )

  // Twist gesture for rotating the ghost paper (using existing hook since usePinch doesn't support rotation)
  useTwistGesture(
    gl.domElement,
    {
      onTwistStart: () => {
        isTwistingRef.current = true // Mark twist as active
      },
      onTwistMove: (rotation) => {
        if (!enabled || !onTwistRotate) return
        // Reduce rotation sensitivity
        onTwistRotate(rotation * 0.5) // Apply 50% sensitivity
      },
      onTwistEnd: () => {
        isTwistingRef.current = false // Mark twist as inactive
      },
    },
    enabled && !!onTwistRotate
  )

  return null
}

