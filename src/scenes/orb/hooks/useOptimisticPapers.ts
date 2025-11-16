import { useRef } from 'react'
import type { PlacedPaper } from '../../../types/orb'

/**
 * Manages optimistic paper tracking for UI updates.
 * Tracks mappings between optimistic papers and server papers,
 * handles rollback scenarios, and prevents duplicate processing.
 */
export function useOptimisticPapers() {
  // Track optimistic papers by source URL so we can replace them when the real paper arrives
  const optimisticPapersRef = useRef<Map<string, string>>(new Map()) // sourceUrl -> optimistic paper ID
  
  // Track optimistic papers by paper ID (from API response) for matching WebSocket messages
  const optimisticPapersByIdRef = useRef<Map<string, string>>(new Map()) // paperId -> optimistic paper ID
  
  // Track optimistically deleted papers so we can rollback on error
  const optimisticallyDeletedPapersRef = useRef<Map<string, PlacedPaper | null>>(new Map()) // paperId -> paper (for rollback) or null (placeholder for deletions by other users)
  
  // Track optimistically deleted source URLs (papers that were deleted before server confirmed creation)
  const optimisticallyDeletedSourceUrlsRef = useRef<Set<string>>(new Set()) // sourceUrl -> true (for tracking)
  
  // Track papers currently being deleted to prevent duplicate deletion calls
  const deletionInProgressRef = useRef<Set<string>>(new Set()) // paperId -> true (for tracking)
  
  // Track papers currently being processed to prevent duplicate processing of the same message
  const processingPapersRef = useRef<Set<string>>(new Set()) // paperId -> true (for tracking)
  
  // Track papers that were deleted before they were created in the frontend (late deletions)
  // This prevents papers from appearing after they've been deleted
  const pendingDeletionsRef = useRef<Set<string>>(new Set()) // paperId -> true (for tracking deletions that arrived before paper_created)

  return {
    optimisticPapersRef,
    optimisticPapersByIdRef,
    optimisticallyDeletedPapersRef,
    optimisticallyDeletedSourceUrlsRef,
    deletionInProgressRef,
    processingPapersRef,
    pendingDeletionsRef,
  }
}

