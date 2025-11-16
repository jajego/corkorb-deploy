import * as THREE from 'three'

export function vectorToLatLon(vector: THREE.Vector3 | null) {
  if (!vector) return null
  const spherical = new THREE.Spherical().setFromVector3(vector.clone().normalize())
  const lon = THREE.MathUtils.radToDeg(spherical.theta)
  const lat = 90 - THREE.MathUtils.radToDeg(spherical.phi)
  return { lat, lon }
}

export function formatDegrees(value: number): string {
  const wrapped = ((value + 180) % 360) - 180
  return wrapped.toFixed(2)
}

export function formatLatLon(latLon: { lat: number; lon: number } | null) {
  if (!latLon) return '—'
  return `${latLon.lat.toFixed(2)}°, ${latLon.lon.toFixed(2)}°`
}

export function vectorToArray(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

export function arrayToVector(array: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(array[0], array[1], array[2])
}

export function quaternionToArray(quaternion: THREE.Quaternion): [number, number, number, number] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

export function arrayToQuaternion(array: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(array[0], array[1], array[2], array[3])
}

export function vectorLength(vector: THREE.Vector3): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
}

export function normalizeVector(vector: THREE.Vector3): THREE.Vector3 {
  const length = vectorLength(vector)
  if (length === 0) return new THREE.Vector3(0, 0, 0)
  return vector.clone().divideScalar(length)
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

