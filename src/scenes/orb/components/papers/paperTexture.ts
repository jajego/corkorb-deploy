import * as THREE from 'three'

let cachedBumpTexture: THREE.CanvasTexture | null = null

export function getPaperBumpTexture(): THREE.CanvasTexture {
  if (cachedBumpTexture) return cachedBumpTexture

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create canvas context for paper texture')
  }

  const imageData = context.createImageData(size, size)
  for (let i = 0; i < imageData.data.length; i += 4) {
    const noise = 220 + Math.floor(Math.random() * 20) // subtle texture between 220-240
    imageData.data[i] = noise
    imageData.data[i + 1] = noise
    imageData.data[i + 2] = noise
    imageData.data[i + 3] = 255
  }
  context.putImageData(imageData, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(6, 6)
  texture.anisotropy = 4
  texture.needsUpdate = true
  texture.generateMipmaps = true
  texture.colorSpace = THREE.LinearSRGBColorSpace

  cachedBumpTexture = texture
  return texture
}
