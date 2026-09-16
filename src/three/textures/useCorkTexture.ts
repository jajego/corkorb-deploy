import { useTexture } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

const DEFAULT_CORK_TEXTURE = '/textures/cork.jpg'
const DEFAULT_REPEAT = 3.6
const DEFAULT_ANISOTROPY = 16

export function preloadCorkTexture() {
  useTexture.preload(DEFAULT_CORK_TEXTURE)
}

export function useCorkTexture(url = DEFAULT_CORK_TEXTURE) {
  const texture = useTexture(url)

  // Configure before the first render/GPU upload, not in a post-paint effect.
  // Otherwise the default 1x repeat can briefly look like a blurry cork texture.
  return useMemo(() => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(DEFAULT_REPEAT, DEFAULT_REPEAT)
    texture.anisotropy = DEFAULT_ANISOTROPY
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    return texture
  }, [texture])

}

