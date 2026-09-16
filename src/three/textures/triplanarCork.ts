import type { MeshStandardMaterial } from 'three'

// Object-space projections keep the grain attached to the sphere as it rotates.
// About the same grain density as the old 3.6 repeats from pole to pole.
export function triplanarCork(shader: Parameters<MeshStandardMaterial['onBeforeCompile']>[0]) {
  const varyings = 'varying vec3 vCorkPosition;\nvarying vec3 vCorkNormal;\n'
  shader.vertexShader = varyings + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvCorkPosition = position;\nvCorkNormal = normal;',
  )
  shader.fragmentShader = varyings + shader.fragmentShader.replace('#include <map_fragment>', `
    #ifdef USE_MAP
      vec3 weights = pow(abs(normalize(vCorkNormal)), vec3(4.0));
      weights /= weights.x + weights.y + weights.z;
      vec3 p = vCorkPosition * 1.15;
      vec4 corkColor = texture2D(map, p.yz) * weights.x
                     + texture2D(map, p.xz) * weights.y
                     + texture2D(map, p.xy) * weights.z;
      diffuseColor *= corkColor;
    #endif
  `)
}

export const triplanarCorkCacheKey = () => 'cork-triplanar-v1'
