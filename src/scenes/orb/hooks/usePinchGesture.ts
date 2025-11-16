import { useEffect, useRef } from 'react'

type PinchGestureState = {
  isPinching: boolean
  scale: number // Relative scale change (1.0 = no change)
  distance: number // Current distance between fingers
  center: { x: number; y: number } // Center point between fingers
}

type PinchGestureCallbacks = {
  onPinchStart?: (center: { x: number; y: number }) => void
  onPinchMove?: (scale: number, center: { x: number; y: number }) => void
  onPinchEnd?: () => void
}

/**
 * Hook to detect pinch gestures (two-finger pinch/zoom).
 * Returns the current pinch state and handles touch events.
 */
export function usePinchGesture(
  element: HTMLElement | null,
  callbacks: PinchGestureCallbacks,
  enabled: boolean = true
): PinchGestureState {
  const stateRef = useRef<PinchGestureState>({
    isPinching: false,
    scale: 1.0,
    distance: 0,
    center: { x: 0, y: 0 },
  })
  
  const touchesRef = useRef<Map<number, Touch>>(new Map())
  const lastDistanceRef = useRef<number>(0)
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!element || !enabled) return

    const getDistance = (touch1: Touch, touch2: Touch): number => {
      const dx = touch2.clientX - touch1.clientX
      const dy = touch2.clientY - touch1.clientY
      return Math.sqrt(dx * dx + dy * dy)
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
        if (stateRef.current.isPinching) {
          stateRef.current.isPinching = false
          stateRef.current.scale = 1.0
          callbacks.onPinchEnd?.()
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
        const distance = getDistance(touchesArray[0], touchesArray[1])
        const center = getCenter(touchesArray[0], touchesArray[1])
        
        lastDistanceRef.current = distance
        lastCenterRef.current = center
        stateRef.current.isPinching = true
        stateRef.current.distance = distance
        stateRef.current.center = center
        stateRef.current.scale = 1.0
        
        callbacks.onPinchStart?.(center)
        
        // Only prevent default for 2-finger gestures to avoid scrolling
        // This allows single-finger drag to work properly via pointer events
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      // Only handle 2-finger gestures - ignore single touches
      if (event.touches.length !== 2) {
        // If we were pinching but now have fewer touches, end the pinch
        if (stateRef.current.isPinching) {
          stateRef.current.isPinching = false
          stateRef.current.scale = 1.0
          lastDistanceRef.current = 0
          lastCenterRef.current = null
          callbacks.onPinchEnd?.()
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
        // Initialize if we weren't pinching before
        if (!stateRef.current.isPinching && lastDistanceRef.current === 0) {
          const distance = getDistance(touchesArray[0], touchesArray[1])
          const center = getCenter(touchesArray[0], touchesArray[1])
          lastDistanceRef.current = distance
          lastCenterRef.current = center
          stateRef.current.isPinching = true
          stateRef.current.distance = distance
          stateRef.current.center = center
          stateRef.current.scale = 1.0
          callbacks.onPinchStart?.(center)
        } else if (lastDistanceRef.current > 0) {
          const distance = getDistance(touchesArray[0], touchesArray[1])
          const center = getCenter(touchesArray[0], touchesArray[1])
          
          const scale = distance / lastDistanceRef.current
          
          stateRef.current.distance = distance
          stateRef.current.center = center
          stateRef.current.scale = scale
          
          callbacks.onPinchMove?.(scale, center)
          
          lastDistanceRef.current = distance
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

      // If we don't have exactly 2 touches anymore, end the pinch
      if (touchesRef.current.size !== 2) {
        if (stateRef.current.isPinching) {
          stateRef.current.isPinching = false
          stateRef.current.scale = 1.0
          lastDistanceRef.current = 0
          lastCenterRef.current = null
          callbacks.onPinchEnd?.()
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

