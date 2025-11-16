/**
 * Image compression utility for client-side pre-compression.
 * 
 * Compresses images to reduce file size before upload, which:
 * - Reduces upload time (smaller files = faster S3 uploads)
 * - Reduces S3 storage costs
 * - Reduces CDN bandwidth costs
 * - Improves UX for other users (faster CDN loads)
 * 
 * Strategy:
 * - Resize to max 2048px (maintains aspect ratio)
 * - Compress JPEG/WebP with quality settings
 * - Prefer WebP if supported (better compression)
 * - Fallback to JPEG if WebP not supported
 * - Preserve PNG for images with transparency (with compression)
 */

import { createLogger } from './logger'

const logger = createLogger('compressImage')

// Maximum dimension for images (same as decodeTexture)
const MAX_DIMENSION = 2048

// Compression quality settings
// Lower quality = smaller files, but we want good visual quality
// For large files (>1MB), we'll reduce quality more aggressively
const JPEG_QUALITY = 0.80 // 80% quality (good balance between size and quality)
const WEBP_QUALITY = 0.80 // 80% quality (WebP compresses better at same quality)
const PNG_QUALITY = 0.9 // 90% quality (PNG compression is less aggressive)

// Quality for large files (aggressive compression to ensure <2.5MB)
const JPEG_QUALITY_LARGE = 0.70 // 70% quality for large files
const WEBP_QUALITY_LARGE = 0.70 // 70% quality for large files

// WebP support detection
let webpSupported: boolean | null = null

/**
 * Check if WebP is supported in the current browser.
 */
function checkWebPSupport(): Promise<boolean> {
  if (webpSupported !== null) {
    return Promise.resolve(webpSupported)
  }

  return new Promise((resolve) => {
    const webP = new Image()
    webP.onload = webP.onerror = () => {
      webpSupported = webP.height === 2
      resolve(webpSupported)
    }
    webP.src =
      'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA'
  })
}

/**
 * Get the MIME type for the compressed image.
 * Prefers WebP if supported, otherwise uses the original format.
 */
async function getOutputMimeType(originalFile: File): Promise<string> {
  const supportsWebP = await checkWebPSupport()
  const originalType = originalFile.type.toLowerCase()

  // If WebP is supported and original is not PNG (preserve transparency), prefer WebP
  if (supportsWebP && originalType !== 'image/png' && originalType !== 'image/gif') {
    return 'image/webp'
  }

  // Use original format, but prefer JPEG for most cases
  if (originalType === 'image/jpeg' || originalType === 'image/jpg') {
    return 'image/jpeg'
  }

  if (originalType === 'image/png') {
    return 'image/png'
  }

  if (originalType === 'image/webp') {
    return 'image/webp'
  }

  if (originalType === 'image/gif') {
    return 'image/gif'
  }

  // Default to JPEG for unknown types
  return 'image/jpeg'
}

/**
 * Get file extension from MIME type.
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }

  return mimeToExt[mimeType.toLowerCase()] || 'jpg'
}

export interface CompressedImage {
  /** Compressed image as Blob */
  blob: Blob
  /** MIME type of compressed image */
  mimeType: string
  /** File extension of compressed image */
  extension: string
  /** Original file size in bytes */
  originalSize: number
  /** Compressed file size in bytes */
  compressedSize: number
  /** Compression ratio (0-1, lower is better compression) */
  compressionRatio: number
  /** Width of compressed image */
  width: number
  /** Height of compressed image */
  height: number
  /** Aspect ratio of compressed image */
  aspect: number
}

/**
 * Compress an image file for upload.
 * 
 * @param file Original image file
 * @param maxDimension Maximum dimension (default: 2048px)
 * @returns Compressed image with metadata
 */
export async function compressImage(
  file: File,
  maxDimension: number = MAX_DIMENSION
): Promise<CompressedImage> {
  const startTime = performance.now()
  const originalSize = file.size

  logger.debug(`Compressing image: ${file.name} (${(originalSize / 1024).toFixed(2)}KB)`)

  try {
    // Load image
    const image = await createImageBitmap(file)
    const { width: originalWidth, height: originalHeight } = image

    // Calculate new dimensions (maintain aspect ratio)
    const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight))
    const targetWidth = Math.max(1, Math.round(originalWidth * scale))
    const targetHeight = Math.max(1, Math.round(originalHeight * scale))

    logger.debug(
      `Resizing: ${originalWidth}x${originalHeight} -> ${targetWidth}x${targetHeight} (scale: ${scale.toFixed(3)})`
    )

    // Create canvas and draw image
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')

    if (!context) {
      image.close()
      throw new Error('Unable to create 2D context for image compression')
    }

    // Fill with white background (handles transparency)
    context.fillStyle = '#f8f4ea' // Same as PAPER_BACKGROUND_COLOR
    context.fillRect(0, 0, targetWidth, targetHeight)

    // Draw image
    context.drawImage(image, 0, 0, targetWidth, targetHeight)
    image.close()

    // Get output MIME type
    const outputMimeType = await getOutputMimeType(file)
    const extension = getFileExtension(outputMimeType)

    // Compress to Blob
    // Use more aggressive compression for large files to ensure they fit under the limit
    const isLargeFile = originalSize > 1 * 1024 * 1024 // >1MB
    const quality = outputMimeType === 'image/png' || outputMimeType === 'image/gif' 
      ? undefined 
      : outputMimeType === 'image/webp' 
      ? (isLargeFile ? WEBP_QUALITY_LARGE : WEBP_QUALITY)
      : (isLargeFile ? JPEG_QUALITY_LARGE : JPEG_QUALITY)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image to Blob'))
            return
          }
          resolve(blob)
        },
        outputMimeType,
        quality // undefined for PNG/GIF, quality value for JPEG/WebP
      )
    })

    const compressedSize = blob.size
    const compressionRatio = compressedSize / originalSize
    const aspect = targetHeight !== 0 ? targetWidth / targetHeight : 1

    const compressionTime = performance.now() - startTime
    const sizeReduction = ((1 - compressionRatio) * 100).toFixed(1)

    logger.debug(
      `Compression complete: ${(compressedSize / 1024).toFixed(2)}KB (${sizeReduction}% reduction) in ${compressionTime.toFixed(1)}ms`
    )

    return {
      blob,
      mimeType: outputMimeType,
      extension,
      originalSize,
      compressedSize,
      compressionRatio,
      width: targetWidth,
      height: targetHeight,
      aspect,
    }
  } catch (error) {
    logger.error('Failed to compress image', error)
    // Fallback: return original file (no compression)
    logger.warn('Falling back to original file (no compression)')
    const image = await createImageBitmap(file)
    const { width, height } = image
    image.close()
    const aspect = height !== 0 ? width / height : 1

    return {
      blob: file,
      mimeType: file.type || 'image/jpeg',
      extension: getFileExtension(file.type || 'image/jpeg'),
      originalSize: file.size,
      compressedSize: file.size,
      compressionRatio: 1,
      width,
      height,
      aspect,
    }
  }
}

/**
 * Convert a compressed image Blob to a File object for FormData upload.
 * 
 * @param compressedImage Compressed image result
 * @param originalFileName Original file name (without extension)
 * @returns File object ready for upload
 */
export function compressedImageToFile(
  compressedImage: CompressedImage,
  originalFileName: string
): File {
  // Remove extension from original file name and add new extension
  const baseName = originalFileName.replace(/\.[^/.]+$/, '')
  const fileName = `${baseName}.${compressedImage.extension}`

  return new File([compressedImage.blob], fileName, {
    type: compressedImage.mimeType,
  })
}

