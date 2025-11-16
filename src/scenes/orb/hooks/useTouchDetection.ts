import { useEffect, useState } from 'react'

/**
 * Detects if the user is on a touch-capable device.
 * Returns true if touch events are available or if the primary pointer is coarse (touch).
 */
export function useTouchDetection(): boolean {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    // Check if touch events are available
    const hasTouchEvents = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    
    // Check if the primary pointer is coarse (touch screen)
    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const hasCoarsePointer = mediaQuery.matches
    
    // Also check for any-pointer: coarse (secondary pointer could be touch)
    const anyPointerQuery = window.matchMedia('(any-pointer: coarse)')
    const hasAnyCoarsePointer = anyPointerQuery.matches
    
    // Consider it a touch device if any of these are true
    const touchDevice = hasTouchEvents || hasCoarsePointer || hasAnyCoarsePointer
    
    setIsTouch(touchDevice)
    
    // Listen for changes in media queries (e.g., device orientation changes)
    const handleMediaChange = () => {
      setIsTouch(
        hasTouchEvents ||
        window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(any-pointer: coarse)').matches
      )
    }
    
    // Note: Some browsers don't support addEventListener on MediaQueryList
    // so we use the deprecated addListener as fallback
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange)
      anyPointerQuery.addEventListener('change', handleMediaChange)
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleMediaChange)
      anyPointerQuery.addListener(handleMediaChange)
    }
    
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange)
        anyPointerQuery.removeEventListener('change', handleMediaChange)
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(handleMediaChange)
        anyPointerQuery.removeListener(handleMediaChange)
      }
    }
  }, [])

  return isTouch
}

