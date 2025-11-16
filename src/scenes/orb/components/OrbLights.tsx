import { Fragment } from 'react'

const KEY_LIGHT_INTENSITY = 0.7
const FILL_LIGHT_INTENSITY = 0.45
const RIM_LIGHT_INTENSITY = 0.25
const AMBIENT_INTENSITY = 0.85

/**
 * Balanced three-point rig. Keeps the orb evenly lit while preserving depth cues.
 */
export function OrbLights() {
  return (
    <Fragment>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <hemisphereLight color="#f3f5ff" groundColor="#1c1c22" intensity={0.4} />

      {/* Key light */}
      <directionalLight
        position={[3.5, 4.2, 2.6]}
        intensity={KEY_LIGHT_INTENSITY}
        castShadow={false}
      />

      {/* Fill light */}
      <directionalLight
        position={[-3.2, 2.1, -1.8]}
        intensity={FILL_LIGHT_INTENSITY}
        castShadow={false}
      />

      {/* Rim/back light */}
      <directionalLight
        position={[1, 3.4, -4.5]}
        intensity={RIM_LIGHT_INTENSITY}
        castShadow={false}
      />
    </Fragment>
  )
}

