import dagre from '@dagrejs/dagre'
import type { PartTreeNode } from '../../../core/workbench'

/**
 * Pure auto-layout for the bay's shared React Flow canvas — no React in here
 * so it unit-tests in a plain node environment.
 *
 * One dagre graph per part (`rankdir: 'LR'`): no cross-part edges exist, so
 * per-part graphs keep every origin cell at rank 0 / x = 0. Lanes are then
 * stacked by a running vertical offset. Node sizes are the single source of
 * truth mirroring the CSS card widths (styles.css bay section) — React Flow
 * nodes get the same explicit width/height, so dagre input and rendered size
 * can't drift.
 */

export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

/** An in-flight Claude batch, rendered as a dashed placeholder node. */
export interface PendingTake {
  key: string
  part: number
  parentNodeId: string | null
}

export interface BayLayoutInput {
  trees: PartTreeNode[][]
  showHidden: boolean
  collapsedParts: Set<number>
  pending: PendingTake[]
}

export interface BayLayout {
  /** Top-left React Flow coordinates + explicit size, keyed by node id. */
  positions: Map<string, NodeRect>
  /** Bottom y of each part lane (lane i spans from the previous bottom + gap). */
  laneBottoms: number[]
}

// Sizes mirror the CSS cards (.origin-cell / .tree-node depth tiers).
export const ORIGIN_SIZE = { w: 230, h: 124 } as const
export const ORIGIN_MINI_SIZE = { w: 172, h: 92 } as const
const TAKE_SIZES = [
  { w: 176, h: 100 }, // depth 1
  { w: 162, h: 88 }, // depth 2
  { w: 154, h: 78 }, // depth 3+
] as const
export const TAKE_MINI_SIZE = { w: 84, h: 34 } as const
export const PENDING_SIZE = { w: 176, h: 84 } as const
export const PENDING_MINI_SIZE = { w: 84, h: 34 } as const

/** Vertical gap between part lanes. */
export const LANE_GAP = 28
/** Horizontal gap between generations (dagre ranks). */
export const RANKSEP = 40
/** Vertical gap between siblings inside a lane. */
export const NODESEP = 12

export function takeSize(depth: number, mini: boolean): { w: number; h: number } {
  if (mini) return TAKE_MINI_SIZE
  return TAKE_SIZES[Math.min(Math.max(depth, 1), TAKE_SIZES.length) - 1]
}

export const originNodeId = (part: number) => `origin:${part}`
export const pendingNodeId = (key: string) => `pending:${key}`

export function layoutBay({ trees, showHidden, collapsedParts, pending }: BayLayoutInput): BayLayout {
  const positions = new Map<string, NodeRect>()
  const laneBottoms: number[] = []
  let offsetY = 0

  for (let part = 0; part < trees.length; part++) {
    const mini = collapsedParts.has(part)
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'LR', ranksep: RANKSEP, nodesep: NODESEP, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))

    const origin = originNodeId(part)
    const originSize = mini ? ORIGIN_MINI_SIZE : ORIGIN_SIZE
    g.setNode(origin, { width: originSize.w, height: originSize.h })

    // Visibility matches the keyboard walk: a hidden node prunes its whole
    // subtree unless SHOW HIDDEN is on.
    const visible = new Set<string>()
    const walk = (nodes: PartTreeNode[], parentId: string, depth: number) => {
      for (const n of nodes) {
        if (!showHidden && n.variation.hidden) continue
        const size = takeSize(depth, mini)
        g.setNode(n.variation.id, { width: size.w, height: size.h })
        g.setEdge(parentId, n.variation.id)
        visible.add(n.variation.id)
        walk(n.children, n.variation.id, depth + 1)
      }
    }
    walk(trees[part] ?? [], origin, 1)

    // Pending placeholders hang under their parent take (origin when the
    // parent isn't visible, e.g. rebased away mid-flight).
    const pendingSize = mini ? PENDING_MINI_SIZE : PENDING_SIZE
    for (const p of pending) {
      if (p.part !== part) continue
      const parent = p.parentNodeId && visible.has(p.parentNodeId) ? p.parentNodeId : origin
      const id = pendingNodeId(p.key)
      g.setNode(id, { width: pendingSize.w, height: pendingSize.h })
      g.setEdge(parent, id)
    }

    dagre.layout(g)

    // Dagre yields centers; convert to top-left and pin the lane to x=0 /
    // this lane's vertical band.
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    for (const id of g.nodes()) {
      const n = g.node(id)
      minX = Math.min(minX, n.x - n.width / 2)
      minY = Math.min(minY, n.y - n.height / 2)
    }
    let bottom = offsetY
    for (const id of g.nodes()) {
      const n = g.node(id)
      const rect: NodeRect = {
        x: n.x - n.width / 2 - minX,
        y: n.y - n.height / 2 - minY + offsetY,
        w: n.width,
        h: n.height,
      }
      positions.set(id, rect)
      bottom = Math.max(bottom, rect.y + rect.h)
    }
    laneBottoms.push(bottom)
    offsetY = bottom + LANE_GAP
  }

  return { positions, laneBottoms }
}
