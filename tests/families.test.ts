import { describe, expect, it } from 'vitest'
import type { Motif } from '../src/types'
import { buildFamilies, rootIdOf, variantBadge } from '../src/core/families'
import { lockedPartsRoundTrip } from '../src/core/validate'
import { applyTransform } from '../src/core/transforms'
import { makeMotif, makeNote } from './fixtures'

function toMap(motifs: Motif[]): Map<string, Motif> {
  return new Map(motifs.map((m) => [m.id, m]))
}

const root = makeMotif({ id: 'root', createdAt: 1 })
const child = makeMotif({
  id: 'child',
  createdAt: 2,
  source: { kind: 'transform', parentId: 'root', transform: 'inversion' },
})
const grandchild = makeMotif({
  id: 'grandchild',
  createdAt: 3,
  source: { kind: 'llm-mutation', parentId: 'child', brief: 'darker' },
})
const loner = makeMotif({ id: 'loner', createdAt: 4 })

describe('rootIdOf', () => {
  it('walks lineage up to the root', () => {
    const map = toMap([root, child, grandchild])
    expect(rootIdOf(grandchild, map)).toBe('root')
    expect(rootIdOf(child, map)).toBe('root')
    expect(rootIdOf(root, map)).toBe('root')
  })

  it('treats motifs with missing parents as their own root', () => {
    const map = toMap([grandchild])
    expect(rootIdOf(grandchild, map)).toBe('grandchild')
  })
})

describe('buildFamilies', () => {
  it('groups root + descendants into one family', () => {
    const families = buildFamilies(toMap([root, child, grandchild, loner]))
    expect(families).toHaveLength(2)
    const fam = families.find((f) => f.rootId === 'root')!
    expect(fam.members.map((m) => m.id)).toEqual(['root', 'child', 'grandchild'])
    expect(fam.variants.map((m) => m.id)).toEqual(['child', 'grandchild'])
  })

  it('the face is the root by default and the promoted member when set', () => {
    const promoted = { ...child, promoted: true }
    const families = buildFamilies(toMap([root, promoted, grandchild]))
    expect(families[0].face.id).toBe('child')

    const noPromote = buildFamilies(toMap([root, child, grandchild]))
    expect(noPromote[0].face.id).toBe('root')
  })

  it('a discarded promoted variant falls back to the root face', () => {
    const promoted = { ...child, promoted: true, discarded: true }
    const families = buildFamilies(toMap([root, promoted]))
    expect(families[0].face.id).toBe('root')
  })

  it('bestRating ignores discarded members', () => {
    const rated = { ...child, rating: 5 as const, discarded: true }
    const families = buildFamilies(toMap([root, rated]))
    expect(families[0].bestRating).toBe(3) // root's rating
  })
})

describe('variantBadge', () => {
  it('labels deterministic transforms', () => {
    expect(variantBadge(child)).toMatchObject({ kind: 'transform' })
    expect(variantBadge(child).label).toContain('INVERT')
  })

  it('labels LLM variants with their varied parts', () => {
    const m = makeMotif({
      parts: [
        { name: 'lead', instrument: 'epiano' },
        { name: 'harmony', instrument: 'strings' },
      ],
      source: { kind: 'llm-mutation', parentId: 'root', brief: 'x', variedParts: [1] },
    })
    expect(variantBadge(m)).toMatchObject({ kind: 'var', parts: [1] })
    expect(variantBadge(m).label).toBe('VAR · HARMONY')
  })
})

describe('lockedPartsRoundTrip', () => {
  const parts = [
    { name: 'lead', instrument: 'epiano' as const },
    { name: 'bass', instrument: 'synth' as const },
  ]
  const parent = makeMotif({
    parts,
    notes: [
      makeNote({ pitch: 60, startBeat: 0, part: 0 }),
      makeNote({ pitch: 64, startBeat: 1, part: 0 }),
      makeNote({ pitch: 67, startBeat: 2, part: 0 }),
      makeNote({ pitch: 48, startBeat: 0, durationBeats: 4, part: 1 }),
    ],
  })

  it('passes when the locked part is copied verbatim', () => {
    const kid = makeMotif({
      parts,
      notes: [
        makeNote({ pitch: 62, startBeat: 0.5, part: 0 }),
        makeNote({ pitch: 65, startBeat: 1, part: 0 }),
        makeNote({ pitch: 69, startBeat: 2, part: 0 }),
        makeNote({ pitch: 48, startBeat: 0, durationBeats: 4, part: 1 }),
      ],
    })
    expect(lockedPartsRoundTrip(parent, kid, [1])).toBe(true)
  })

  it('fails when a locked note is re-pitched, retimed, or dropped', () => {
    const repitched = makeMotif({
      parts,
      notes: [...parent.notes.slice(0, 3), makeNote({ pitch: 50, startBeat: 0, durationBeats: 4, part: 1 })],
    })
    expect(lockedPartsRoundTrip(parent, repitched, [1])).toBe(false)

    const dropped = makeMotif({ parts, notes: parent.notes.slice(0, 3) })
    expect(lockedPartsRoundTrip(parent, dropped, [1])).toBe(false)
  })
})

describe('applyTransform part scoping', () => {
  const parts = [
    { name: 'lead', instrument: 'epiano' as const },
    { name: 'bass', instrument: 'synth' as const },
  ]
  const parent = makeMotif({
    parts,
    notes: [
      makeNote({ pitch: 60, startBeat: 0, part: 0 }),
      makeNote({ pitch: 64, startBeat: 1, part: 0 }),
      makeNote({ pitch: 67, startBeat: 2, part: 0 }),
      makeNote({ pitch: 48, startBeat: 0, durationBeats: 4, part: 1 }),
    ],
  })

  it('transposes only the scoped part; locked notes pass through verbatim', () => {
    const out = applyTransform(parent, { type: 'transpose', semitones: 2 }, { parts: new Set([0]) })
    const lead = out.notes.filter((n) => n.part === 0).map((n) => n.pitch)
    const bass = out.notes.filter((n) => n.part === 1).map((n) => n.pitch)
    expect(lead).toEqual([62, 66, 69])
    expect(bass).toEqual([48])
  })

  it('without a scope every part is transformed (existing behavior)', () => {
    const out = applyTransform(parent, { type: 'transpose', semitones: 2 })
    expect(out.notes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([50, 62, 66, 69])
  })
})
