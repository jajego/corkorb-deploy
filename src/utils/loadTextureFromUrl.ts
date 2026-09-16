import * as THREE from 'three'
import { GifTexture, isGif } from './gifTexture'

const MAX_DIMENSION = 2048

/**
 * Load a texture from a URL (data URL or regular URL).
 * Preserves transparent pixels (same as decodeTexture).
 * Returns the texture and its aspect ratio.
 */
export async function loadTextureFromUrl(url: string): Promise<{ texture: THREE.Texture; aspect: number }> {
  if (/\.gif(?:[?#]|$)/i.test(url) || /^data:image\/gif[;,]/i.test(url)) {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Unable to load GIF image.')
    const bytes = await response.arrayBuffer()
    // Older uploads can contain PNG bytes mislabeled as .gif. Keep them viewable.
    if (isGif(bytes)) {
      const texture = new GifTexture(bytes)
      return { texture, aspect: texture.image.width / texture.image.height }
    }
  }
  return new Promise((resolve, reject) => {
    // Load the image first
    const image = new Image()
    image.crossOrigin = 'anonymous'
    
    image.onload = () => {
      try {
        const { width, height } = image
        // Apply same scaling logic as decodeTexture
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        
        // Create a transparent canvas (same as decodeTexture).
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        
        if (!context) {
          reject(new Error('Unable to create 2D context for texture loading'))
          return
        }
        
        // Preserve the image's alpha channel.
        context.drawImage(image, 0, 0, targetWidth, targetHeight)
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas)
        texture.needsUpdate = true
        texture.flipY = false
        texture.generateMipmaps = true
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.colorSpace = THREE.SRGBColorSpace
        
        // Calculate aspect ratio
        const aspect = targetHeight !== 0 ? targetWidth / targetHeight : 1
        
        resolve({ texture, aspect })
      } catch (error) {
        reject(error)
      }
    }
    
    image.onerror = (error) => {
      reject(error)
    }
    
    image.src = url
  })
}

