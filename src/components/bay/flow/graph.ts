import type { BuiltInEdge, Node } from '@xyflow/react'
import type { Note, PartVariation } from '../../../types'
import type { PartTreeNode } from '../../../core/workbench'
import type { BayFocus } from '../bayTypes'
import { type BayLayout, type PendingTake, originNodeId, pendingNodeId } from './layout'

/**
 * Motif facts → React Flow nodes + edges. Node data carries plain facts only
 * (part, variation, depth, mini, focused, inMix, ghost, advOpen…); callbacks
 * come from BayFlowContext so memoized node components only re-render when
 * their own facts change. Positions and explicit sizes come from layoutBay,
 * so dagre input and rendered size can't drift.
 */

// Node data must be type aliases (not interfaces) so they satisfy React
// Flow's Record<string, unknown> constraint via implicit index signatures.
export type TakeNodeData = {
  part: number
  variation: PartVariation
  /** Generation: 1 = mutation of the origin. Each generation renders smaller. */
  depth: number
  /** Collapsed lane: tiny box with just the mini roll. */
  mini: boolean
  focused: boolean
  inMix: boolean
  ghost: boolean
  /** This node's ADV dropdown is open (controlled by the bay). */
  advOpen: boolean
  isDrums: boolean
  partName: string
  /** A Claude run is in flight on this part — blocks overlapping runs. */
  busy: boolean
}

export type OriginNodeData = {
  part: number
  partName: string
  instrument: string
  isDrums: boolean
  /** Whether the sound dice applies — false for drum parts and partless motifs. */
  canRollSound: boolean
  /** Collapsed lane: the origin shows the take currently in the mix. */
  mini: boolean
  focused: boolean
  /** No selection on this part = the original plays. */
  inMix: boolean
  advOpen: boolean
  busy: boolean
  selectedTake: PartVariation | null
  originNotes: Note[]
}

export type PendingNodeData = {
  mini: boolean
}

export type TakeFlowNode = Node<TakeNodeData, 'take'>
export type OriginFlowNode = Node<OriginNodeData, 'origin'>
export type PendingFlowNode = Node<PendingNodeData, 'pending'>
export type BayFlowNode = TakeFlowNode | OriginFlowNode | PendingFlowNode

export interface PartMeta {
  name: string
  instrument: string
  isDrums: boolean
}

export interface BuildGraphInput {
  parts: PartMeta[]
  trees: PartTreeNode[][]
  layout: BayLayout
  /** The selected variation per part index, if any. */
  selection: Map<number, PartVariation>
  focus: BayFocus
  /** Take whose ADV dropdown is open: null = none; nodeId null = the origin. */
  advanced: BayFocus | null
  showHidden: boolean
  collapsedParts: Set<number>
  pending: PendingTake[]
  /** Whether the source has real parts (partless motifs hide the sound dice). */
  hasParts: boolean
  /** Notes of each part of the source motif. */
  originNotes: Note[][]
}

const STATIC_FLAGS = {
  draggable: false,
  selectable: false,
  connectable: false,
  focusable: false,
} as const

function makeEdge(from: string, to: string, className?: string): BuiltInEdge {
  const edge: BuiltInEdge = {
    id: `e:${from}->${to}`,
    source: from,
    target: to,
    type: 'smoothstep',
    pathOptions: { borderRadius: 4 },
  }
  if (className) edge.className = className
  return edge
}

export function buildFlowGraph(input: BuildGraphInput): {
  nodes: BayFlowNode[]
  edges: BuiltInEdge[]
} {
  const { layout, focus, advanced, selection, pending } = input
  const nodes: BayFlowNode[] = []
  const edges: BuiltInEdge[] = []

  for (let part = 0; part < input.trees.length; part++) {
    const meta = input.parts[part] ?? { name: `part ${part}`, instrument: 'synth', isDrums: false }
    const mini = input.collapsedParts.has(part)
    const busy = pending.some((b) => b.part === part)
    const oid = originNodeId(part)
    const originRect = layout.positions.get(oid)
    if (!originRect) continue

    nodes.push({
      id: oid,
      type: 'origin',
      position: { x: originRect.x, y: originRect.y },
      width: originRect.w,
      height: originRect.h,
      ...STATIC_FLAGS,
      data: {
        part,
        partName: meta.name,
        instrument: meta.instrument,
        isDrums: meta.isDrums,
        canRollSound: input.hasParts && !meta.isDrums,
        mini,
        focused: focus.part === part && focus.nodeId === null,
        inMix: !selection.has(part),
        advOpen: advanced?.part === part && advanced.nodeId === null,
        busy,
        selectedTake: selection.get(part) ?? null,
        originNotes: input.originNotes[part] ?? [],
      },
    })

    const walk = (ns: PartTreeNode[], parentId: string, depth: number) => {
      for (const n of ns) {
        const v = n.variation
        if (!input.showHidden && v.hidden) continue
        const rect = layout.positions.get(v.id)
        if (!rect) continue
        nodes.push({
          id: v.id,
          type: 'take',
          position: { x: rect.x, y: rect.y },
          width: rect.w,
          height: rect.h,
          ...STATIC_FLAGS,
          data: {
            part,
            variation: v,
            depth,
            mini,
            focused: focus.part === part && focus.nodeId === v.id,
            inMix: selection.get(part)?.id === v.id,
            ghost: v.hidden,
            advOpen: advanced?.part === part && advanced.nodeId === v.id,
            isDrums: meta.isDrums,
            partName: meta.name,
            busy,
          },
        })
        edges.push(makeEdge(parentId, v.id, v.hidden ? 'ghost' : undefined))
        walk(n.children, v.id, depth + 1)
      }
    }
    walk(input.trees[part] ?? [], oid, 1)

    for (const p of pending) {
      if (p.part !== part) continue
      const id = pendingNodeId(p.key)
      const rect = layout.positions.get(id)
      if (!rect) continue
      // same fallback rule as the layout: a vanished/hidden parent → origin
      const parent = p.parentNodeId && layout.positions.has(p.parentNodeId) ? p.parentNodeId : oid
      nodes.push({
        id,
        type: 'pending',
        position: { x: rect.x, y: rect.y },
        width: rect.w,
        height: rect.h,
        ...STATIC_FLAGS,
        data: { mini },
      })
      edges.push(makeEdge(parent, id, 'pending'))
    }
  }

  return { nodes, edges }
}
