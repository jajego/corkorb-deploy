import type { JSX } from 'react'

import { useCorkTexture } from '../../../three/textures/useCorkTexture'

type CorkOrbProps = JSX.IntrinsicElements['mesh']

const ORB_RADIUS = 1
const ORB_SEGMENTS = 128

export function CorkOrb(props: CorkOrbProps) {
  const corkTexture = useCorkTexture()

  return (
    <mesh {...props}>
      <sphereGeometry args={[ORB_RADIUS, ORB_SEGMENTS, ORB_SEGMENTS]} />
      <meshStandardMaterial map={corkTexture} roughness={0.96} metalness={0} envMapIntensity={0} />
    </mesh>
  )
}

