import { useCallback } from 'react'
import { useAuth } from '@clerk/react'

import { fileToDataUrl } from '../../../utils/fileToDataUrl'
import { compressImage, compressedImageToFile, type CompressedImage } from '../../../utils/compressImage'
import { createLogger } from '../../../utils/logger'
import { decodeTexture } from '../utils/texture'
import { makeId } from '../utils/paper'
import { DEFAULT_PAPER_SCALE } from '../utils/constants'
import type { PendingPaper } from '../../../types/orb'

const logger = createLogger('PaperUpload')

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_ORIGINAL_SIZE = 20 * 1024 * 1024 // 20MB (allow larger originals since we compress)

interface UsePaperUploadOptions {
  onFileSelected: (pendingPaper: PendingPaper) => void
  onError: (message: string) => void
  nextLayerOffset: number
}

/**
 * Handles file selection, validation, compression, and texture loading for paper uploads.
 */
export function usePaperUpload({
  onFileSelected,
  onError,
  nextLayerOffset,
}: UsePaperUploadOptions) {
  const { isSignedIn, userId } = useAuth()

  const handleFileSelection = useCallback(
    async (file: File) => {
      // Check if user is signed in before allowing file upload
      if (!isSignedIn) {
        onError('You must create an account to pin images.')
        return
      }

      // Validate file type BEFORE entering attach mode
      const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
      const fileType = file.type.toLowerCase()
      const isImageFile = validImageTypes.includes(fileType)

      if (!isImageFile) {
        logger.error(`Invalid file type: ${fileType}. Only image files (JPEG, PNG, WebP, GIF) are supported.`)
        onError('Only image files are supported (JPEG, PNG, WebP, GIF).')
        return
      }

      // Validate file size BEFORE entering attach mode (rough check - will check again after compression)
      if (file.size > MAX_ORIGINAL_SIZE) {
        logger.error(
          `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${MAX_ORIGINAL_SIZE / 1024 / 1024}MB).`
        )
        onError(
          `Image is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is ${MAX_ORIGINAL_SIZE / 1024 / 1024}MB.`
        )
        return
      }

      // Compress image first (reduces upload time and storage costs)
      try {
        const compressed: CompressedImage = await compressImage(file)
        logger.info(
          `Image compressed: ${(compressed.originalSize / 1024).toFixed(2)}KB -> ${(compressed.compressedSize / 1024).toFixed(2)}KB (${((1 - compressed.compressionRatio) * 100).toFixed(1)}% reduction)`
        )

        // Check compressed file size (backend limit: 5MB)
        if (compressed.compressedSize > MAX_UPLOAD_SIZE) {
          logger.error(
            `Compressed file size (${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${MAX_UPLOAD_SIZE / 1024 / 1024}MB). Original: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB`
          )
          onError(
            `Image is too large (${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB). Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB.`
          )
          return
        }

        // Convert compressed image to File for upload
        const compressedFile = compressedImageToFile(compressed, file.name)

        // Convert compressed file to data URL for sourceUrl
        const dataUrl = await fileToDataUrl(compressedFile)

        // Decode compressed image for texture (uses compressed image, not original)
        const { texture, aspect } = await decodeTexture(compressedFile)

        const pendingPaper: PendingPaper = {
          id: makeId('paper'),
          texture,
          aspect: aspect || compressed.aspect || 1,
          scale: DEFAULT_PAPER_SCALE,
          stage: 'positioning',
          pins: [],
          layerOffset: nextLayerOffset,
          rotation: 0,
          userId: userId || 'anonymous',
          sourceFile: compressedFile, // Use compressed file for upload
          sourceUrl: dataUrl,
        }

        onFileSelected(pendingPaper)
      } catch (error: unknown) {
        logger.error('Failed to process image', error)

        // Check if it's a non-image file error (createImageBitmap fails for non-images)
        if (error instanceof Error && (error.message.includes('image') || error.message.includes('decode'))) {
          onError('This file is not a valid image. Please select an image file.')
        } else {
          // Fallback: try to use original file if compression fails for other reasons
          try {
            const dataUrl = await fileToDataUrl(file)
            const { texture, aspect } = await decodeTexture(file)

            const pendingPaper: PendingPaper = {
              id: makeId('paper'),
              texture,
              aspect: aspect || 1,
              scale: DEFAULT_PAPER_SCALE,
              stage: 'positioning',
              pins: [],
              layerOffset: nextLayerOffset,
              rotation: 0,
              userId: userId || 'anonymous',
              sourceFile: file,
              sourceUrl: dataUrl,
            }

            onFileSelected(pendingPaper)
          } catch (fallbackError: unknown) {
            logger.error('Failed to process image (fallback)', fallbackError)
            onError('Failed to load image. Please try another image.')
          }
        }
      }
    },
    [isSignedIn, userId, nextLayerOffset, onFileSelected, onError]
  )

  return { handleFileSelection }
}

