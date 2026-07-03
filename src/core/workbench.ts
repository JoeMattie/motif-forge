import type { Motif, Note, PartVariation, PartVariationProvenance } from '../types'

/**
 * Pure helpers for the Mutation Bay's per-part variation trees.
 *
 * A bay workspace is scoped to one source motif. Each part ("subtrack") owns
 * a tree of PartVariation nodes — alternative takes on that part only. At most
 * one node per part is `selected`; the composite = selected node's notes per
 * part, falling back to the source's own notes. Everything here is
 * framework-free and unit-tested.
 */

export interface PartTreeNode {
  variation: PartVariation
  children: PartTreeNode[]
}

/** Bay rows are per part; partless motifs get one pseudo-row (partIndex 0). */
export function partCountOf(source: Motif): number {
  return Math.max(1, source.parts.length)
}

const byCreated = (a: PartVariation, b: PartVariation) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id)

/** All variations belonging to `sourceId`, grouped per part as root-level trees. */
export function buildPartTrees(
  source: Motif,
  variations: Map<string, PartVariation>,
): PartTreeNode[][] {
  const mine = [...variations.values()]
    .filter((v) => v.sourceMotifId === source.id)
    .sort(byCreated)
  const trees: PartTreeNode[][] = Array.from({ length: partCountOf(source) }, () => [])
  const nodeById = new Map<string, PartTreeNode>()
  for (const v of mine) nodeById.set(v.id, { variation: v, children: [] })
  for (const v of mine) {
    const node = nodeById.get(v.id)!
    const parent = v.parentNodeId ? nodeById.get(v.parentNodeId) : undefined
    if (parent && parent.variation.partIndex === v.partIndex) {
      parent.children.push(node)
    } else if (v.partIndex < trees.length) {
      trees[v.partIndex].push(node)
    }
  }
  return trees
}

/** The selected variation per part index, if any. */
export function selectionFor(
  variations: Map<string, PartVariation>,
  sourceId: string,
): Map<number, PartVariation> {
  const sel = new Map<number, PartVariation>()
  for (const v of variations.values()) {
    if (v.sourceMotifId === sourceId && v.selected) sel.set(v.partIndex, v)
  }
  return sel
}

/** Notes of one part of a motif (partless motifs: everything is part 0). */
export function partNotes(motif: Motif, partIndex: number): Note[] {
  const last = partCountOf(motif) - 1
  return motif.notes.filter((n) => Math.min(n.part ?? 0, last) === partIndex)
}

const sortNotes = (notes: Note[]) =>
  [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)

/**
 * Merge the composite: per part, the selected node's notes, else the source's.
 * The N-way generalization of the old bay's two-motif stem swap.
 */
export function compositeNotes(source: Motif, selection: Map<number, PartVariation>): Note[] {
  const out: Note[] = []
  for (let p = 0; p < partCountOf(source); p++) {
    const sel = selection.get(p)
    out.push(...(sel ? sel.notes : partNotes(source, p)))
  }
  return sortNotes(out)
}

/**
 * A playable/promotable motif from the current selection. Parts, bars, key,
 * and timeSig come from the source, so engine part-routing stays aligned.
 */
export function compositeMotif(
  source: Motif,
  selection: Map<number, PartVariation>,
  id: string,
): Motif {
  return { ...source, id, notes: compositeNotes(source, selection) }
}

/**
 * The motif sent to the LLM (or transformed) when working on `partIndex`
 * from `node` (null = the original part): the focused node's take on its own
 * part, every other part at its currently selected take — what the user will
 * actually hear the result against.
 */
export function contextMotifForNode(
  source: Motif,
  selection: Map<number, PartVariation>,
  partIndex: number,
  node: PartVariation | null,
): Motif {
  const ctx = new Map(selection)
  if (node) ctx.set(partIndex, node)
  else ctx.delete(partIndex)
  return compositeMotif(source, ctx, source.id)
}

/** Part indices whose selection deviates from the original. */
export function variedPartIndices(selection: Map<number, PartVariation>): number[] {
  return [...selection.keys()].sort((a, b) => a - b)
}

/** Node ids on the path from a variation up to its part root. */
function ancestorPathIds(v: PartVariation, byId: Map<string, PartVariation>): string[] {
  const path: string[] = []
  let cursor: PartVariation | undefined = v
  for (let guard = 0; cursor && guard < 1000; guard++) {
    path.push(cursor.id)
    cursor = cursor.parentNodeId ? byId.get(cursor.parentNodeId) : undefined
  }
  return path
}

/**
 * REBASE: ids to hide — every node of the workspace that is not on a selected
 * node's ancestor path. Parts with no selection hide all their nodes.
 */
export function rebaseHiddenIds(
  variations: Map<string, PartVariation>,
  sourceId: string,
): string[] {
  const mine = [...variations.values()].filter((v) => v.sourceMotifId === sourceId)
  const byId = new Map(mine.map((v) => [v.id, v]))
  const keep = new Set<string>()
  for (const v of mine) {
    if (v.selected) for (const id of ancestorPathIds(v, byId)) keep.add(id)
  }
  return mine.filter((v) => !keep.has(v.id)).map((v) => v.id)
}

/** PRUNE: everything REBASE would hide plus anything already hidden. */
export function pruneIds(variations: Map<string, PartVariation>, sourceId: string): string[] {
  const off = new Set(rebaseHiddenIds(variations, sourceId))
  for (const v of variations.values()) {
    if (v.sourceMotifId === sourceId && v.hidden) off.add(v.id)
  }
  return [...off]
}

/**
 * Extract PartVariation records from full-motif LLM children (mutateBatch
 * returns whole motifs with locked parts round-tripped verbatim). Children
 * whose extracted part is empty or whose shape drifted are dropped.
 */
export function variationsFromChildren(
  children: Motif[],
  source: Motif,
  partIndex: number,
  parentNodeId: string | null,
  provenance: PartVariationProvenance,
  makeId: () => string,
  now: number,
): PartVariation[] {
  const out: PartVariation[] = []
  for (const child of children) {
    if (child.bars !== source.bars) continue
    if (source.parts.length > 0 && child.parts.length !== source.parts.length) continue
    const notes = partNotes(child, partIndex)
    if (notes.length === 0) continue
    out.push({
      id: makeId(),
      sourceMotifId: source.id,
      partIndex,
      parentNodeId,
      notes: sortNotes(notes),
      provenance,
      selected: false,
      hidden: false,
      createdAt: now,
    })
  }
  return out
}
