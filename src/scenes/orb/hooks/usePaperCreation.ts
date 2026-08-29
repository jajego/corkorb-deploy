import { useEffect } from 'react'
import { useAuth, useUser } from '@clerk/react'
import * as THREE from 'three'
import { createLogger } from '../../../utils/logger'
import { getLatestPaperVector } from '../utils/paper'
import { PIN_LIMIT } from '../utils/constants'
import type { PendingPaper, PlacedPaper } from '../../../types/orb'

const logger = createLogger('PaperCreation')

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

interface UsePaperCreationOptions {
  pendingPaper: PendingPaper | null
  orbId: string
  setPendingPaper: React.Dispatch<React.SetStateAction<PendingPaper | null>>
  setPlacedPapers: React.Dispatch<React.SetStateAction<PlacedPaper[]>>
  setLastImageVector: React.Dispatch<React.SetStateAction<THREE.Vector3 | null>>
  setCameraOverride: React.Dispatch<React.SetStateAction<{ radius?: number; phi?: number; theta?: number } | null>>
  ghostTransformRef: React.MutableRefObject<{ center: THREE.Vector3; quaternion: THREE.Quaternion; right: THREE.Vector3; up: THREE.Vector3 } | null>
  ghostGeometryRef: React.MutableRefObject<{ positions: Float32Array; normals: Float32Array } | null>
  optimisticPapersRef: React.MutableRefObject<Map<string, string>>
  optimisticPapersByIdRef: React.MutableRefObject<Map<string, string>>
  placedPapersRef: React.MutableRefObject<PlacedPaper[]>
  enterExplore: () => void
}

/**
 * Handles paper creation when pinning is complete.
 * Creates optimistic paper, uploads to server, and tracks mappings.
 */
export function usePaperCreation({
  pendingPaper,
  orbId,
  setPendingPaper,
  setPlacedPapers,
  setLastImageVector,
  setCameraOverride,
  ghostTransformRef,
  ghostGeometryRef,
  optimisticPapersRef,
  optimisticPapersByIdRef,
  placedPapersRef,
  enterExplore,
}: UsePaperCreationOptions) {
  const { getToken } = useAuth()
  const { user } = useUser()
  const username = user?.username || null

  useEffect(() => {
    if (
      !pendingPaper ||
      pendingPaper.stage !== 'pinning' ||
      pendingPaper.pins.length < PIN_LIMIT ||
      !pendingPaper.texture ||
      !pendingPaper.center ||
      !pendingPaper.quaternion ||
      !pendingPaper.basisRight ||
      !pendingPaper.basisUp ||
      !pendingPaper.sourceUrl
    ) {
      return
    }

    // Capture paper data before clearing pending paper
    const paperData = {
      center: {
        x: pendingPaper.center.x,
        y: pendingPaper.center.y,
        z: pendingPaper.center.z,
      },
      quaternion: {
        x: pendingPaper.quaternion.x,
        y: pendingPaper.quaternion.y,
        z: pendingPaper.quaternion.z,
        w: pendingPaper.quaternion.w,
      },
      basisRight: {
        x: pendingPaper.basisRight.x,
        y: pendingPaper.basisRight.y,
        z: pendingPaper.basisRight.z,
      },
      basisUp: {
        x: pendingPaper.basisUp.x,
        y: pendingPaper.basisUp.y,
        z: pendingPaper.basisUp.z,
      },
      positions: pendingPaper.positions ? Array.from(pendingPaper.positions) : undefined,
      normals: pendingPaper.normals ? Array.from(pendingPaper.normals) : undefined,
      scale: pendingPaper.scale,
      aspect: pendingPaper.aspect,
      rotation: pendingPaper.rotation,
      layerOffset: pendingPaper.layerOffset,
    }

    // Get pin (should have exactly one)
    const pin = pendingPaper.pins[0]
    const sourceUrl = pendingPaper.sourceUrl
    const paperUserId = pendingPaper.userId
    const pendingTexture = pendingPaper.texture
    const pendingAspect = pendingPaper.aspect
    const pendingScale = pendingPaper.scale
    const pendingCenter = pendingPaper.center.clone()
    const pendingQuaternion = pendingPaper.quaternion.clone()
    const pendingBasisRight = pendingPaper.basisRight.clone()
    const pendingBasisUp = pendingPaper.basisUp.clone()
    const pendingPositions = pendingPaper.positions ? new Float32Array(pendingPaper.positions) : new Float32Array()
    const pendingNormals = pendingPaper.normals ? new Float32Array(pendingPaper.normals) : new Float32Array()
    const pendingLayerOffset = pendingPaper.layerOffset
    const pendingRotation = pendingPaper.rotation

    // Create optimistic paper ID (temporary, will be replaced by server ID)
    const optimisticId = `optimistic-${pendingPaper.id}-${Date.now()}`

    // OPTIMISTIC UI UPDATE: Add paper to placedPapers immediately and clear pending paper
    // This keeps the paper visible while waiting for server response
    const optimisticPaper: PlacedPaper = {
      id: optimisticId,
      texture: pendingTexture,
      aspect: pendingAspect,
      scale: pendingScale,
      center: pendingCenter,
      quaternion: pendingQuaternion,
      basisRight: pendingBasisRight,
      basisUp: pendingBasisUp,
      positions: pendingPositions,
      normals: pendingNormals,
      pins: [pin],
      layerOffset: pendingLayerOffset,
      rotation: pendingRotation,
      createdAt: new Date().toISOString(), // Temporary timestamp
      userId: paperUserId,
      username: username, // Use current user's username for optimistic paper
      sourceUrl: sourceUrl, // Store source URL for matching optimistic to real papers
    }

    // Track optimistic paper by source URL
    optimisticPapersRef.current.set(sourceUrl, optimisticId)

    // Add optimistic paper to placedPapers immediately
    setPlacedPapers((prev) => {
      const updated = [...prev, optimisticPaper]
      setLastImageVector(getLatestPaperVector(updated))
      placedPapersRef.current = updated
      return updated
    })

    // Clear pending paper and exit attach mode immediately
    // This makes the nailgun disappear right away
    setPendingPaper(null)
    setCameraOverride(null)
    ghostTransformRef.current = null
    ghostGeometryRef.current = null
    enterExplore()

    // Upload image to REST API endpoint (don't wait for response - optimistic update already done)
    // The WebSocket callback will replace the optimistic paper with the real one when it arrives
    const sourceFile = pendingPaper.sourceFile
    if (!sourceFile) {
      logger.error('Cannot upload paper: sourceFile is missing')
      // Remove optimistic paper if upload fails
      setPlacedPapers((prev) => {
        const filtered = prev.filter((p) => p.id !== optimisticId)
        setLastImageVector(getLatestPaperVector(filtered))
        placedPapersRef.current = filtered
        return filtered
      })
      optimisticPapersRef.current.delete(sourceUrl)
      return
    }

    // Prepare FormData for multipart/form-data upload
    const formData = new FormData()
    formData.append('file', sourceFile)
    formData.append(
      'pin',
      JSON.stringify({
        position: {
          x: pin.position.x,
          y: pin.position.y,
          z: pin.position.z,
        },
        color: pin.color,
        normal: pin.normal
          ? { x: pin.normal.x, y: pin.normal.y, z: pin.normal.z }
          : undefined,
      })
    )
    formData.append('data', JSON.stringify(paperData))
    // Add username if available (frontend has direct access to Clerk user)
    if (username) {
      formData.append('username', username)
    }

    // Upload to REST API (fire-and-forget - optimistic update already done)
    getToken()
      .then((token) => {
        if (!token) {
          throw new Error('Failed to get authentication token')
        }
        return fetch(`${API_BASE_URL}/api/orbs/${orbId}/papers`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        })
      })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.detail || `Upload failed: ${response.status}`)
          })
        }
        return response.json()
      })
      .then((paperResponse) => {
        optimisticPapersByIdRef.current.set(paperResponse.id, optimisticId)
        // Also keep the sourceUrl mapping for backward compatibility
        if (sourceUrl) {
          optimisticPapersRef.current.set(sourceUrl, optimisticId)
        }
        // A state or paper_created event may have arrived before this response.
        // Once its server ID is known, remove the duplicate optimistic entry.
        setPlacedPapers((prev) => {
          const optimisticPaper = prev.find((paper) => paper.id === optimisticId)
          const serverPaper = prev.find((paper) => paper.id === paperResponse.id)
          if (!optimisticPaper || !serverPaper) return prev

          optimisticPaper.texture?.dispose()
          const updated = prev.filter((paper) => paper.id !== optimisticId)
          setLastImageVector(getLatestPaperVector(updated))
          placedPapersRef.current = updated
          return updated
        })
      })
      .catch((error) => {
        logger.error('Failed to upload image', error)
        // Remove optimistic paper if upload fails
        setPlacedPapers((prev) => {
          const filtered = prev.filter((p) => p.id !== optimisticId)
          setLastImageVector(getLatestPaperVector(filtered))
          return filtered
        })
        optimisticPapersRef.current.delete(sourceUrl)
        // Clean up paper ID mapping if it exists
        for (const [paperId, optId] of optimisticPapersByIdRef.current.entries()) {
          if (optId === optimisticId) {
            optimisticPapersByIdRef.current.delete(paperId)
            break
          }
        }
        // Dispose texture
        optimisticPaper.texture?.dispose()
      })
  }, [pendingPaper, orbId, getToken, enterExplore, username, setPendingPaper, setPlacedPapers, setLastImageVector, setCameraOverride, ghostTransformRef, ghostGeometryRef, optimisticPapersRef, optimisticPapersByIdRef, placedPapersRef])
}

