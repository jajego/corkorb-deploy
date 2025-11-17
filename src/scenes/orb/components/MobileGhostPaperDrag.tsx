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

      // If moved beyond threshold, this is a drag (not a tap)
      if (distance > DRAG_THRESHOLD) {
        if (!isDraggingPaper) {
          isDraggingPaper = true
          onDragStateChange?.(true)
        }
        // Update pointer to move ghost paper
        onTouchMove(touch.clientX, touch.clientY)
      }

      // CRITICAL: Stop propagation to prevent pointer events from firing
      // This prevents the orb's onPointerDown from triggering confirmPaperPlacement
      event.stopPropagation()
      // Prevent default to avoid scrolling
      event.preventDefault()
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        // If this was a tap (not a drag), we need to trigger the commit
        // Since we prevented pointer events, we'll dispatch a synthetic pointer event
        const wasTap = !isDraggingPaper && touchStartPos && (Date.now() - touchStartTime) < TAP_MAX_DURATION
        
        if (wasTap && touchStartPos) {
          // This was a tap - dispatch a pointer event to trigger commit
          // Use the last known touch position (from touchstart or last touchmove)
          // For a tap, this should be very close to touchstart position
          const lastTouch = event.changedTouches[0] || (touchStartPos ? { clientX: touchStartPos.x, clientY: touchStartPos.y } : null)
          
          if (lastTouch) {
            const pointerEvent = new PointerEvent('pointerdown', {
              pointerId: 1,
              pointerType: 'touch',
              clientX: lastTouch.clientX,
              clientY: lastTouch.clientY,
              bubbles: true,
              cancelable: true,
            })
            canvasElement.dispatchEvent(pointerEvent)
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

