import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { downloadBlob, type CaptureOptions, type CaptureResult } from '../../../utils/captureOrbVideo'

/**
 * Component that provides canvas capture functionality.
 * Must be rendered inside a Canvas component.
 */
export function CanvasCapture({ 
  onCaptureReady 
}: { 
  onCaptureReady: (captureFn: (options: Omit<CaptureOptions, 'canvas'> & { onProgress?: (progress: number) => void }) => Promise<void>) => void 
}) {
  const { gl, camera, size } = useThree()

  useEffect(() => {
    const canvas = gl.domElement
    
    /**
     * Calculates the screen-space bounding box of the orb (sphere at origin, radius 1).
     * Projects the sphere's bounding box to screen coordinates and adds generous padding
     * to ensure the full orb is captured even when rotated at different angles.
     */
    const calculateOrbBounds = (): { x: number; y: number; width: number; height: number } => {
      const orbRadius = 1
      const orbCenter = new THREE.Vector3(0, 0, 0)
      
      // Project orb center to screen space
      const screenCenter = new THREE.Vector3()
      screenCenter.copy(orbCenter).project(camera)
      
      // Calculate screen coordinates (NDC to pixel coordinates)
      const pixelX = ((screenCenter.x + 1) / 2) * size.width
      const pixelY = ((1 - screenCenter.y) / 2) * size.height
      
      // Sample more points on the sphere to get a better bounding box
      // This ensures we capture the full sphere even when rotated
      const corners: THREE.Vector3[] = []
      
      // Standard axis-aligned points
      corners.push(
        new THREE.Vector3(orbRadius, 0, 0),      // right
        new THREE.Vector3(-orbRadius, 0, 0),     // left
        new THREE.Vector3(0, orbRadius, 0),      // top
        new THREE.Vector3(0, -orbRadius, 0),     // bottom
        new THREE.Vector3(0, 0, orbRadius),      // front
        new THREE.Vector3(0, 0, -orbRadius),     // back
      )
      
      // Add diagonal points to better capture rotated views
      const diag = orbRadius * 0.707 // sqrt(2)/2 for diagonal
      corners.push(
        new THREE.Vector3(diag, diag, 0),
        new THREE.Vector3(-diag, diag, 0),
        new THREE.Vector3(diag, -diag, 0),
        new THREE.Vector3(-diag, -diag, 0),
        new THREE.Vector3(diag, 0, diag),
        new THREE.Vector3(-diag, 0, diag),
        new THREE.Vector3(diag, 0, -diag),
        new THREE.Vector3(-diag, 0, -diag),
        new THREE.Vector3(0, diag, diag),
        new THREE.Vector3(0, -diag, diag),
        new THREE.Vector3(0, diag, -diag),
        new THREE.Vector3(0, -diag, -diag),
      )
      
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      
      corners.forEach(corner => {
        const projected = new THREE.Vector3()
        projected.copy(corner).project(camera)
        
        const x = ((projected.x + 1) / 2) * size.width
        const y = ((1 - projected.y) / 2) * size.height
        
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      })
      
      // Calculate base dimensions
      const baseWidth = maxX - minX
      const baseHeight = maxY - minY
      
      // Add generous padding (20% on all sides) to account for rotation
      // This ensures we capture the full orb even when it rotates to different angles
      const padding = Math.max(baseWidth, baseHeight) * 0.2
      const x = Math.max(0, Math.floor(minX - padding))
      const y = Math.max(0, Math.floor(minY - padding))
      const width = Math.min(size.width - x, Math.ceil(baseWidth + padding * 2))
      const height = Math.min(size.height - y, Math.ceil(baseHeight + padding * 2))
      
      return { x, y, width, height }
    }
    
    const capture = async (options: Omit<CaptureOptions, 'canvas'> & { onProgress?: (progress: number) => void }) => {
      const { onProgress, ...captureOptions } = options
      try {
        const duration = captureOptions.duration || 4
        const fps = captureOptions.fps || 30
        const frameInterval = 1000 / fps
        
        // Calculate initial orb bounds and fix them for the recording
        // This ensures consistent frame size throughout the recording
        const initialBounds = calculateOrbBounds()
        const bounds = {
          x: Math.round(initialBounds.x),
          y: Math.round(initialBounds.y),
          width: Math.max(1, Math.round(initialBounds.width)),
          height: Math.max(1, Math.round(initialBounds.height)),
        }
        
        // Set up MediaRecorder with a separate canvas that we'll update with cropped frames
        // We capture from the original canvas stream and manually crop to the orb bounds
        const recordCanvas = document.createElement('canvas')
        recordCanvas.width = bounds.width
        recordCanvas.height = bounds.height
        const recordCtx = recordCanvas.getContext('2d', {
          willReadFrequently: false,
          alpha: true, // Enable transparency
        })
        
        if (!recordCtx) {
          throw new Error('Failed to get 2D context for recording canvas')
        }
        
        // Create stream from the recording canvas
        const recordStream = recordCanvas.captureStream(fps)
        
        let mimeType = 'video/webp'
        if (!MediaRecorder.isTypeSupported('video/webp')) {
          mimeType = 'video/webm;codecs=vp9'
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm'
          }
        }
        
        const mediaRecorder = new MediaRecorder(recordStream, {
          mimeType,
          videoBitsPerSecond: 2500000,
        })
        
        const chunks: Blob[] = []
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data)
          }
        }
        
        const recordingPromise = new Promise<CaptureResult>((resolve, reject) => {
          mediaRecorder.onstop = () => {
            recordStream.getTracks().forEach(track => track.stop())
            const blob = new Blob(chunks, { type: mimeType })
            const url = URL.createObjectURL(blob)
            resolve({ blob, mimeType, url })
          }
          
          mediaRecorder.onerror = (event) => {
            recordStream.getTracks().forEach(track => track.stop())
            reject(new Error('MediaRecorder error: ' + event))
          }
        })
        
        // Start recording
        mediaRecorder.start()
        
        // Capture frames by copying from main canvas to recording canvas
        const startTime = performance.now()
        let lastFrameTime = startTime
        let recordingActive = true
        let frameCount = 0
        
        const captureFrame = (currentTime: DOMHighResTimeStamp) => {
          // Check if we should stop
          const elapsed = (currentTime - startTime) / 1000
          if (!recordingActive || elapsed >= duration) {
            if (recordingActive) {
              recordingActive = false
              mediaRecorder.stop()
            }
            return
          }
          
          // Throttle to target FPS
          const timeSinceLastFrame = currentTime - lastFrameTime
          if (timeSinceLastFrame >= frameInterval) {
            lastFrameTime = currentTime
            
            // Use fixed bounds (calculated at start) to avoid jittery margins
            // Don't recalculate bounds each frame as camera movement can cause slight shifts
            const sourceX = Math.max(0, Math.round(bounds.x))
            const sourceY = Math.max(0, Math.round(bounds.y))
            const sourceWidth = Math.min(canvas.width - sourceX, Math.round(bounds.width))
            const sourceHeight = Math.min(canvas.height - sourceY, Math.round(bounds.height))
            
            // Clear with transparent background (not black)
            recordCtx.clearRect(0, 0, bounds.width, bounds.height)
            
            if (sourceWidth > 0 && sourceHeight > 0) {
              // Copy cropped region from main canvas to recording canvas
              // Use smooth scaling to avoid pixelation artifacts
              recordCtx.imageSmoothingEnabled = true
              recordCtx.imageSmoothingQuality = 'high'
              
              recordCtx.drawImage(
                canvas,
                sourceX, sourceY, sourceWidth, sourceHeight, // source
                0, 0, bounds.width, bounds.height // destination
              )
            }
            
            // Update progress
            const progress = Math.min(elapsed / duration, 1)
            onProgress?.(progress)
            
            frameCount++
          }
          
          // Schedule next frame
          if (recordingActive) {
            requestAnimationFrame(captureFrame)
          }
        }
        
        // Start capturing frames
        requestAnimationFrame(captureFrame)
        
        // Wait for recording to complete
        const result = await recordingPromise
        
        // Download the result
        let extension = 'webm'
        if (result.mimeType.includes('webp')) {
          extension = 'webp'
        } else if (result.mimeType.includes('mp4')) {
          extension = 'mp4'
        }
        const filename = `orb-rotation-${Date.now()}.${extension}`
        downloadBlob(result.blob, filename)
        
        // Clean up URL
        URL.revokeObjectURL(result.url)
      } catch (error) {
        console.error('Failed to capture orb video:', error)
        throw error
      }
    }
    
    onCaptureReady(capture)
  }, [gl, camera, size, onCaptureReady])

  return null // This component doesn't render anything
}

