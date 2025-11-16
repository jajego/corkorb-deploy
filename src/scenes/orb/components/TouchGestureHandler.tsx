import { useThree } from '@react-three/fiber'
import { useRef } from 'react'

import { usePinchGesture } from '../hooks/usePinchGesture'
import { useTwistGesture } from '../hooks/useTwistGesture'

type TouchGestureHandlerProps = {
  enabled: boolean
  onPinchScale?: (scale: number) => void
  onTwistRotate?: (rotation: number) => void
}

/**
 * Component that handles touch gestures (pinch and twist) for pending papers.
 * Must be rendered inside a Canvas context to access the WebGL renderer's DOM element.
 */
export function TouchGestureHandler({
  enabled,
  onPinchScale,
  onTwistRotate,
}: TouchGestureHandlerProps) {
  const { gl } = useThree()
  const scaleRef = useRef<number>(1.0)

  // Pinch gesture for scaling
  usePinchGesture(
    gl.domElement,
    {
      onPinchStart: () => {
        scaleRef.current = 1.0
      },
      onPinchMove: (scale) => {
        if (!enabled || !onPinchScale) return
        // Accumulate scale changes
        scaleRef.current *= scale
        onPinchScale(scaleRef.current)
      },
      onPinchEnd: () => {
        scaleRef.current = 1.0
      },
    },
    enabled && !!onPinchScale
  )

  // Twist gesture for rotation
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

