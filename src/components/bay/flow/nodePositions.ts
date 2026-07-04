/**
 * Hand-dragged node positions on the bay canvas — an override layer on top of
 * the dagre auto-layout, keyed by source motif id then node id. Pure
 * localStorage plumbing (no React, no React Flow) so it stays unit-testable.
 * Nodes never dragged keep their dagre slot; ids that stop existing (pruned
 * takes) are pruned by the caller before saving.
 */

export type BayNodePositions = Record<string, { x: number; y: number }>

const STORAGE_KEY = 'motif-forge:bay-node-positions'

function loadAll(): Record<string, BayNodePositions> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, BayNodePositions>) : {}
  } catch {
    return {}
  }
}

export function loadBayPositions(sourceId: string): BayNodePositions {
  const map = loadAll()[sourceId]
  if (!map || typeof map !== 'object') return {}
  const out: BayNodePositions = {}
  for (const [id, p] of Object.entries(map)) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[id] = { x: p.x, y: p.y }
  }
  return out
}

export function saveBayPositions(sourceId: string, positions: BayNodePositions): void {
  try {
    const all = loadAll()
    if (Object.keys(positions).length === 0) delete all[sourceId]
    else all[sourceId] = positions
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // storage full/unavailable — dragged positions just won't survive a reload
  }
}
