import { useCallback } from 'react'
import * as THREE from 'three'
import { createLogger } from '../../../utils/logger'
import { getLatestPaperVector } from '../utils/paper'
import { serverPaperToPlacedPaper } from '../utils/texture'
import type { ServerPaper } from '../../../types/websocket'
import type { PlacedPaper } from '../../../types/orb'

const logger = createLogger('OrbWebSocketHandlers')

interface UseOrbWebSocketHandlersOptions {
  orbId: string
  userId: string | null
  placedPapersRef: React.MutableRefObject<PlacedPaper[]>
  setPlacedPapers: React.Dispatch<React.SetStateAction<PlacedPaper[]>>
  setLastImageVector: React.Dispatch<React.SetStateAction<THREE.Vector3 | null>>
  optimisticPapersRef: React.MutableRefObject<Map<string, string>>
  optimisticPapersByIdRef: React.MutableRefObject<Map<string, string>>
  optimisticallyDeletedPapersRef: React.MutableRefObject<Map<string, PlacedPaper | null>>
  optimisticallyDeletedSourceUrlsRef: React.MutableRefObject<Set<string>>
  deletionInProgressRef: React.MutableRefObject<Set<string>>
  processingPapersRef: React.MutableRefObject<Set<string>>
  pendingDeletionsRef: React.MutableRefObject<Set<string>>
  websocketHasLoadedPapersRef: React.MutableRefObject<boolean>
  initialConnectionCompleteRef: React.MutableRefObject<boolean>
  seenUsersRef: React.MutableRefObject<Set<string>> // Track users seen during initial connection
  sendMessage: (message: unknown, expectResponse: boolean) => Promise<void>
  showToast: (message: React.ReactNode, type: 'info' | 'warning' | 'error', duration?: number) => void
}

interface ViewCenter {
  lat: number
  lon: number
}

/**
 * Handles all WebSocket event callbacks for the orb.
 * Manages paper state synchronization, optimistic updates, and error handling.
 */
export function useOrbWebSocketHandlers({
  orbId,
  userId,
  placedPapersRef,
  setPlacedPapers,
  setLastImageVector,
  optimisticPapersRef,
  optimisticPapersByIdRef,
  optimisticallyDeletedPapersRef,
  optimisticallyDeletedSourceUrlsRef,
  deletionInProgressRef,
  processingPapersRef,
  pendingDeletionsRef,
  websocketHasLoadedPapersRef,
  initialConnectionCompleteRef,
  seenUsersRef,
  sendMessage: sendMessageFn,
  showToast,
}: UseOrbWebSocketHandlersOptions) {
  const onState = useCallback(
    async (papers: ServerPaper[]) => {
      websocketHasLoadedPapersRef.current = true

      // Mark initial connection as complete when we receive state
      // This happens after the backend has sent all existing users' user_joined messages
      // At this point, all users seen so far are in seenUsersRef, so future joins will show toasts
      if (!initialConnectionCompleteRef.current) {
        // First connection - mark as complete (seenUsersRef already has all initial users)
        initialConnectionCompleteRef.current = true
      } else {
        // Reconnection - state was already reset when WebSocket connected
        // Mark as complete now that we've received state
        initialConnectionCompleteRef.current = true
      }

      // Convert server papers to client papers
      const convertedPapers = await Promise.all(papers.map((paper) => serverPaperToPlacedPaper(paper)))
      const validPapers = convertedPapers.filter((paper): paper is PlacedPaper => paper !== null)

      // Preserve optimistic papers that haven't been replaced yet
      // Also respect optimistically deleted papers (don't re-add them from server state)
      setPlacedPapers((prev) => {
        const optimisticPapersToKeep = prev.filter((paper) => {
          if (paper.id.startsWith('optimistic-')) {
            for (const [paperId, optimisticId] of optimisticPapersByIdRef.current.entries()) {
              if (optimisticId === paper.id) {
                const serverPaper = papers.find((p) => p.id === paperId)
                return !serverPaper
              }
            }
            for (const [sourceUrl, optimisticId] of optimisticPapersRef.current.entries()) {
              if (optimisticId === paper.id) {
                const serverPaper = papers.find((p) => p.source_url === sourceUrl)
                return !serverPaper
              }
            }
          }
          return false
        })

        const validPapersFiltered = validPapers.filter((paper) => {
          // Skip papers that were optimistically deleted
          const wasDeleted = optimisticallyDeletedPapersRef.current.has(paper.id)
          if (wasDeleted) {
            const deletedPaper = optimisticallyDeletedPapersRef.current.get(paper.id)
            if (!deletedPaper) {
              optimisticallyDeletedPapersRef.current.delete(paper.id)
            }
            return false
          }
          // Skip papers that were deleted before they were created (pending deletions)
          if (pendingDeletionsRef.current.has(paper.id)) {
            pendingDeletionsRef.current.delete(paper.id)
            return false
          }
          return true
        })

        const merged = [...validPapersFiltered, ...optimisticPapersToKeep]
        setLastImageVector(getLatestPaperVector(merged))
        placedPapersRef.current = merged
        return merged
      })
    },
    [
      websocketHasLoadedPapersRef,
      initialConnectionCompleteRef,
      seenUsersRef,
      optimisticPapersRef,
      optimisticPapersByIdRef,
      optimisticallyDeletedPapersRef,
      pendingDeletionsRef,
      setPlacedPapers,
      setLastImageVector,
      placedPapersRef,
    ]
  )

  const onPaperCreated = useCallback(
    async (paper: ServerPaper) => {
      if (processingPapersRef.current.has(paper.id)) {
        return
      }

      const paperAlreadyExists = placedPapersRef.current.find((p) => p.id === paper.id)
      if (paperAlreadyExists) {
        return
      }

      processingPapersRef.current.add(paper.id)

      const paperExistsAfterFlag = placedPapersRef.current.find((p) => p.id === paper.id)
      if (paperExistsAfterFlag) {
        processingPapersRef.current.delete(paper.id)
        return
      }

      try {
        // Check if this paper was deleted before it was created (late deletion)
        if (pendingDeletionsRef.current.has(paper.id)) {
          pendingDeletionsRef.current.delete(paper.id)
          optimisticPapersByIdRef.current.delete(paper.id)
          if (paper.source_url) {
            optimisticPapersRef.current.delete(paper.source_url)
          }
          processingPapersRef.current.delete(paper.id)
          return
        }

        if (optimisticallyDeletedPapersRef.current.has(paper.id)) {
          processingPapersRef.current.delete(paper.id)
          return
        }

        if (optimisticallyDeletedSourceUrlsRef.current.has(paper.source_url)) {
          optimisticallyDeletedSourceUrlsRef.current.delete(paper.source_url)
          optimisticPapersByIdRef.current.delete(paper.id)
          sendMessageFn(
            {
              type: 'delete_paper',
              orb_id: orbId,
              paper_id: paper.id,
            },
            false
          )
          processingPapersRef.current.delete(paper.id)
          return
        }

        const convertedPaper = await serverPaperToPlacedPaper(paper)
        if (convertedPaper) {
          setPlacedPapers((prev) => {
            const existingPaperById = prev.find((p) => p.id === paper.id)
            if (existingPaperById) {
              return prev
            }

            placedPapersRef.current = prev

            const optimisticIdFromPaperId = optimisticPapersByIdRef.current.get(paper.id)
            const optimisticIdFromSourceUrl = optimisticPapersRef.current.get(paper.source_url)
            const optimisticPaperInState = prev.find(
              (p) =>
                p.id.startsWith('optimistic-') &&
                (optimisticIdFromPaperId === p.id || optimisticIdFromSourceUrl === p.id)
            )
            const optimisticId = optimisticIdFromPaperId || optimisticIdFromSourceUrl || optimisticPaperInState?.id

            if (optimisticId || optimisticPaperInState) {
              // Use the ID from state if mapping is missing (handles race condition)
              const actualOptimisticId = optimisticPaperInState?.id || optimisticId
              const optimisticPaper = optimisticPaperInState || prev.find((p) => p.id === actualOptimisticId)

              if (optimisticPaper) {
                // Dispose the optimistic paper's texture if different
                if (optimisticPaper.texture && optimisticPaper.texture !== convertedPaper.texture) {
                  optimisticPaper.texture.dispose()
                }

                // Remove ALL optimistic papers with this sourceUrl and add real paper in one atomic update
                const updated = prev.filter((p) => {
                  if (p.id === actualOptimisticId) return false
                  if (p.id.startsWith('optimistic-') && p.sourceUrl === paper.source_url) {
                    p.texture?.dispose()
                    return false
                  }
                  if (p.id === paper.id) return false
                  return true
                })
                updated.push(convertedPaper)
                setLastImageVector(getLatestPaperVector(updated))
                placedPapersRef.current = updated
                return updated
              } else {
                const updated = [...prev, convertedPaper]
                setLastImageVector(getLatestPaperVector(updated))
                placedPapersRef.current = updated
                return updated
              }
            } else {
              // No optimistic paper - check for unexpected optimistic papers with this sourceUrl
              const anyOptimisticWithSourceUrl = prev.find(
                (p) => p.id.startsWith('optimistic-') && p.sourceUrl === paper.source_url
              )
              if (anyOptimisticWithSourceUrl) {
                const updated = prev.filter((p) => p.id !== anyOptimisticWithSourceUrl.id)
                anyOptimisticWithSourceUrl.texture?.dispose()
                updated.push(convertedPaper)
                setLastImageVector(getLatestPaperVector(updated))
                placedPapersRef.current = updated
                return updated
              }

              // Final check: ensure paper isn't already in prev
              const alreadyInPrev = prev.find((p) => p.id === paper.id)
              if (alreadyInPrev) {
                return prev
              }

              const updated = [...prev, convertedPaper]
              setLastImageVector(getLatestPaperVector(updated))
              placedPapersRef.current = updated
              return updated
            }
          })
        } else {
          logger.error(`onPaperCreated: Failed to convert server paper ${paper.id}`)
        }
      } finally {
        processingPapersRef.current.delete(paper.id)
      }
    },
    [
      processingPapersRef,
      placedPapersRef,
      pendingDeletionsRef,
      optimisticPapersByIdRef,
      optimisticPapersRef,
      optimisticallyDeletedPapersRef,
      optimisticallyDeletedSourceUrlsRef,
      orbId,
      sendMessageFn,
      setPlacedPapers,
      setLastImageVector,
    ]
  )

  const onPaperDeleted = useCallback(
    (paperId: string, reason?: string) => {
      logger.info(`onPaperDeleted called for paper: ${paperId}, reason: ${reason}`)

      // Clean up deletion in progress tracking
      deletionInProgressRef.current.delete(paperId)

      // Mark this paper as pending deletion (in case it hasn't been created yet)
      // This prevents the paper from appearing if paper_created arrives later
      pendingDeletionsRef.current.add(paperId)

      // Try to find the paper by real ID first
      let deletedPaper = placedPapersRef.current.find((paper) => paper.id === paperId)
      let optimisticId: string | undefined

      // If not found by real ID, try to find via optimistic mapping
      if (!deletedPaper) {
        optimisticId = optimisticPapersByIdRef.current.get(paperId)
        if (optimisticId) {
          deletedPaper = placedPapersRef.current.find((paper) => paper.id === optimisticId)
        }
      }

      // If still not found, try to find by searching all optimistic papers
      if (!deletedPaper) {
        const allOptimisticPapers = placedPapersRef.current.filter((p) => p.id.startsWith('optimistic-'))
        for (const optPaper of allOptimisticPapers) {
          for (const [mappedPaperId, mappedOptId] of optimisticPapersByIdRef.current.entries()) {
            if (mappedPaperId === paperId && mappedOptId === optPaper.id) {
              deletedPaper = optPaper
              optimisticId = optPaper.id
              break
            }
          }
          if (deletedPaper) break
        }
      }

      // If still not found and it's an NSFW deletion for current user, try to find by checking
      // all optimistic papers from current user
      if (!deletedPaper && reason === 'nsfw_violation' && userId) {
        const currentUserOptimisticPapers = placedPapersRef.current.filter(
          (p) => p.id.startsWith('optimistic-') && p.userId === userId
        )
        if (currentUserOptimisticPapers.length === 1) {
          const singleOptimisticPaper = currentUserOptimisticPapers[0]
          let isMappedToOtherPaper = false
          for (const [mappedPaperId, mappedOptId] of optimisticPapersByIdRef.current.entries()) {
            if (mappedOptId === singleOptimisticPaper.id && mappedPaperId !== paperId) {
              isMappedToOtherPaper = true
              break
            }
          }
          if (!isMappedToOtherPaper) {
            deletedPaper = singleOptimisticPaper
            optimisticId = singleOptimisticPaper.id
          }
        }
      }

      const actualPaperId = deletedPaper?.id || paperId
      const isCurrentUserPaper = deletedPaper && deletedPaper.userId === userId
      if (reason === 'nsfw_violation' && isCurrentUserPaper) {
        showToast('Your image was removed due to content violation', 'warning', 8000)
      }

      if (!optimisticallyDeletedPapersRef.current.has(paperId)) {
        optimisticallyDeletedPapersRef.current.set(paperId, null)
      }
      const optimisticallyDeletedPaper = optimisticallyDeletedPapersRef.current.get(paperId)
      if (optimisticallyDeletedPaper) {
        optimisticallyDeletedPapersRef.current.delete(paperId)

        if (optimisticallyDeletedPaper.texture) {
          optimisticallyDeletedPaper.texture.dispose()
        }

        setPlacedPapers((prev) => {
          const filtered = prev.filter((paper) => {
            if (paper.id === actualPaperId || paper.id === paperId) return false
            if (optimisticId && paper.id === optimisticId) return false
            return true
          })
          if (filtered.length !== prev.length) {
            setLastImageVector(getLatestPaperVector(filtered))
          }
          placedPapersRef.current = filtered
          return filtered
        })
        pendingDeletionsRef.current.delete(paperId)
        return
      }

      setPlacedPapers((prev) => {
        // Use the latest state from ref to ensure we have the most up-to-date papers
        // This handles race conditions where prev might be stale
        const currentPapers = placedPapersRef.current.length > 0 ? placedPapersRef.current : prev

        // Try to find the paper by actualPaperId, paperId, or optimisticId
        // Check both prev (from state) and currentPapers (from ref) to handle race conditions
        let paperExists = prev.find((paper) => {
          if (paper.id === actualPaperId) return true
          if (paper.id === paperId) return true
          if (optimisticId && paper.id === optimisticId) return true
          return false
        })

        // If not found in prev, check currentPapers (ref) - handles race conditions
        if (!paperExists && currentPapers !== prev) {
          paperExists = currentPapers.find((paper) => {
            if (paper.id === actualPaperId) return true
            if (paper.id === paperId) return true
            if (optimisticId && paper.id === optimisticId) return true
            return false
          })
        }

        if (!paperExists) {
          // Paper not found in state - mark as pending deletion so it won't appear if paper_created arrives later
          optimisticPapersByIdRef.current.delete(paperId)
          return prev
        }

        // Remove by all possible IDs (real ID, optimistic ID, and the actual paper ID)
        // Also remove by found paper ID to handle any edge cases
        // This ensures the paper is removed even if ID matching is off by one character or has whitespace issues
        const idsToRemove = new Set([actualPaperId, paperId, paperExists!.id])
        if (optimisticId) {
          idsToRemove.add(optimisticId)
        }

        // If we found a paper with a sourceUrl, also remove any other papers with the same sourceUrl
        // (defensive: handles edge cases where multiple papers share the same sourceUrl)
        // We do this in a single pass with the main filter to avoid multiple iterations
        const sourceUrlToMatch = paperExists?.sourceUrl

        // Remove all papers that match any of the IDs we want to remove
        // Single pass: removes by ID AND by sourceUrl match (if applicable)
        const filtered = prev.filter((paper) => {
          // Remove if it matches any of the IDs we want to remove
          if (idsToRemove.has(paper.id)) return false

          // Also remove if it has the same sourceUrl as the deleted paper (defensive)
          // This handles edge cases but should be rare in practice
          if (sourceUrlToMatch && paper.sourceUrl === sourceUrlToMatch) {
            return false
          }

          return true
        })

        // Verify that we actually removed the paper
        if (filtered.length === prev.length && paperExists) {
          // Paper wasn't removed - this is unexpected, log it as a warning
          logger.warn(
            `onPaperDeleted: Failed to remove paper ${paperId} from state. ` +
              `Paper exists with ID: ${paperExists.id}, ` +
              `IDs to remove: ${Array.from(idsToRemove).join(', ')}, ` +
              `prev papers: ${prev.map((p) => `${p.id}(${p.userId})`).join(', ')}, ` +
              `filtered papers: ${filtered.map((p) => `${p.id}(${p.userId})`).join(', ')}`
          )
          // Try a more aggressive removal - remove by found paper ID directly
          const aggressiveFiltered = prev.filter((paper) => paper.id !== paperExists.id)
          if (aggressiveFiltered.length < prev.length) {
            logger.info(`onPaperDeleted: Successfully removed paper ${paperExists.id} using aggressive filter (fallback)`)
            setLastImageVector(getLatestPaperVector(aggressiveFiltered))
            placedPapersRef.current = aggressiveFiltered
            // Clean up mappings
            optimisticPapersByIdRef.current.delete(paperId)
            if (paperExists.sourceUrl) {
              optimisticPapersRef.current.delete(paperExists.sourceUrl)
            }
            if (paperExists.texture) {
              paperExists.texture.dispose()
            }
            pendingDeletionsRef.current.delete(paperId)
            return aggressiveFiltered
          }
          // Still couldn't remove it - this is a bug, but return prev unchanged
          logger.error(
            `onPaperDeleted: CRITICAL - Could not remove paper ${paperId} even with aggressive filter. ` +
              `This indicates a bug in the deletion logic. Paper exists: ${paperExists.id}, ` +
              `prev count: ${prev.length}, filtered count: ${aggressiveFiltered.length}`
          )
          return prev
        }

        setLastImageVector(getLatestPaperVector(filtered))

        // Clean up paper ID mapping
        optimisticPapersByIdRef.current.delete(paperId)
        // Clean up source URL mapping
        if (paperExists.sourceUrl) {
          optimisticPapersRef.current.delete(paperExists.sourceUrl)
        }
        // Clean up any mappings that point to the optimistic ID we found
        if (optimisticId) {
          for (const [mappedPaperId, mappedOptId] of optimisticPapersByIdRef.current.entries()) {
            if (mappedOptId === optimisticId) {
              optimisticPapersByIdRef.current.delete(mappedPaperId)
            }
          }
        }
        // Dispose texture (only if it's not being reused)
        if (paperExists.texture) {
          paperExists.texture.dispose()
        }
        placedPapersRef.current = filtered
        // Clear pending deletion since we've processed it
        pendingDeletionsRef.current.delete(paperId)
        return filtered
      })
    },
    [
      deletionInProgressRef,
      pendingDeletionsRef,
      placedPapersRef,
      optimisticPapersByIdRef,
      userId,
      showToast,
      optimisticallyDeletedPapersRef,
      setPlacedPapers,
      setLastImageVector,
      optimisticPapersRef,
    ]
  )

  const onUserJoined = useCallback(
    (otherUserId: string, otherUsername?: string | null) => {
      // Ignore our own user_joined message (already filtered in useOrbWebSocket)
      if (otherUserId === userId) {
        return
      }

      // During initial connection phase, track users as "seen" but don't show toasts
      if (!initialConnectionCompleteRef.current) {
        seenUsersRef.current.add(otherUserId)
        return
      }

      // After initial connection is complete, only show toast if we haven't seen this user before
      // This prevents duplicate toasts on reconnection
      if (seenUsersRef.current.has(otherUserId)) {
        return
      }

      // Mark as seen and show toast
      seenUsersRef.current.add(otherUserId)

      // Display username if available, otherwise show "Anonymous User"
      const isAnonymous = otherUserId.startsWith('user:anonymous:')
      const displayName =
        otherUsername ||
        (isAnonymous ? 'Anonymous User' : otherUserId.length > 8 ? `...${otherUserId.slice(-8)}` : otherUserId)
      showToast(
        <>
          <strong>{displayName}</strong> joined
        </>,
        'info',
        4000 // Show for 4 seconds
      )
    },
    [userId, initialConnectionCompleteRef, seenUsersRef, showToast]
  )

  const onUserLeft = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_otherUserId: string, _otherUsername?: string | null) => {
      // User left (no special handling needed in OrbScene, but keep signature for consistency)
    },
    []
  )

  const onError = useCallback(
    (error: string) => {
      logger.error('WebSocket error', error)

      // Check if this is a deletion error
      // Only rollback if the error indicates the deletion should be retried (network error, server error)
      // Don't rollback if the paper truly doesn't exist (404) - that means it was already deleted or never existed
      const paperNotFoundMatch = error.match(/Paper\s+([^\s]+)\s+not found/i)
      const authorizationFailedMatch = error.match(/Authorization failed/i)

      if (paperNotFoundMatch) {
        // Paper not found - this means the paper was already deleted or never existed
        const paperId = paperNotFoundMatch[1]

        // Check if we optimistically deleted this paper (still tracking it)
        const optimisticallyDeletedPaper = optimisticallyDeletedPapersRef.current.get(paperId)
        if (optimisticallyDeletedPaper) {
          // Paper was optimistically deleted but server says it doesn't exist
          // This could mean:
          // 1. The paper was already deleted by another user (legitimate - don't rollback)
          // 2. The paper never existed on the server (shouldn't happen, but don't rollback)
          // 3. The paper ID is wrong (bug - don't rollback)
          // In all cases, we should NOT rollback - the paper is already gone
          deletionInProgressRef.current.delete(paperId)
          // Clean up optimistic deletion tracking
          optimisticallyDeletedPapersRef.current.delete(paperId)
          // Dispose texture
          optimisticallyDeletedPaper.texture?.dispose()
          return
        }

        // Paper not found but we're not tracking it optimistically
        // This could mean:
        // 1. The paper was successfully deleted and `onPaperDeleted` already cleaned up tracking
        // 2. The paper was never optimistically deleted (deleted by another user)
        // 3. This is a late/stale error from a duplicate request or server race condition
        // Check if the paper still exists in state to determine which case it is
        setPlacedPapers((prev) => {
          const paperStillExists = prev.find((p) => p.id === paperId)
          if (!paperStillExists) {
            // Paper doesn't exist in state - it was successfully deleted
            // This is likely a late/stale error from a duplicate request or server race condition
            // Since the paper is already gone from state, the deletion was successful
            deletionInProgressRef.current.delete(paperId)
            return prev // Return unchanged - no re-render needed
          } else {
            // Paper still exists in state but server says it doesn't exist
            // This could mean:
            // 1. The paper was deleted by another user (legitimate - remove it from state)
            // 2. There's a desync between client and server (unexpected)
            // Remove it from state to keep client in sync with server
            const filtered = prev.filter((p) => p.id !== paperId)
            setLastImageVector(getLatestPaperVector(filtered))
            // Clean up deletion in progress tracking
            deletionInProgressRef.current.delete(paperId)
            // Clean up optimistic tracking if it exists
            for (const [sourceUrl, optId] of optimisticPapersRef.current.entries()) {
              if (optId === paperId) {
                optimisticPapersRef.current.delete(sourceUrl)
                break
              }
            }
            // Dispose texture
            const removedPaper = prev.find((p) => p.id === paperId)
            removedPaper?.texture?.dispose()
            return filtered
          }
        })
      } else if (authorizationFailedMatch) {
        // Authorization failed - this might be retryable, but it's safer to not rollback
        // as it might indicate a real authorization issue
        logger.warn('Authorization failed - not rolling back deletion (may be legitimate)')
      }
    },
    [
      optimisticallyDeletedPapersRef,
      deletionInProgressRef,
      optimisticPapersRef,
      setPlacedPapers,
      setLastImageVector,
    ]
  )

  const onViewCenterUpdate = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_userId: string, _viewCenter: ViewCenter) => {
      // View center updates not used in OrbScene (presence tracking handled elsewhere)
    },
    []
  )

  return {
    onState,
    onPaperCreated,
    onPaperDeleted,
    onUserJoined,
    onUserLeft,
    onViewCenterUpdate,
    onError,
  }
}
