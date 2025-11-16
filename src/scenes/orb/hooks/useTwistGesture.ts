import { useEffect, useRef } from 'react'

type TwistGestureState = {
  isTwisting: boolean
  rotation: number // Rotation angle in radians (relative to start)
  angle: number // Current angle between fingers
  center: { x: number; y: number } // Center point between fingers
}

type TwistGestureCallbacks = {
  onTwistStart?: (center: { x: number; y: number }) => void
  onTwistMove?: (rotation: number, center: { x: number; y: number }) => void
  onTwistEnd?: () => void
}

/**
 * Hook to detect twist/rotate gestures (two-finger rotation).
 * Returns the current twist state and handles touch events.
 */
export function useTwistGesture(
  element: HTMLElement | null,
  callbacks: TwistGestureCallbacks,
  enabled: boolean = true
): TwistGestureState {
  const stateRef = useRef<TwistGestureState>({
    isTwisting: false,
    rotation: 0,
    angle: 0,
    center: { x: 0, y: 0 },
  })
  
  const touchesRef = useRef<Map<number, Touch>>(new Map())
  const lastAngleRef = useRef<number>(0)
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!element || !enabled) return

    const getAngle = (touch1: Touch, touch2: Touch): number => {
      const dx = touch2.clientX - touch1.clientX
      const dy = touch2.clientY - touch1.clientY
      return Math.atan2(dy, dx)
    }

    const getCenter = (touch1: Touch, touch2: Touch): { x: number; y: number } => {
      return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      // Only handle 2-finger touches - let single touches pass through to pointer events
      if (event.touches.length !== 2) {
        touchesRef.current.clear()
        if (stateRef.current.isTwisting) {
          stateRef.current.isTwisting = false
          stateRef.current.rotation = 0
          callbacks.onTwistEnd?.()
        }
        // Don't prevent default for single touches - let them work with pointer events
        return
      }

      // Store both touches
      touchesRef.current.clear()
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i]
        touchesRef.current.set(touch.identifier, touch)
      }

      const touchesArray = Array.from(touchesRef.current.values())
      if (touchesArray.length === 2) {
        const angle = getAngle(touchesArray[0], touchesArray[1])
        const center = getCenter(touchesArray[0], touchesArray[1])
        
        lastAngleRef.current = angle
        lastCenterRef.current = center
        stateRef.current.isTwisting = true
        stateRef.current.angle = angle
        stateRef.current.center = center
        stateRef.current.rotation = 0
        
        callbacks.onTwistStart?.(center)
        
        // Only prevent default for 2-finger gestures to avoid scrolling
        // This allows single-finger drag to work properly via pointer events
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      // Only handle 2-finger gestures - ignore single touches
      if (event.touches.length !== 2) {
        // If we were twisting but now have fewer touches, end the twist
        if (stateRef.current.isTwisting) {
          stateRef.current.isTwisting = false
          stateRef.current.rotation = 0
          lastAngleRef.current = 0
          lastCenterRef.current = null
          callbacks.onTwistEnd?.()
        }
        // Don't prevent default for single touches
        return
      }

      // Update touches
      touchesRef.current.clear()
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i]
        touchesRef.current.set(touch.identifier, touch)
      }

      const touchesArray = Array.from(touchesRef.current.values())
      if (touchesArray.length === 2) {
        // Initialize if we weren't twisting before
        if (!stateRef.current.isTwisting && lastAngleRef.current === 0 && lastCenterRef.current === null) {
          const angle = getAngle(touchesArray[0], touchesArray[1])
          const center = getCenter(touchesArray[0], touchesArray[1])
          lastAngleRef.current = angle
          lastCenterRef.current = center
          stateRef.current.isTwisting = true
          stateRef.current.angle = angle
          stateRef.current.center = center
          stateRef.current.rotation = 0
          callbacks.onTwistStart?.(center)
        } else if (lastAngleRef.current !== 0) {
          const angle = getAngle(touchesArray[0], touchesArray[1])
          const center = getCenter(touchesArray[0], touchesArray[1])
          
          // Calculate rotation delta (wrapped to [-PI, PI])
          let rotationDelta = angle - lastAngleRef.current
          // Wrap to [-PI, PI]
          while (rotationDelta > Math.PI) rotationDelta -= 2 * Math.PI
          while (rotationDelta < -Math.PI) rotationDelta += 2 * Math.PI
          
          stateRef.current.angle = angle
          stateRef.current.center = center
          stateRef.current.rotation += rotationDelta
          
          callbacks.onTwistMove?.(rotationDelta, center)
          
          lastAngleRef.current = angle
          lastCenterRef.current = center
        }
        
        // Only prevent default for 2-finger gestures
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      // Remove ended touches
      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i]
        touchesRef.current.delete(touch.identifier)
      }

      // If we don't have exactly 2 touches anymore, end the twist
      if (touchesRef.current.size !== 2) {
        if (stateRef.current.isTwisting) {
          stateRef.current.isTwisting = false
          stateRef.current.rotation = 0
          lastAngleRef.current = 0
          lastCenterRef.current = null
          callbacks.onTwistEnd?.()
        }
      }
    }

    // Use capture phase to ensure we get the events first
    element.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
    element.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: false, capture: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart, { capture: true })
      element.removeEventListener('touchmove', handleTouchMove, { capture: true })
      element.removeEventListener('touchend', handleTouchEnd, { capture: true })
      element.removeEventListener('touchcancel', handleTouchEnd, { capture: true })
    }
  }, [element, enabled, callbacks])

  return stateRef.current
}

