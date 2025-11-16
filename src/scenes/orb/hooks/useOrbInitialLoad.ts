import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import * as THREE from 'three'
import { createLogger } from '../../../utils/logger'
import { serverPaperToPlacedPaper } from '../utils/texture'
import { getLatestPaperVector } from '../utils/paper'
import type { ServerPaper } from '../../../types/websocket'
import type { PlacedPaper } from '../../../types/orb'

const logger = createLogger('OrbScene')

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

interface UseOrbInitialLoadOptions {
  orbId: string
  websocketHasLoadedPapersRef: React.MutableRefObject<boolean>
  setOrbExists: (exists: boolean | null) => void
  setPlacedPapers: React.Dispatch<React.SetStateAction<PlacedPaper[]>>
  setLastImageVector: (vector: THREE.Vector3 | null) => void
  placedPapersRef: React.MutableRefObject<PlacedPaper[]>
}

export function useOrbInitialLoad({
  orbId,
  websocketHasLoadedPapersRef,
  setOrbExists,
  setPlacedPapers,
  setLastImageVector,
  placedPapersRef,
}: UseOrbInitialLoadOptions) {
  const { getToken } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    async function checkOrbExistsAndLoadPapers() {
      try {
        // Get token if user is authenticated (optional for viewing)
        const token = await getToken()
        
        // Build headers - include Authorization only if token exists
        const headers: HeadersInit = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        
        const response = await fetch(`${API_BASE_URL}/api/orbs/${orbId}`, {
          headers,
        })
        
        if (response.status === 404) {
          setOrbExists(false)
          setTimeout(() => {
            navigate('/')
          }, 2000)
        } else if (response.ok) {
          setOrbExists(true)
          
          const orbData = await response.json() as { papers?: ServerPaper[] }
          
          if (websocketHasLoadedPapersRef.current) {
            logger.debug('Initial load: Skipping GET papers - WebSocket already loaded papers first')
          } else if (orbData.papers && Array.isArray(orbData.papers) && orbData.papers.length > 0) {
            logger.debug(`Initial load: Found ${orbData.papers.length} papers in GET response`)
            
            const serverPapers: ServerPaper[] = orbData.papers
            
            const convertedPapers = await Promise.all(
              serverPapers.map((paper) => serverPaperToPlacedPaper(paper))
            )
            const validPapers = convertedPapers.filter((paper): paper is PlacedPaper => paper !== null)
            
            if (validPapers.length > 0) {
              logger.debug(`Initial load: Successfully loaded ${validPapers.length} papers from GET`)
              setPlacedPapers(validPapers)
              setLastImageVector(getLatestPaperVector(validPapers))
              placedPapersRef.current = validPapers
            }
          } else {
            logger.debug('Initial load: No papers in GET response')
          }
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
    
    checkOrbExistsAndLoadPapers()
  }, [orbId, getToken, navigate, websocketHasLoadedPapersRef, setOrbExists, setPlacedPapers, setLastImageVector, placedPapersRef])
}

