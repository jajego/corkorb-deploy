import { GifTexture, parsePaperGif } from '../src/utils/gifTexture'
import { compressImage, compressedImageToFile } from '../src/utils/compressImage'
import { decodeTexture } from '../src/scenes/orb/utils/texture'
import { loadTextureFromUrl } from '../src/utils/loadTextureFromUrl'
import * as THREE from 'three'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { PinnedPaper } from '../src/scenes/orb/components/PinnedPaper'

type Fixture = { name: string; base64: string; expected: number[][] }
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}
const bytesOf = (fixture: Fixture) => Uint8Array.from(atob(fixture.base64), c => c.charCodeAt(0)).buffer
const pixels = (texture: THREE.Texture) => Array.from((texture.image as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 4, 4).data)
const matches = (texture: THREE.Texture, expected: number[]) => JSON.stringify(pixels(texture)) === JSON.stringify(expected)

export async function runGifChecks(fixtures: Fixture[]) {
  // Verify alpha survives compression, local preview, and saved-image hydration.
  for (const type of ['image/png', 'image/webp']) {
    const source = document.createElement('canvas')
    source.width = source.height = 4
    const ctx = source.getContext('2d')!
    ctx.fillStyle = 'rgba(255,0,0,0.5)'
    ctx.fillRect(1, 0, 1, 4)
    ctx.fillStyle = 'red'
    ctx.fillRect(2, 0, 2, 4)
    const blob = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), type))
    const file = compressedImageToFile(await compressImage(new File([blob], 'alpha.png', { type: blob.type })), 'alpha')
    const url = URL.createObjectURL(file)
    const local = await decodeTexture(file)
    const remote = await loadTextureFromUrl(url)
    for (const { texture } of [local, remote]) {
      const rgba = pixels(texture)
      check(rgba[3] === 0 && Math.abs(rgba[7] - 128) <= 2 && rgba[11] === 255, type + ': alpha lost')
      texture.dispose()
    }
    URL.revokeObjectURL(url)
  }
  for (const fixture of fixtures) {
    const bytes = bytesOf(fixture)
    const file = new File([bytes], 'test.gif', { type: 'image/gif' })
    const compressed = compressedImageToFile(await compressImage(file), file.name)
    check(compressed.type === 'image/gif', 'Upload MIME changed')
    check(new Uint8Array(await compressed.arrayBuffer()).every((b, i) => b === new Uint8Array(bytes)[i]), 'Upload bytes changed')
    const { texture } = await decodeTexture(compressed)
    check(texture instanceof GifTexture, 'Preview did not use animated texture')
    const gif = texture as GifTexture
    check(matches(gif, fixture.expected[0]), fixture.name + ': first frame mismatch')
    gif.update(1000)
    gif.update(1099)
    check(matches(gif, fixture.expected[0]), fixture.name + ': frame advanced too early')
    gif.update(1100)
    check(matches(gif, fixture.expected[1]), fixture.name + ': second frame mismatch')
    gif.update(1300)
    check(matches(gif, fixture.expected[2]), fixture.name + ': disposal/transparency mismatch')
    gif.update(1350)
    check(matches(gif, fixture.expected[fixture.name === 'once' ? 2 : 0]), fixture.name + ': loop mismatch')
    if (fixture.name === 'repeat-once') {
      gif.update(1450); gif.update(1650); gif.update(1700)
      check(matches(gif, fixture.expected[2]), 'Finite loop repeated too often')
    }
    const version = gif.version
    gif.dispose()
    gif.update(1750)
    check(gif.version === version, 'Disposed texture still animates')

    // Server storage URLs end in .gif; the test HTTP endpoint provides the same bytes.
    const loaded = await loadTextureFromUrl(`/fixture/${fixture.name}.gif`)
    check(loaded.texture instanceof GifTexture && matches(loaded.texture, fixture.expected[0]), 'Saved GIF hydration failed')
    loaded.texture.dispose()
  }
  const large = bytesOf(fixtures[0]).slice(0)
  new DataView(large).setUint16(6, 1025, true)
  let rejected = false
  try { parsePaperGif(large) } catch { rejected = true }
  check(rejected, 'Oversized dimensions accepted')
  rejected = false
  try { parsePaperGif(new TextEncoder().encode('GIF89a').buffer) } catch { rejected = true }
  check(rejected, 'Truncated GIF accepted')

  const still = document.createElement('canvas')
  still.width = still.height = 4
  const legacy = await loadTextureFromUrl(still.toDataURL().replace('image/png', 'image/gif'))
  check(!(legacy.texture instanceof GifTexture), 'Legacy PNG mislabeled as GIF stopped loading')
  legacy.texture.dispose()

  // Exercise the actual WebGL upload: changing the canvas must change the mesh pixels.
  const texture = new GifTexture(bytesOf(fixtures[0]))
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true })
  renderer.setSize(128, 128)
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  camera.position.z = 2
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture }))
  let now = 1000
  mesh.onBeforeRender = () => texture.update(now)
  scene.add(mesh)
  renderer.render(scene, camera)
  const first = renderer.domElement.toDataURL()
  now = 1100
  renderer.render(scene, camera)
  check(first !== renderer.domElement.toDataURL(), 'GIF frame did not reach the WebGL paper material')
  texture.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose()

  // Verify the real paper component drives playback, including after replacing its texture.
  const host = document.createElement('div')
  host.style.cssText = 'width:256px;height:256px'
  document.body.appendChild(host)
  const root = createRoot(host)
  const paperTexture = new GifTexture(bytesOf(fixtures[0]))
  const replacement = new GifTexture(bytesOf(fixtures[0]))
  let paperScene: THREE.Scene | undefined
  const renderPaper = (map: GifTexture) => root.render(createElement(Canvas,
    { camera: { position: [0, 0, 3], fov: 50 }, onCreated: state => { paperScene = state.scene } },
    createElement(PinnedPaper, { texture: map, aspect: 1, scale: 1, shape: 'sphere',
      layerOffset: 0.002, center: new THREE.Vector3(0, 0, 1), quaternion: new THREE.Quaternion() })))
  const waitForAnimation = async (map: GifTexture) => {
    const deadline = performance.now() + 5000
    const initial = map.version
    while (map.version === initial && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    check(map.version > initial, 'PinnedPaper did not drive GIF playback')
  }
  try {
    renderPaper(paperTexture)
    await waitForAnimation(paperTexture)
    renderPaper(replacement)
    await waitForAnimation(replacement)
    let paperMaterial: THREE.MeshStandardMaterial | undefined
    paperScene!.traverse(object => {
      if (object instanceof THREE.Mesh && object.material.map === replacement) {
        check(object.renderOrder === 0.002, 'Paper lost placement order')
        paperMaterial = object.material
      }
    })
    check(paperMaterial && !paperMaterial.depthWrite && paperMaterial.alphaTest > 0, 'Paper transparency depth settings missing')
    // Render overlapping planes with the real paper material settings.
    const gpu = new THREE.WebGLRenderer({ preserveDrawingBuffer: true })
    gpu.setSize(128, 32)
    const overlap = new THREE.Scene()
    overlap.background = new THREE.Color('green')
    overlap.add(new THREE.AmbientLight('white', Math.PI))
    const view = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    view.position.z = 2
    const canvas = document.createElement('canvas')
    canvas.width = 4; canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(255,0,0,0.5)'; context.fillRect(2, 0, 1, 1)
    context.fillStyle = 'red'; context.fillRect(3, 0, 1, 1)
    const topTexture = new THREE.CanvasTexture(canvas)
    topTexture.minFilter = topTexture.magFilter = THREE.NearestFilter
    const topMaterial = paperMaterial!.clone()
    topMaterial.map = topTexture; topMaterial.bumpMap = topMaterial.roughnessMap = null
    topMaterial.vertexColors = false
    const bottomMaterial = topMaterial.clone()
    const lowerCanvas = document.createElement('canvas')
    lowerCanvas.width = 4; lowerCanvas.height = 1
    const lowerContext = lowerCanvas.getContext('2d')!
    lowerContext.fillStyle = 'blue'; lowerContext.fillRect(1, 0, 1, 1); lowerContext.fillRect(3, 0, 1, 1)
    lowerContext.fillStyle = 'rgba(0,0,255,0.5)'; lowerContext.fillRect(2, 0, 1, 1)
    const bottomTexture = new THREE.CanvasTexture(lowerCanvas)
    bottomTexture.minFilter = bottomTexture.magFilter = THREE.NearestFilter
    bottomMaterial.map = bottomTexture
    const geometry = new THREE.PlaneGeometry(2, 2)
    const top = new THREE.Mesh(geometry, topMaterial)
    const bottom = new THREE.Mesh(geometry, bottomMaterial)
    top.position.z = 0.01; top.renderOrder = 2; bottom.renderOrder = 1
    overlap.add(top, bottom) // Deliberately reverse insertion order.
    gpu.render(overlap, view)
    const gl = gpu.getContext()
    const sample = (x: number) => {
      const data = new Uint8Array(4)
      gl.readPixels(x, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
      return data
    }
    const empty = sample(16), hole = sample(48), blend = sample(80), opaque = sample(112)
    check(empty[1] > 100 && empty[0] < 5 && empty[2] < 5, 'Two transparent holes block the background')
    check(hole[2] > 100 && hole[0] < 5, 'Transparent hole blocks lower paper')
    check(blend[0] > 50 && blend[1] > 20 && blend[2] > 50, 'Two translucent papers do not blend over the background')
    check(opaque[0] > 100 && opaque[2] < 5, 'Upper opaque region fails to cover lower paper')
    topTexture.dispose(); bottomTexture.dispose(); topMaterial.dispose(); bottomMaterial.dispose(); geometry.dispose(); gpu.dispose()
  } finally {
    root.unmount(); paperTexture.dispose(); replacement.dispose(); host.remove()
  }
  return 'GIF upload, hydration, compositing, timing, looping, disposal, validation, legacy images, and WebGL checks passed'
}

export function checkReducedMotion(fixture: Fixture) {
  const texture = new GifTexture(bytesOf(fixture))
  texture.update(1000); texture.update(1100)
  check(matches(texture, fixture.expected[0]), 'Reduced motion did not freeze playback')
  texture.dispose()
}
