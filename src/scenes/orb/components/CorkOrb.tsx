import { forwardRef, type JSX } from 'react'
import * as THREE from 'three'

import { triplanarCork, triplanarCorkCacheKey } from '../../../three/textures/triplanarCork'
import { useCorkTexture } from '../../../three/textures/useCorkTexture'
import { markPaperLoadStage } from '../utils/loadTiming'
import type { CorkShape } from '../../../types/orb'

type CorkOrbProps = JSX.IntrinsicElements['mesh'] & { shape: CorkShape }

const ORB_RADIUS = 1
const ORB_SEGMENTS = 128

export const CorkOrb = forwardRef<THREE.Mesh, CorkOrbProps>(function CorkOrb({ shape, ...props }, ref) {
  const corkTexture = useCorkTexture()
  return (
    <mesh ref={ref} {...props} onAfterRender={() => markPaperLoadStage('first-cork-drawn')}>
      {shape === 'sphere' ? <sphereGeometry args={[ORB_RADIUS, ORB_SEGMENTS, ORB_SEGMENTS]} /> : null}
      {shape === 'cube' ? <boxGeometry args={[2, 2, 2]} /> : null}
      {shape === 'pyramid' ? <coneGeometry args={[Math.SQRT2, 2, 4, 1, false, Math.PI / 4]} /> : null}
      <meshStandardMaterial
        key={shape === 'sphere' ? 'triplanar' : 'uv'}
        onBeforeCompile={shape === 'sphere' ? triplanarCork : undefined}
        customProgramCacheKey={shape === 'sphere' ? triplanarCorkCacheKey : undefined}
        map={corkTexture}
        roughness={0.96}
        metalness={0}
        envMapIntensity={0}
        flatShading={shape !== 'sphere'}
      />
    </mesh>
  )
})

