import * as THREE from 'three'
import { PAPER_LAYER_OFFSET } from '../components/papers/constants'
import type { PlacedPaper } from '../../../types/orb'

export function computeNextLayerOffset(papers: PlacedPaper[]): number {
  if (papers.length === 0) return 0
  const maxOffset = papers.reduce((max, paper) => Math.max(max, paper.layerOffset ?? 0), 0)
  return maxOffset + PAPER_LAYER_OFFSET
}

export function getLatestPaperVector(papers: PlacedPaper[]): THREE.Vector3 | null {
  if (!papers.length) return null
  const latest = [...papers].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[papers.length - 1]
  return latest.center.clone().normalize()
}

export const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

