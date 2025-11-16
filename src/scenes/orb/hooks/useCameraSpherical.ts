import { useCallback, useRef, useState } from 'react'
import * as THREE from 'three'
import { initialSpherical, SPHERICAL_EPSILON, SPHERICAL_UPDATE_INTERVAL_MS } from '../utils/constants'

export function useCameraSpherical() {
  const cameraSphericalRef = useRef({ ...initialSpherical })
  const lastSphericalUpdateRef = useRef(0)
  const throttledUpdateTimeoutRef = useRef<number | null>(null)
  const [cameraSpherical, setCameraSpherical] = useState(() => ({ ...initialSpherical }))

  const handleSphericalChange = useCallback(
    (s: THREE.Spherical) => {
      const prev = cameraSphericalRef.current
      if (
        Math.abs(prev.radius - s.radius) < SPHERICAL_EPSILON &&
        Math.abs(prev.phi - s.phi) < SPHERICAL_EPSILON &&
        Math.abs(prev.theta - s.theta) < SPHERICAL_EPSILON
      ) {
        return
      }
      cameraSphericalRef.current = { radius: s.radius, phi: s.phi, theta: s.theta }
      const now = performance.now()
      if (now - lastSphericalUpdateRef.current < SPHERICAL_UPDATE_INTERVAL_MS) {
        if (throttledUpdateTimeoutRef.current !== null) {
          window.clearTimeout(throttledUpdateTimeoutRef.current)
        }
        throttledUpdateTimeoutRef.current = window.setTimeout(() => {
          throttledUpdateTimeoutRef.current = null
          lastSphericalUpdateRef.current = performance.now()
          setCameraSpherical({ radius: s.radius, phi: s.phi, theta: s.theta })
        }, SPHERICAL_UPDATE_INTERVAL_MS)
        return
      }
      if (throttledUpdateTimeoutRef.current !== null) {
        window.clearTimeout(throttledUpdateTimeoutRef.current)
        throttledUpdateTimeoutRef.current = null
      }
      lastSphericalUpdateRef.current = now
      setCameraSpherical({ radius: s.radius, phi: s.phi, theta: s.theta })
    },
    []
  )

  return {
    cameraSpherical,
    handleSphericalChange,
  }
}

