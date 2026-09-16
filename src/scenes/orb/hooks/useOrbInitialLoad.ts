import { useEffect } from 'react'
import { beginPaperLoadTiming, markPaperLoadStage } from '../utils/loadTiming'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { createLogger } from '../../../utils/logger'
import { preloadCorkTexture } from '../../../three/textures/useCorkTexture'
import { hydrateServerPapers } from '../utils/texture'
import { getLatestPaperVector } from '../utils/paper'
import type { ServerPaper } from '../../../types/websocket'
import type { CorkShape, PlacedPaper } from '../../../types/orb'

const logger = createLogger('OrbScene')

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

interface UseOrbInitialLoadOptions {
  orbId: string
  websocketHasLoadedPapersRef: React.MutableRefObject<boolean>
  setOrbExists: (exists: boolean | null) => void
  setOrbShape: (shape: CorkShape) => void
  setPlacedPapers: React.Dispatch<React.SetStateAction<PlacedPaper[]>>
  setLastImageVector: (vector: THREE.Vector3 | null) => void
  placedPapersRef: React.MutableRefObject<PlacedPaper[]>
}

export function useOrbInitialLoad({
  orbId,
  websocketHasLoadedPapersRef,
  setOrbExists,
  setOrbShape,
  setPlacedPapers,
  setLastImageVector,
  placedPapersRef,
}: UseOrbInitialLoadOptions) {
  const navigate = useNavigate()

  useEffect(() => {
    websocketHasLoadedPapersRef.current = false
    let cancelled = false
    let redirectTimeout: number | undefined
    const controller = new AbortController()
    beginPaperLoadTiming()

    async function checkOrbExists() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/orbs/${orbId}`, { signal: controller.signal })

        if (cancelled) return
        if (response.status === 404) {
          setOrbExists(false)
          redirectTimeout = window.setTimeout(() => {
            navigate('/')
          }, 2000)
        } else if (response.ok) {
          if (cancelled) return
          const orb = await response.json() as { shape?: CorkShape; papers?: ServerPaper[] }
          if (cancelled) return
          setOrbShape(orb.shape ?? 'sphere')
          setOrbExists(true)

          markPaperLoadStage('rest-metadata')
          if (!websocketHasLoadedPapersRef.current) {
            await hydrateServerPapers(orb.papers ?? [], placedPapersRef.current, paper => {
              setPlacedPapers(prev => {
                if (cancelled || websocketHasLoadedPapersRef.current || prev.some(current => current.id === paper.id)) return prev
                const merged = [...prev, paper]
                setLastImageVector(getLatestPaperVector(merged))
                placedPapersRef.current = merged
                return merged
              })
            })
          }
        } else {
          setOrbExists(false)
          navigate('/')
        }
      } catch (error) {
        if (cancelled) return
        logger.error('Failed to check orb existence and load papers', error)
        setOrbExists(false)
        navigate('/')
      }
    }
    preloadCorkTexture()
    // The small response can reveal the cork while the paper list downloads in parallel.
    fetch(`${API_BASE_URL}/api/orbs/${orbId}?include_papers=false`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok || cancelled) return
        const orb = await response.json() as { shape?: CorkShape }
        if (cancelled) return
        setOrbShape(orb.shape ?? 'sphere')
        setOrbExists(true)
        markPaperLoadStage('cork-metadata')
      })
      .catch(error => { if (!cancelled) logger.warn('Cork metadata request failed', error) })
    checkOrbExists()
    return () => {
      cancelled = true
      controller.abort()
      if (redirectTimeout !== undefined) window.clearTimeout(redirectTimeout)
    }
  }, [orbId, navigate, websocketHasLoadedPapersRef, setOrbExists, setOrbShape, setPlacedPapers, setLastImageVector, placedPapersRef])
}

