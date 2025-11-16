import * as THREE from 'three'
import { loadTextureFromUrl } from '../../../utils/loadTextureFromUrl'
import { createLogger } from '../../../utils/logger'
import { arrayToVector, arrayToQuaternion } from './math'
import { PAPER_SPHERE_RADIUS, PAPER_OFFSET } from '../components/papers/constants'
import { DEFAULT_PAPER_SCALE, PAPER_BACKGROUND_COLOR } from './constants'
import type { ServerPaper } from '../../../types/websocket'
import type { PinInstance, PlacedPaper } from '../../../types/orb'

const logger = createLogger('OrbScene')

export function applyLayerOffsetToGeometry(
  positions: Float32Array | undefined,
  normals: Float32Array | undefined,
  offset: number
): Float32Array | undefined {
  if (!positions || !normals || positions.length !== normals.length || offset === 0) {
    return positions ?? undefined
  }
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += normals[i] * offset
    positions[i + 1] += normals[i + 1] * offset
    positions[i + 2] += normals[i + 2] * offset
  }
  return positions
}

export async function serverPaperToPlacedPaper(serverPaper: ServerPaper): Promise<PlacedPaper | null> {
  try {
    const { texture, aspect } = await loadTextureFromUrl(serverPaper.source_url)
    
    const data = serverPaper.data || {}
    const center = data.center 
      ? arrayToVector([data.center.x, data.center.y, data.center.z])
      : new THREE.Vector3(0, 0, PAPER_SPHERE_RADIUS + PAPER_OFFSET)
    const quaternion = data.quaternion
      ? arrayToQuaternion([data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w])
      : new THREE.Quaternion()
    const basisRight = data.basisRight
      ? arrayToVector([data.basisRight.x, data.basisRight.y, data.basisRight.z])
      : new THREE.Vector3(1, 0, 0)
    const basisUp = data.basisUp
      ? arrayToVector([data.basisUp.x, data.basisUp.y, data.basisUp.z])
      : new THREE.Vector3(0, 1, 0)
    const positions = data.positions ? new Float32Array(data.positions) : new Float32Array()
    const normals = data.normals ? new Float32Array(data.normals) : new Float32Array()
    const scale = data.scale ?? DEFAULT_PAPER_SCALE
    const paperAspect = data.aspect ?? aspect
    const rotation = data.rotation ?? 0
    const layerOffset = data.layerOffset ?? 0
    
    const pin: PinInstance = {
      id: serverPaper.id,
      position: arrayToVector([
        serverPaper.pin.position.x,
        serverPaper.pin.position.y,
        serverPaper.pin.position.z,
      ]),
      color: serverPaper.pin.color,
    }
    
    return {
      id: serverPaper.id,
      texture,
      aspect: paperAspect,
      scale,
      center,
      quaternion,
      basisRight,
      basisUp,
      positions,
      normals,
      pins: [pin],
      layerOffset,
      rotation,
      createdAt: serverPaper.created_at,
      userId: serverPaper.user_id,
      username: serverPaper.username,
      sourceUrl: serverPaper.source_url,
    }
  } catch (error) {
    logger.error('Failed to convert server paper to placed paper', error)
    return null
  }
}

export async function decodeTexture(file: File): Promise<{ texture: THREE.Texture; aspect: number }> {
  const maxDimension = 2048

  const makeTextureFromBitmap = (bitmap: ImageBitmap) => {
    const { width, height } = bitmap
    const scale = Math.min(1, maxDimension / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      throw new Error('Unable to create 2D context for texture decoding')
    }
    context.save()
    context.fillStyle = PAPER_BACKGROUND_COLOR
    context.fillRect(0, 0, targetWidth, targetHeight)
    context.restore()
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
    bitmap.close()
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    texture.flipY = false
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace
    return { texture, aspect: targetHeight !== 0 ? targetWidth / targetHeight : 1 }
  }

  try {
    const bitmap = await createImageBitmap(file)
    return makeTextureFromBitmap(bitmap)
  } catch (error) {
    logger.error('Failed to decode image with createImageBitmap, falling back', error)
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      const objectUrl = URL.createObjectURL(file)
      image.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const { width, height } = image
        const scale = Math.min(1, maxDimension / Math.max(width, height))
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Unable to create 2D context for texture fallback'))
          return
        }
        context.save()
        context.fillStyle = PAPER_BACKGROUND_COLOR
        context.fillRect(0, 0, targetWidth, targetHeight)
        context.restore()
        context.drawImage(image, 0, 0, targetWidth, targetHeight)
        const texture = new THREE.CanvasTexture(canvas)
        texture.needsUpdate = true
        texture.flipY = false
        texture.generateMipmaps = true
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.colorSpace = THREE.SRGBColorSpace
        resolve({ texture, aspect: targetHeight !== 0 ? targetWidth / targetHeight : 1 })
      }
      image.onerror = (event) => {
        URL.revokeObjectURL(objectUrl)
        reject(event)
      }
      image.src = objectUrl
    })
  }
}

