/**
 * Pin component to show other users' view centers on the orb.
 * 
 * Performance optimizations:
 * - Model is loaded once and cloned per user
 * - Uses spherical coordinates directly (no expensive conversions)
 * - Positioned at orb surface, rotated to face outward (normal to sphere)
 */

import { useMemo, useState } from 'react'
import { useGLTF, Html } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

const PIN_MODEL_PATH = '/models/pin.glb'
const ORB_RADIUS = 1
const PIN_OFFSET = 0.18 // Slight offset from orb surface to prevent z-fighting
const PIN_SCALE = 1.0 // Scale factor for the pin model

export interface ViewCenterCrosshairProps {
  /** View center in spherical coordinates */
  viewCenter: {
    radius: number
    phi: number
    theta: number
  }
  /** Color for this user's pin (applied as a tint) */
  color: string
  /** User ID to display in tooltip */
  userId: string
}

/**
 * Single pin component for one user's view center.
 * 
 * The pin is positioned on the orb surface at the view center point,
 * and rotated to face outward (normal to the sphere surface).
 */
export function ViewCenterCrosshair({ viewCenter, color, userId }: ViewCenterCrosshairProps) {
  const gltf = useGLTF(PIN_MODEL_PATH)
  const [isHovered, setIsHovered] = useState(false)
  
  // Clone and configure the pin model
  const pinScene = useMemo(() => {
    const scene = gltf.scene.clone(true)
    
    // Traverse the scene to configure materials and meshes
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = false
        
        // Apply color tint to the material
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial || 
                material instanceof THREE.MeshBasicMaterial ||
                material instanceof THREE.MeshPhongMaterial) {
              material.color = new THREE.Color(color)
              material.transparent = true
              material.opacity = 0.9
            }
          })
        } else if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.MeshPhongMaterial
          if (material instanceof THREE.MeshStandardMaterial || 
              material instanceof THREE.MeshBasicMaterial ||
              material instanceof THREE.MeshPhongMaterial) {
            material.color = new THREE.Color(color)
            material.transparent = true
            material.opacity = 0.9
          }
        }
      }
    })
    
    return scene
  }, [gltf, color])
  
  // Convert spherical coordinates to 3D position on orb surface
  const { position, quaternion } = useMemo(() => {
    // Create spherical coordinates from view center
    const spherical = new THREE.Spherical(
      ORB_RADIUS + PIN_OFFSET, // Slightly above orb surface to prevent z-fighting
      viewCenter.phi,
      viewCenter.theta
    )
    
    // Convert to 3D position
    const vec = new THREE.Vector3()
    vec.setFromSpherical(spherical)
    
    // Calculate rotation to face outward (normal to sphere surface)
    // The normal at any point on a sphere is just the normalized position vector
    const normal = vec.clone().normalize()
    
    // Create a basis where Z points outward (normal), X and Y are tangent to the sphere
    // Use world up as reference, project onto tangent plane
    const worldUp = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(worldUp, normal).normalize()
    
    // If right is too small (normal is nearly vertical), use world forward instead
    if (right.length() < 0.1) {
      const worldForward = new THREE.Vector3(0, 0, 1)
      right.crossVectors(worldForward, normal).normalize()
    }
    
    const up = new THREE.Vector3().crossVectors(normal, right).normalize()
    
    // Create rotation matrix from basis (right, up, normal)
    const matrix = new THREE.Matrix4()
    matrix.makeBasis(right, up, normal)
    const quat = new THREE.Quaternion().setFromRotationMatrix(matrix)
    
    // Flip the pin 180 degrees around X axis so tip points downward (toward orb center)
    const flipRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0))
    const finalQuat = quat.clone().multiply(flipRotation)
    
    return { position: vec, quaternion: finalQuat }
  }, [viewCenter.phi, viewCenter.theta])

  return (
    <group position={position} quaternion={quaternion} scale={PIN_SCALE}>
      <primitive 
        object={pinScene}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          setIsHovered(true)
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          setIsHovered(false)
        }}
      />
      {isHovered && (
        <Html
          position={[0, 0.2, 0]} // Offset above the pin
          style={{ pointerEvents: 'none' }}
          center
        >
          <div className="pin-tooltip">
            <div className="pin-tooltip__user">{userId ?? 'Unknown user'}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

// Preload the pin model for better performance
useGLTF.preload(PIN_MODEL_PATH)

