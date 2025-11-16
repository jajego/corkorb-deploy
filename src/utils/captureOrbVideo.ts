/**
 * Captures frames from a Three.js canvas and creates an animated WebP.
 * 
 * Uses MediaRecorder API if WebP codec is supported, otherwise falls back
 * to capturing individual frames that can be converted to WebP.
 */

export interface CaptureOptions {
  /** Duration in seconds to record */
  duration: number
  /** Frames per second */
  fps?: number
  /** Canvas element to capture from */
  canvas: HTMLCanvasElement
  /** Callback for progress updates (0-1) */
  onProgress?: (progress: number) => void
}

export interface CaptureResult {
  /** Blob containing the video/webp */
  blob: Blob
  /** MIME type of the result */
  mimeType: string
  /** URL for the blob (for download/preview) */
  url: string
}

// Re-export for convenience
export type { CaptureOptions, CaptureResult }

/**
 * Captures frames from canvas and creates a video using MediaRecorder.
 * Uses WebP if supported, otherwise falls back to WebM.
 * WebM can be converted to WebP using ffmpeg: `ffmpeg -i input.webm output.webp`
 */
export async function captureOrbVideo(options: CaptureOptions): Promise<CaptureResult> {
  const { canvas, duration, fps = 30, onProgress } = options
  
  // Use MediaRecorder (supports WebP in Chrome, WebM in all browsers)
  return captureWithMediaRecorder(canvas, duration, fps, onProgress)
}

/**
 * Uses MediaRecorder API to capture video.
 * Tries WebP first, falls back to WebM (widely supported).
 */
async function captureWithMediaRecorder(
  canvas: HTMLCanvasElement,
  duration: number,
  fps: number,
  onProgress?: (progress: number) => void
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(fps)
    
    // Try WebP first, fall back to WebM
    let mimeType = 'video/webp'
    if (!MediaRecorder.isTypeSupported('video/webp')) {
      mimeType = 'video/webm;codecs=vp9'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm'
      }
    }
    
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2500000, // 2.5 Mbps for good quality
    })
    
    const chunks: Blob[] = []
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      const url = URL.createObjectURL(blob)
      resolve({ blob, mimeType, url })
    }
    
    mediaRecorder.onerror = (event) => {
      reject(new Error('MediaRecorder error: ' + event))
    }
    
    // Start recording
    mediaRecorder.start()
    
    // Update progress
    const startTime = Date.now()
    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      const progress = Math.min(elapsed / duration, 1)
      onProgress?.(progress)
      
      if (progress >= 1) {
        clearInterval(progressInterval)
      }
    }, 100)
    
    // Stop after duration
    setTimeout(() => {
      clearInterval(progressInterval)
      mediaRecorder.stop()
      stream.getTracks().forEach(track => track.stop())
    }, duration * 1000)
  })
}


/**
 * Downloads a blob as a file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

