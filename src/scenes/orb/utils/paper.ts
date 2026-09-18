import * as THREE from 'three'
import type { PlacedPaper } from '../../../types/orb'

export function getLatestPaperVector(papers: PlacedPaper[]): THREE.Vector3 | null {
  if (!papers.length) return null
  const latest = [...papers].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[papers.length - 1]
  return latest.center.clone().normalize()
}

export const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

