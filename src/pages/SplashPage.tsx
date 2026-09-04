import { useAuth } from '@clerk/react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useNavigate } from 'react-router-dom'
import { Suspense, useRef, useState } from 'react'
import * as THREE from 'three'

import { createLogger } from '../utils/logger'
import { AboutModal } from '../components/AboutModal'
import { MyCorksModal } from './MyCorksPage'
import { CorkOrb } from '../scenes/orb/components/CorkOrb'
import { OrbLights } from '../scenes/orb/components/OrbLights'
import type { CorkShape } from '../types/orb'
import './splash.css'

const logger = createLogger('SplashPage')
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const SHAPES: { value: CorkShape; label: string }[] = [
  { value: 'sphere', label: 'Orb' },
  { value: 'cube', label: 'Cube' },
  { value: 'pyramid', label: 'Pyramid' },
]
const SHAPE_GAP = 8
const SHAPE_SCALE: Record<CorkShape, number> = { sphere: 0.78, cube: 0.58, pyramid: 0.7 }
const SHAPE_Y: Record<CorkShape, number> = { sphere: 0, cube: 0.04, pyramid: 0.14 }

function SpinningCork({ shape, index, animate }: { shape: CorkShape; index: number; animate: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const viewportWidth = useThree((state) => state.viewport.width)
  const canvasWidth = useThree((state) => state.size.width)
  const gapWidth = SHAPE_GAP * viewportWidth / canvasWidth

  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.y += delta * 0.55
  })

  return (
    <group
      ref={ref}
      position={[(index - 1) * (viewportWidth + gapWidth) / 3, SHAPE_Y[shape], 0]}
      rotation={[0.2, index * 0.7 - 0.5, 0.08]}
      scale={SHAPE_SCALE[shape]}
    >
      <CorkOrb shape={shape} />
    </group>
  )
}

function CorkShapePreviews() {
  const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 5], zoom: 43 }}
      dpr={[1, 1.5]}
      frameloop={animate ? 'always' : 'demand'}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
    >
      <OrbLights />
      <Suspense fallback={null}>
        {SHAPES.map((option, index) => (
          <SpinningCork key={option.value} shape={option.value} index={index} animate={animate} />
        ))}
      </Suspense>
    </Canvas>
  )
}

export function SplashPage() {
  const { getToken, userId } = useAuth()
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showMyCorksModal, setShowMyCorksModal] = useState(false)
  const [shape, setShape] = useState<CorkShape>('sphere')

  const handleCreateOrb = async () => {
    if (!userId) {
      setError('Not authenticated')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      // Get JWT token
      const token = await getToken()
      if (!token) {
        setError('Failed to get authentication token')
        setIsCreating(false)
        return
      }

      // Create orb via REST API
      const response = await fetch(`${API_BASE_URL}/api/orbs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          max_papers: 50,
          shape,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to create orb' }))
        throw new Error(errorData.detail || `HTTP ${response.status}`)
      }

      const orb = await response.json()
      if (orb.id) {
        navigate(`/o/${orb.id}`, { state: { shape: orb.shape ?? shape } })
      } else {
        throw new Error('No orb ID in response')
      }
    } catch (err) {
      logger.error('Failed to create orb', err)
      setError(err instanceof Error ? err.message : 'Failed to create orb')
      setIsCreating(false)
    }
  }

  return (
    <main className="splash-page">
      <section className="splash-card">
        <div className="splash-kicker"><span aria-hidden="true" /> shared image space</div>
        <h1 className="splash-title">Cork<span>Orb</span></h1>

        <fieldset className="shape-fieldset">
          <legend>Choose your cork</legend>
          <div className="shape-picker" style={{ gap: SHAPE_GAP }}>
            <div className="shape-previews" aria-hidden="true">
              <CorkShapePreviews />
            </div>
            {SHAPES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`shape-option${shape === option.value ? ' shape-option--selected' : ''}`}
                aria-label={option.label}
                aria-pressed={shape === option.value}
                onClick={() => setShape(option.value)}
                disabled={isCreating}
              />
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          className="create-cork-button"
          onClick={handleCreateOrb}
          disabled={isCreating}
        >
          <span>{isCreating ? 'Making your cork…' : 'Create CorkOrb'}</span>
          {!isCreating && <span aria-hidden="true">↗</span>}
        </button>
        <div className="splash-links">
          <button type="button" className="about-text" onClick={() => setShowMyCorksModal(true)}>
            My corks
          </button>
          <button type="button" className="about-text" onClick={() => setShowAboutModal(true)}>
            What is this?
          </button>
        </div>

        {error && (
          <div className="splash-error" role="alert">
            {error}
          </div>
        )}
      </section>

      <AboutModal isOpen={showAboutModal} onClose={() => setShowAboutModal(false)} />
      <MyCorksModal isOpen={showMyCorksModal} onClose={() => setShowMyCorksModal(false)} />
    </main>
  )
}

