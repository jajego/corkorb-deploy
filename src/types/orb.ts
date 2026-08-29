/**
 * TypeScript type definitions for orb-related types.
 */

import * as THREE from 'three'

export type CorkShape = 'sphere' | 'cube' | 'pyramid'

export interface PinInstance {
  id: string
  position: THREE.Vector3
  color: string
  normal?: THREE.Vector3
}

export interface PendingPaper {
  id: string
  texture: THREE.Texture | null
  aspect: number
  scale: number
  stage: 'positioning' | 'pinning'
  center?: THREE.Vector3
  quaternion?: THREE.Quaternion
  basisRight?: THREE.Vector3
  basisUp?: THREE.Vector3
  positions?: Float32Array
  normals?: Float32Array
  pins: PinInstance[]
  layerOffset: number
  rotation: number
  userId: string
  sourceFile?: File
  sourceUrl?: string
}

export interface PlacedPaper {
  id: string
  texture: THREE.Texture | null
  aspect: number
  scale: number
  center: THREE.Vector3
  quaternion: THREE.Quaternion
  basisRight: THREE.Vector3
  basisUp: THREE.Vector3
  positions: Float32Array
  normals: Float32Array
  pins: PinInstance[]
  layerOffset: number
  rotation: number
  createdAt: string
  userId: string
  username?: string | null
  sourceUrl: string
}

