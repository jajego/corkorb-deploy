import * as THREE from 'three'

/**
 * Paper background color for transparent images.
 * Must match the color used in decodeTexture.
 */
const PAPER_BACKGROUND_COLOR = '#f8f4ea'
const MAX_DIMENSION = 2048

/**
 * Load a texture from a URL (data URL or regular URL).
 * Applies a paper background color to transparent images (same as decodeTexture).
 * Returns the texture and its aspect ratio.
 */
export async function loadTextureFromUrl(url: string): Promise<{ texture: THREE.Texture; aspect: number }> {
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
        
        // Create canvas and apply paper background color (same as decodeTexture)
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        
        if (!context) {
          reject(new Error('Unable to create 2D context for texture loading'))
          return
        }
        
        // Fill canvas with paper background color (handles transparent images)
        context.save()
        context.fillStyle = PAPER_BACKGROUND_COLOR
        context.fillRect(0, 0, targetWidth, targetHeight)
        context.restore()
        
        // Draw the image on top of the background
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

