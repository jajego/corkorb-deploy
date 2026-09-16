import { Quaternion, Vector3 } from 'three'

const spin = new Quaternion()

/** Screen-relative tangent frame, shared by the preview and placement fallback. */
export function orientPaperToCamera(
  normal: Vector3,
  cameraQuaternion: Quaternion,
  rotation: number,
  right: Vector3,
  up: Vector3,
) {
  right.set(1, 0, 0).applyQuaternion(cameraQuaternion).projectOnPlane(normal)
  if (right.lengthSq() < 1e-6) {
    // At an edge-on surface, preserve camera-up instead of using a world pole.
    up.set(0, 1, 0).applyQuaternion(cameraQuaternion).projectOnPlane(normal).normalize()
    right.crossVectors(up, normal)
  }
  right.normalize()
  up.crossVectors(normal, right).normalize()
  if (rotation !== 0) {
    spin.setFromAxisAngle(normal, rotation)
    right.applyQuaternion(spin).normalize()
    up.applyQuaternion(spin).normalize()
  }
}
