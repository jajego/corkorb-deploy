import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

type MobileGhostPaperDragProps = {
  enabled: boolean
  onTouchMove: (x: number, y: number) => void
}

/**
 * Component that handles single-finger touch drag for ghost paper positioning on mobile.
 * Must be rendered inside a Canvas context to access the WebGL renderer's DOM element.
 * Only handles single-finger touches - two-finger gestures are handled by TouchGestureHandler.
 */
export function MobileGhostPaperDrag({ enabled, onTouchMove }: MobileGhostPaperDragProps) {
  const { gl } = useThree()

  useEffect(() => {
    if (!enabled) return undefined

    const canvasElement = gl.domElement
    let isDraggingPaper = false

    const handleTouchStart = (event: TouchEvent) => {
      // Only handle single-finger touches for ghost paper dragging
      // Two-finger gestures (pinch/twist) are handled by TouchGestureHandler
      // TouchGestureHandler uses capture phase, so it will handle 2-finger gestures first
      if (event.touches.length !== 1) {
        // If we were dragging but now have 2 touches, stop dragging (pinch/twist started)
        if (isDraggingPaper) {
          isDraggingPaper = false
        }
        return
      }

      const touch = event.touches[0]
      isDraggingPaper = true

      // Update pointer to touch position to move ghost paper
      onTouchMove(touch.clientX, touch.clientY)

      // Prevent default to avoid scrolling (only for single-finger drag)
      event.preventDefault()
    }

    const handleTouchMove = (event: TouchEvent) => {
      // Only handle single-finger touches
      if (event.touches.length !== 1) {
        // If we were dragging but now have 2 touches, stop dragging (pinch/twist started)
        if (isDraggingPaper) {
          isDraggingPaper = false
        }
        return
      }

      if (!isDraggingPaper) return

      const touch = event.touches[0]

      // Update pointer to move ghost paper
      onTouchMove(touch.clientX, touch.clientY)

      // Prevent default to avoid scrolling
      event.preventDefault()
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        isDraggingPaper = false
      } else if (event.touches.length === 2) {
        // Two-finger gesture started - stop single-finger drag
        isDraggingPaper = false
      }
    }

    const handleTouchCancel = () => {
      isDraggingPaper = false
    }

    // Add touch event listeners to canvas element (same as TouchGestureHandler)
    // Use non-capture phase so TouchGestureHandler (which uses capture) handles 2-finger gestures first
    // This ensures 2-finger gestures are handled first, then single-finger drag
    canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false, capture: false })
    canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false, capture: false })
    canvasElement.addEventListener('touchend', handleTouchEnd, { passive: false, capture: false })
    canvasElement.addEventListener('touchcancel', handleTouchCancel, { passive: false, capture: false })

    return () => {
      canvasElement.removeEventListener('touchstart', handleTouchStart, { capture: false })
      canvasElement.removeEventListener('touchmove', handleTouchMove, { capture: false })
      canvasElement.removeEventListener('touchend', handleTouchEnd, { capture: false })
      canvasElement.removeEventListener('touchcancel', handleTouchCancel, { capture: false })
    }
  }, [enabled, gl, onTouchMove])

  return null
}

