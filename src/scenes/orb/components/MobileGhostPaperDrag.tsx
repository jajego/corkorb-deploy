import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

type MobileGhostPaperDragProps = {
  enabled: boolean
  onTouchMove: (x: number, y: number) => void
  onDragStateChange?: (isDragging: boolean) => void
}

/**
 * Component that handles single-finger touch drag for ghost paper positioning on mobile.
 * Must be rendered inside a Canvas context to access the WebGL renderer's DOM element.
 * Only handles single-finger touches - two-finger gestures are handled by TouchGestureHandler.
 */
export function MobileGhostPaperDrag({ enabled, onTouchMove, onDragStateChange }: MobileGhostPaperDragProps) {
  const { gl } = useThree()

  useEffect(() => {
    if (!enabled) return undefined

    const canvasElement = gl.domElement
    let isDraggingPaper = false
    let touchStartPos: { x: number; y: number } | null = null
    let touchStartTime = 0
    const DRAG_THRESHOLD = 10 // pixels - if moved more than this, it's a drag
    const TAP_MAX_DURATION = 300 // ms - if longer than this, it's not a tap

    const handleTouchStart = (event: TouchEvent) => {
      // Only handle single-finger touches for ghost paper dragging
      // Two-finger gestures (pinch/twist) are handled by TouchGestureHandler
      // TouchGestureHandler uses capture phase, so it will handle 2-finger gestures first
      if (event.touches.length !== 1) {
        // If we were dragging but now have 2 touches, stop dragging (pinch/twist started)
        if (isDraggingPaper) {
          isDraggingPaper = false
          touchStartPos = null
          onDragStateChange?.(false)
        }
        return
      }

      const touch = event.touches[0]
      touchStartPos = { x: touch.clientX, y: touch.clientY }
      touchStartTime = Date.now()
      isDraggingPaper = false // Start as false, will be set to true on first move
      onDragStateChange?.(false) // Reset drag state

      // CRITICAL: Stop propagation to prevent pointer events from firing immediately
      // We'll handle taps manually in handleTouchEnd if it wasn't a drag
      event.stopPropagation()
      // Prevent default to avoid scrolling
      event.preventDefault()
    }

    const handleTouchMove = (event: TouchEvent) => {
      // Only handle single-finger touches
      if (event.touches.length !== 1) {
        // If we were dragging but now have 2 touches, stop dragging (pinch/twist started)
        if (isDraggingPaper) {
          isDraggingPaper = false
          touchStartPos = null
          onDragStateChange?.(false)
        }
        return
      }

      if (!touchStartPos) return

      const touch = event.touches[0]
      const dx = touch.clientX - touchStartPos.x
      const dy = touch.clientY - touchStartPos.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Always update pointer position to move ghost paper (even before threshold)
      // This makes the ghost paper follow the finger immediately
      onTouchMove(touch.clientX, touch.clientY)

      // If moved beyond threshold, mark this as a drag (not a tap)
      if (distance > DRAG_THRESHOLD) {
        if (!isDraggingPaper) {
          isDraggingPaper = true
          onDragStateChange?.(true)
        }
      }

      // CRITICAL: Stop propagation to prevent pointer events from firing
      // This prevents the orb's onPointerDown from triggering confirmPaperPlacement
      event.stopPropagation()
      // Prevent default to avoid scrolling
      event.preventDefault()
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        // Check if this was a tap (not a drag)
        // A tap is: not a drag AND within time threshold AND minimal movement
        const timeSinceStart = Date.now() - touchStartTime
        const wasTap = !isDraggingPaper && touchStartPos && timeSinceStart < TAP_MAX_DURATION
        
        if (wasTap && touchStartPos) {
          // Double-check: verify the touch didn't move much (safety check)
          const lastTouch = event.changedTouches[0]
          if (lastTouch) {
            const finalDx = lastTouch.clientX - touchStartPos.x
            const finalDy = lastTouch.clientY - touchStartPos.y
            const finalDistance = Math.sqrt(finalDx * finalDx + finalDy * finalDy)
            
            // Only commit if it was truly a tap (minimal movement)
            if (finalDistance <= DRAG_THRESHOLD) {
              // This was a tap - dispatch a pointer event to trigger commit
              // Use a small delay to ensure all touch handlers have finished
              setTimeout(() => {
                const pointerEvent = new PointerEvent('pointerdown', {
                  pointerId: 1,
                  pointerType: 'touch',
                  clientX: lastTouch.clientX,
                  clientY: lastTouch.clientY,
                  bubbles: true,
                  cancelable: true,
                })
                canvasElement.dispatchEvent(pointerEvent)
              }, 0)
            }
          }
        }
        
        // Reset drag state
        if (isDraggingPaper) {
          isDraggingPaper = false
          onDragStateChange?.(false)
        }
        touchStartPos = null
      } else if (event.touches.length === 2) {
        // Two-finger gesture started - stop single-finger drag
        if (isDraggingPaper) {
          isDraggingPaper = false
          onDragStateChange?.(false)
        }
        touchStartPos = null
      }
      
      // Stop propagation to prevent any default behavior
      event.stopPropagation()
      event.preventDefault()
    }

    const handleTouchCancel = () => {
      if (isDraggingPaper) {
        isDraggingPaper = false
        onDragStateChange?.(false)
      }
    }

    // Add touch event listeners to canvas element
    // Use capture phase to intercept events BEFORE they trigger pointer events
    // This prevents touch events from creating pointer events that would trigger confirmPaperPlacement
    // TouchGestureHandler also uses capture phase, but it only handles 2-finger gestures
    canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true })
    canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
    canvasElement.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true })
    canvasElement.addEventListener('touchcancel', handleTouchCancel, { passive: false, capture: true })

    return () => {
      canvasElement.removeEventListener('touchstart', handleTouchStart, { capture: true })
      canvasElement.removeEventListener('touchmove', handleTouchMove, { capture: true })
      canvasElement.removeEventListener('touchend', handleTouchEnd, { capture: true })
      canvasElement.removeEventListener('touchcancel', handleTouchCancel, { capture: true })
    }
  }, [enabled, gl, onTouchMove, onDragStateChange])

  return null
}

