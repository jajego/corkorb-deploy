import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import * as THREE from 'three'
import { createLogger } from '../../../utils/logger'
import { preloadCorkTexture } from '../../../three/textures/useCorkTexture'
import { hydrateServerPapers } from '../utils/texture'
import { getLatestPaperVector } from '../utils/paper'
import type { ServerPaper } from '../../../types/websocket'
import type { CorkShape, PlacedPaper } from '../../../types/orb'

const logger = createLogger('OrbScene')

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const REST_FALLBACK_DELAY_MS = 5_000

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
  const { getToken } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    websocketHasLoadedPapersRef.current = false
    let cancelled = false
    let fallbackTimeout: number | undefined

    async function loadFallbackPapers() {
      if (cancelled || websocketHasLoadedPapersRef.current) return

      try {
        const token = await getToken()
        const response = await fetch(`${API_BASE_URL}/api/orbs/${orbId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!response.ok) return

        const orb = await response.json() as { papers?: ServerPaper[] }
        if (cancelled || websocketHasLoadedPapersRef.current || !orb.papers?.length) return

        const fallbackPapers = await hydrateServerPapers(orb.papers, placedPapersRef.current)
        setPlacedPapers((prev) => {
          if (cancelled || websocketHasLoadedPapersRef.current) return prev

          const existingIds = new Set(prev.map((paper) => paper.id))
          const merged = [...prev, ...fallbackPapers.filter((paper) => !existingIds.has(paper.id))]
          setLastImageVector(getLatestPaperVector(merged))
          placedPapersRef.current = merged
          return merged
        })
      } catch (error) {
        logger.warn('REST paper fallback failed', error)
      }
    }

    async function checkOrbExists() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/orbs/${orbId}?include_papers=false`)

        if (response.status === 404) {
          setOrbExists(false)
          setTimeout(() => {
            navigate('/')
          }, 2000)
        } else if (response.ok) {
          if (cancelled) return
          const orb = await response.json() as { shape?: CorkShape }
          if (cancelled) return
          setOrbShape(orb.shape ?? 'sphere')
          setOrbExists(true)

          fallbackTimeout = window.setTimeout(loadFallbackPapers, REST_FALLBACK_DELAY_MS)
        } else {
          setOrbExists(false)
          navigate('/')
        }
      } catch (error) {
        logger.error('Failed to check orb existence and load papers', error)
        setOrbExists(false)
        navigate('/')
      }
    }
    preloadCorkTexture()
    checkOrbExists()
    return () => {
      cancelled = true
      if (fallbackTimeout !== undefined) window.clearTimeout(fallbackTimeout)
    }
  }, [orbId, getToken, navigate, websocketHasLoadedPapersRef, setOrbExists, setOrbShape, setPlacedPapers, setLastImageVector, placedPapersRef])
}

