import * as THREE from 'three'
import { decompressFrame, parseGIF } from 'gifuct-js'
import { createLogger } from './logger'

const logger = createLogger('GifTexture')

// Keep these limits in sync with api/app/services/gif.py.
const MAX_BYTES = 10 * 1024 * 1024
const MAX_DIMENSION = 1024
const MAX_FRAMES = 120
const MAX_PIXELS = 32 * 1024 * 1024

export function isGif(bytes: ArrayBuffer): boolean {
  const header = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(6, bytes.byteLength)))
  return header === 'GIF87a' || header === 'GIF89a'
}

export function parsePaperGif(bytes: ArrayBuffer) {
  if (bytes.byteLength > MAX_BYTES) throw new Error('GIF must be 10 MiB or smaller.')
  if (!isGif(bytes)) throw new Error('This file is not a valid GIF image.')
  const gif = parseGIF(bytes)
  const { width, height } = gif.lsd
  const frames = gif.frames.filter(frame => 'image' in frame)
  if (!width || !height || Math.max(width, height) > MAX_DIMENSION) {
    throw new Error('GIF dimensions must be between 1 and 1024 pixels.')
  }
  if (!frames.length || frames.length > MAX_FRAMES || width * height * frames.length > MAX_PIXELS) {
    throw new Error('GIF is too complex: maximum 120 frames and 32 million decoded pixels.')
  }
  for (const frame of frames) {
    const d = frame.image.descriptor
    if (!d.width || !d.height || d.left + d.width > width || d.top + d.height > height) {
      throw new Error('Invalid GIF image frame dimensions.')
    }
  }
  return { gif, frames, width, height }
}

function canvasContext(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to create GIF image canvas.')
  return context
}

export class GifTexture extends THREE.CanvasTexture {
  private advanceFrame: ((now: number) => void) | null

  constructor(bytes: ArrayBuffer) {
    const { gif, frames, width, height } = parsePaperGif(bytes)
    const output = canvasContext(width, height)
    const composite = canvasContext(width, height)
    const patch = canvasContext(width, height)
    super(output.canvas)
    this.flipY = false
    this.generateMipmaps = false
    this.minFilter = THREE.LinearFilter
    this.magFilter = THREE.LinearFilter
    this.colorSpace = THREE.SRGBColorSpace

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // NETSCAPE stores repeats after the initial play; zero means forever.
    const application = gif.frames.find(frame => 'application' in frame && frame.application.id === 'NETSCAPE2.0')
    const loopExtension = application && 'application' in application ? application.application : undefined
    const loop = loopExtension?.blocks
    const repeats = loop && loop.length >= 3 ? loop[1] | (loop[2] << 8) : -1
    let completedLoops = 0
    let index = 0
    let previous: ReturnType<typeof decompressFrame> | undefined
    let saved: ImageData | undefined
    let deadline = 0
    let lastUpdate = 0

    const clear = (left: number, top: number, w: number, h: number, transparent: boolean) => {
      composite.clearRect(left, top, w, h)
      const background = gif.gct?.[gif.lsd.backgroundColorIndex]
      if (!transparent && background) {
        composite.fillStyle = `rgb(${background.join(',')})`
        composite.fillRect(left, top, w, h)
      }
    }
    const draw = () => {
      if (index === 0) clear(0, 0, width, height, Boolean(frames[0].gce?.extras.transparentColorGiven))
      else if (previous?.disposalType === 2) {
        const d = previous.dims
        clear(d.left, d.top, d.width, d.height, previous.transparentIndex !== undefined)
      } else if (previous?.disposalType === 3 && saved) composite.putImageData(saved, 0, 0)

      const frame = decompressFrame(frames[index], gif.gct, true)
      saved = frame.disposalType === 3 ? composite.getImageData(0, 0, width, height) : undefined
      const d = frame.dims
      patch.canvas.width = d.width
      patch.canvas.height = d.height
      const pixels = patch.createImageData(d.width, d.height)
      pixels.data.set(frame.patch)
      patch.putImageData(pixels, 0, 0)
      composite.drawImage(patch.canvas, d.left, d.top)
      output.clearRect(0, 0, width, height)
      output.drawImage(composite.canvas, 0, 0)
      previous = frame
      this.needsUpdate = true
    }
    draw()
    this.advanceFrame = now => {
      if (document.hidden || reducedMotion.matches || frames.length === 1) {
        deadline = 0
        return
      }
      // Resume without decoding a backlog after tab hiding or frustum culling.
      if (!deadline || now - lastUpdate > 250) deadline = now + Math.max(20, previous?.delay ?? 100)
      lastUpdate = now
      if (now < deadline) return
      if (index + 1 === frames.length) {
        if (repeats !== 0 && completedLoops >= Math.max(0, repeats)) return
        completedLoops++
      }
      index = (index + 1) % frames.length
      draw()
      deadline += Math.max(20, previous?.delay ?? 100)
    }
  }

  update(now = performance.now()) {
    try {
      this.advanceFrame?.(now)
    } catch (error) {
      // A damaged later frame must not take down the entire WebGL scene.
      this.advanceFrame = null
      logger.error('Unable to decode GIF frame; playback stopped', error)
    }
  }

  override dispose() {
    this.advanceFrame = null // Release parser, frame data, and compositing canvases.
    super.dispose()
  }
}

export function updateGifTexture(texture: THREE.Texture | null) {
  if (texture instanceof GifTexture) texture.update()
}
