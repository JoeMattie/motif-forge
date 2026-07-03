import type { Motif } from '../types'
import { parentIdOf } from '../types'

/**
 * A family = a root motif (seed or generated) plus every descendant reachable
 * through lineage. The triage grid shows exactly one card per family — its
 * "face" (the promoted variant, or the root when nothing is promoted).
 * Family-level rating/discard state lives on the face/root:
 *   - rating shown & keyed on a family card applies to the face
 *   - discarding a family card discards the ROOT (variants keep their own flags)
 */
export interface Family {
  rootId: string
  root: Motif
  /** All members in lineage order-ish (root first, then descendants by createdAt). */
  members: Motif[]
  /** Descendants only (members minus root). */
  variants: Motif[]
  /** The promoted take, or the root. This is what the grid shows, plays, exports. */
  face: Motif
  /** Highest rating across non-discarded members. */
  bestRating: number
}

/** Walk lineage up to the root. Missing parents make the motif its own root. */
export function rootIdOf(motif: Motif, motifs: Map<string, Motif>): string {
  let cursor = motif
  for (let guard = 0; guard < 100; guard++) {
    const pid = parentIdOf(cursor)
    if (!pid) return cursor.id
    const parent = motifs.get(pid)
    if (!parent) return cursor.id
    cursor = parent
  }
  return cursor.id
}

/** Group every motif into families, ordered by root createdAt. */
export function buildFamilies(motifs: Map<string, Motif>): Family[] {
  const byRoot = new Map<string, Motif[]>()
  for (const m of motifs.values()) {
    const rid = rootIdOf(m, motifs)
    const list = byRoot.get(rid) ?? []
    list.push(m)
    byRoot.set(rid, list)
  }
  const families: Family[] = []
  for (const [rootId, members] of byRoot) {
    const root = motifs.get(rootId)
    if (!root) continue
    members.sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.createdAt - b.createdAt))
    const variants = members.filter((m) => m.id !== rootId)
    const promoted = members.find((m) => m.promoted && !m.discarded)
    const face = promoted ?? root
    const bestRating = Math.max(0, ...members.filter((m) => !m.discarded).map((m) => m.rating))
    families.push({ rootId, root, members, variants, face, bestRating })
  }
  families.sort((a, b) => a.root.createdAt - b.root.createdAt)
  return families
}

export function familyOf(motif: Motif, motifs: Map<string, Motif>): Family {
  const rid = rootIdOf(motif, motifs)
  const fams = buildFamilies(motifs)
  return fams.find((f) => f.rootId === rid) ?? {
    rootId: rid,
    root: motif,
    members: [motif],
    variants: [],
    face: motif,
    bestRating: motif.rating,
  }
}

/** Short badge describing how a variant came to be (transform / varied parts). */
export function variantBadge(m: Motif): { label: string; kind: 'transform' | 'var'; parts: number[] } {
  if (m.source.kind === 'transform') {
    const t = m.source.transform
    const label = t
      .replace('retrograde-inversion', 'R-INV')
      .replace('augmentation ×2', 'AUG ×2')
      .replace('diminution ×0.5', 'DIM ×.5')
      .replace('retrograde', 'RETRO')
      .replace('inversion', 'INVERT')
      .replace('mode swap → ', 'MODE ')
      .toUpperCase()
    return { label: `TRANSFORM · ${label}`, kind: 'transform', parts: [] }
  }
  if (m.source.kind === 'llm-mutation') {
    const parts = m.source.variedParts ?? []
    if (parts.length > 0 && m.parts.length > 0) {
      const names = parts
        .map((i) => m.parts[i]?.name ?? `P${i}`)
        .map((n) => n.toUpperCase())
        .join('+')
      return { label: `VAR · ${names}`, kind: 'var', parts }
    }
    return { label: 'VAR · LLM', kind: 'var', parts }
  }
  return { label: m.source.kind === 'seed' ? 'SEED' : 'GEN', kind: 'transform', parts: [] }
}
