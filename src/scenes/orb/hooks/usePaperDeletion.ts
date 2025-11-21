import { useCallback } from 'react'
import * as THREE from 'three'
import { createLogger } from '../../../utils/logger'
import { getLatestPaperVector } from '../utils/paper'
import type { PlacedPaper } from '../../../types/orb'

const logger = createLogger('PaperDeletion')

interface UsePaperDeletionOptions {
  placedPapersRef: React.MutableRefObject<PlacedPaper[]>
  setPlacedPapers: React.Dispatch<React.SetStateAction<PlacedPaper[]>>
  setLastImageVector: React.Dispatch<React.SetStateAction<THREE.Vector3 | null>>
  optimisticPapersRef: React.MutableRefObject<Map<string, string>>
  optimisticPapersByIdRef: React.MutableRefObject<Map<string, string>>
  optimisticallyDeletedPapersRef: React.MutableRefObject<Map<string, PlacedPaper | null>>
  optimisticallyDeletedSourceUrlsRef: React.MutableRefObject<Set<string>>
  deletionInProgressRef: React.MutableRefObject<Set<string>>
  sendMessage: (message: unknown, expectResponse: boolean) => Promise<void>
  orbId: string
  onError: (message: string) => void
}

/**
 * Handles paper deletion logic, including optimistic updates and rollback.
 */
export function usePaperDeletion({
  placedPapersRef,
  setPlacedPapers,
  setLastImageVector,
  optimisticPapersRef,
  optimisticPapersByIdRef,
  optimisticallyDeletedPapersRef,
  optimisticallyDeletedSourceUrlsRef,
  deletionInProgressRef,
  sendMessage,
  orbId,
}: UsePaperDeletionOptions) {

  const rollbackPaperDeletion = useCallback(
    (paperId: string) => {
      const deletedPaper = optimisticallyDeletedPapersRef.current.get(paperId)
      // Only rollback if we have the actual paper (not null placeholder from another user's deletion)
      if (deletedPaper && deletedPaper !== null) {
        logger.info(`Rolling back deletion of paper: ${paperId}`)
        optimisticallyDeletedPapersRef.current.delete(paperId)

        // Restore the paper to the UI
        setPlacedPapers((prev) => {
          // Check if paper already exists (avoid duplicates)
          if (prev.find((p) => p.id === paperId)) {
            return prev
          }
          const restored = [...prev, deletedPaper]
          setLastImageVector(getLatestPaperVector(restored))
          placedPapersRef.current = restored
          return restored
        })
      } else {
        logger.info(`Cannot rollback deletion of paper ${paperId} - was deleted by another user or doesn't exist`)
      }
    },
    [
      optimisticallyDeletedPapersRef,
      setPlacedPapers,
      setLastImageVector,
      placedPapersRef,
    ]
  )

  const handleRemove = useCallback(
    (paper: PlacedPaper) => {
      // Prevent duplicate deletion attempts (idempotent)
      // Check if this paper is already being deleted
      if (deletionInProgressRef.current.has(paper.id)) {
        logger.info(`Deletion already in progress for paper: ${paper.id} - ignoring duplicate call`)
        return
      }

      setPlacedPapers((currentPapers) => {
        // Strategy: Always find the paper by ID first (most reliable)
        // If not found and it's an optimistic ID, check the mapping for the real paper
        // Use ref for latest papers to handle race conditions (especially important in production)
        const latestPapers = placedPapersRef.current.length > 0 ? placedPapersRef.current : currentPapers

        let paperToDelete: PlacedPaper | undefined

        // First, try to find by the ID we were given (could be optimistic or real)
        // Check both latestPapers (from ref) and currentPapers (from state) to handle race conditions
        paperToDelete = latestPapers.find((p) => p.id === paper.id) || currentPapers.find((p) => p.id === paper.id)

        // If not found and this looks like an optimistic ID, check if it was replaced
        if (!paperToDelete && paper.id.startsWith('optimistic-')) {
          // Check if this optimistic paper was replaced by a real paper
          for (const [realPaperId, optimisticId] of optimisticPapersByIdRef.current.entries()) {
            if (optimisticId === paper.id) {
              // Found the real paper that replaced this optimistic one
              paperToDelete = latestPapers.find((p) => p.id === realPaperId) || currentPapers.find((p) => p.id === realPaperId)
              if (paperToDelete) {
                logger.info(`Optimistic paper ${paper.id} was replaced by real paper ${realPaperId} - deleting real paper`)
              }
              break
            }
          }
          // Fallback: try matching by sourceUrl (for papers uploaded before this change)
          if (!paperToDelete && paper.sourceUrl) {
            paperToDelete = latestPapers.find(
              (p) => !p.id.startsWith('optimistic-') && p.sourceUrl === paper.sourceUrl
            ) || currentPapers.find(
              (p) => !p.id.startsWith('optimistic-') && p.sourceUrl === paper.sourceUrl
            )
            if (paperToDelete) {
              logger.info(`Optimistic paper not found, found real paper by sourceUrl: ${paperToDelete.id}`)
            }
          }
        }

        // If still not found, try direct lookup by ID in both ref and state (should always work for real papers)
        if (!paperToDelete) {
          paperToDelete = latestPapers.find((p) => p.id === paper.id) || currentPapers.find((p) => p.id === paper.id)
        }

        if (!paperToDelete) {
          logger.warn(
            `Paper not found for deletion: ${paper.id} (optimistic: ${paper.id.startsWith('optimistic-')}) - ` +
            `currentPapers count: ${currentPapers.length}, ` +
            `paper IDs: ${currentPapers.map(p => p.id).join(', ')}`
          )
          return currentPapers
        }

        // Check if deletion is already in progress for this paper (idempotent check)
        const wasAlreadyInProgress =
          deletionInProgressRef.current.has(paperToDelete.id) ||
          (paperToDelete.id !== paper.id && deletionInProgressRef.current.has(paper.id))

        // Mark as deletion in progress (use the actual paper ID, not the requested one)
        deletionInProgressRef.current.add(paperToDelete.id)
        // Also mark the requested ID if different
        if (paperToDelete.id !== paper.id) {
          deletionInProgressRef.current.add(paper.id)
        }

        // Check if this is an optimistic paper
        if (paperToDelete.id.startsWith('optimistic-')) {
          logger.info(`Deleting optimistic paper: ${paperToDelete.id}`)

          // Mark this source URL as optimistically deleted
          optimisticallyDeletedSourceUrlsRef.current.add(paperToDelete.sourceUrl)
          // Remove from optimistic papers tracking
          optimisticPapersRef.current.delete(paperToDelete.sourceUrl)
          // Also clean up paper ID mapping if it exists
          for (const [realPaperId, optimisticId] of optimisticPapersByIdRef.current.entries()) {
            if (optimisticId === paperToDelete.id) {
              optimisticPapersByIdRef.current.delete(realPaperId)
              break
            }
          }

          // Remove optimistic paper immediately from UI
          // Also remove any real paper that replaced it (defensive cleanup)
          const filtered = currentPapers.filter((p) => {
            if (p.id === paperToDelete.id) return false
            // Check if this is the real paper that replaced the optimistic one
            const replacedByThis = optimisticPapersByIdRef.current.get(p.id) === paperToDelete.id
            if (replacedByThis) {
              logger.info(`Also removing real paper that replaced optimistic paper during optimistic deletion: ${p.id}`)
              optimisticPapersByIdRef.current.delete(p.id)
              return false
            }
            // Fallback: check by sourceUrl (for papers uploaded before this change)
            if (
              paperToDelete.sourceUrl &&
              p.sourceUrl === paperToDelete.sourceUrl &&
              !p.id.startsWith('optimistic-')
            ) {
              logger.info(`Also removing real paper with same sourceUrl during optimistic deletion: ${p.id}`)
              return false
            }
            return true
          })
          setLastImageVector(getLatestPaperVector(filtered))
          placedPapersRef.current = filtered
          paperToDelete.texture?.dispose()
          return filtered
        }

        // Real paper - optimistically delete it
        logger.info(`Deleting real paper: ${paperToDelete.id} (requested ID: ${paper.id})`)

        // Also remove any optimistic paper that was replaced by this real paper (defensive cleanup)
        // This handles the case where both papers are in state
        const optimisticIdForThisPaper = optimisticPapersByIdRef.current.get(paperToDelete.id)
        const filtered = currentPapers.filter((p) => {
          // Remove the paper we want to delete
          if (p.id === paperToDelete.id) {
            logger.info(`Filtering out paper to delete: ${p.id}`)
            return false
          }
          // Check if this is the optimistic paper that was replaced by the real paper
          if (optimisticIdForThisPaper && p.id === optimisticIdForThisPaper) {
            logger.info(`Also removing optimistic paper that was replaced by real paper during real deletion: ${p.id}`)
            // Clean up optimistic tracking
            optimisticPapersByIdRef.current.delete(paperToDelete.id)
            optimisticPapersRef.current.delete(p.sourceUrl)
            p.texture?.dispose()
            return false
          }
          // Fallback: check by sourceUrl (for papers uploaded before this change)
          if (paperToDelete.sourceUrl && p.sourceUrl === paperToDelete.sourceUrl && p.id.startsWith('optimistic-')) {
            logger.info(`Also removing optimistic paper with same sourceUrl during real deletion: ${p.id}`)
            // Clean up optimistic tracking
            optimisticPapersRef.current.delete(p.sourceUrl)
            p.texture?.dispose()
            return false
          }
          return true
        })

        logger.info(`After filtering, ${filtered.length} papers remain (was ${currentPapers.length})`)

        // Clean up paper ID mapping
        optimisticPapersByIdRef.current.delete(paperToDelete.id)

        // Save paper for potential rollback
        optimisticallyDeletedPapersRef.current.set(paperToDelete.id, paperToDelete)

        setLastImageVector(getLatestPaperVector(filtered))
        placedPapersRef.current = filtered

        // Send delete request to server (only once, even if handler is called multiple times)
        if (!wasAlreadyInProgress) {
          sendMessage(
            {
              type: 'delete_paper',
              orb_id: orbId,
              paper_id: paperToDelete.id,
            },
            false
          ).catch((error) => {
            logger.error('Failed to send delete paper message', error)
            // Remove from deletion in progress on error so it can be retried
            deletionInProgressRef.current.delete(paperToDelete.id)
            if (paperToDelete.id !== paper.id) {
              deletionInProgressRef.current.delete(paper.id)
            }
            rollbackPaperDeletion(paperToDelete.id)
          })
        } else {
          logger.info(`Delete message already sent for paper: ${paperToDelete.id} - skipping duplicate`)
        }

        return filtered
      })
    },
    [
      deletionInProgressRef,
      setPlacedPapers,
      optimisticPapersByIdRef,
      optimisticPapersRef,
      optimisticallyDeletedPapersRef,
      optimisticallyDeletedSourceUrlsRef,
      setLastImageVector,
      placedPapersRef,
      sendMessage,
      orbId,
      rollbackPaperDeletion,
    ]
  )

  return { handleRemove, rollbackPaperDeletion }
}

