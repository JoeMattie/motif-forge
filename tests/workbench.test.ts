import { describe, expect, test } from 'vitest'
import type { Motif, PartVariation } from '../src/types'
import {
  buildPartTrees,
  compositeMotif,
  compositeNotes,
  contextMotifForNode,
  partCountOf,
  partNotes,
  pruneIds,
  rebaseHiddenIds,
  selectionFor,
  variationsFromChildren,
  variedPartIndices,
} from '../src/core/workbench'
import { makeMotif, makeNote } from './fixtures'

function makeSource(): Motif {
  return makeMotif({
    id: 'src',
    parts: [
      { name: 'lead', instrument: 'synth' },
      { name: 'bass', instrument: 'synth' },
    ],
    notes: [
      makeNote({ pitch: 60, startBeat: 0, part: 0 }),
      makeNote({ pitch: 64, startBeat: 1, part: 0 }),
      makeNote({ pitch: 48, startBeat: 0, part: 1 }),
      makeNote({ pitch: 43, startBeat: 2, part: 1 }),
    ],
  })
}

function makeVariation(partial: Partial<PartVariation> & Pick<PartVariation, 'id'>): PartVariation {
  return {
    sourceMotifId: 'src',
    partIndex: 0,
    parentNodeId: null,
    notes: [makeNote({ pitch: 62, startBeat: 0, part: 0 })],
    provenance: { kind: 'llm', brief: 'test' },
    selected: false,
    hidden: false,
    createdAt: 1,
    ...partial,
  }
}

const toMap = (vs: PartVariation[]) => new Map(vs.map((v) => [v.id, v]))

describe('partCountOf / partNotes', () => {
  test('partless motifs act as one pseudo-part', () => {
    const m = makeMotif()
    expect(partCountOf(m)).toBe(1)
    expect(partNotes(m, 0)).toHaveLength(4)
  })

  test('splits notes by part with out-of-range clamped to last', () => {
    const src = makeSource()
    expect(partNotes(src, 0).every((n) => (n.part ?? 0) === 0)).toBe(true)
    expect(partNotes(src, 1)).toHaveLength(2)
  })
})

describe('buildPartTrees', () => {
  test('groups roots per part and nests children', () => {
    const src = makeSource()
    const vs = toMap([
      makeVariation({ id: 'a', partIndex: 0 }),
      makeVariation({ id: 'b', partIndex: 0, parentNodeId: 'a', createdAt: 2 }),
      makeVariation({ id: 'c', partIndex: 1 }),
      makeVariation({ id: 'other', sourceMotifId: 'not-src' }),
    ])
    const trees = buildPartTrees(src, vs)
    expect(trees).toHaveLength(2)
    expect(trees[0]).toHaveLength(1)
    expect(trees[0][0].variation.id).toBe('a')
    expect(trees[0][0].children.map((n) => n.variation.id)).toEqual(['b'])
    expect(trees[1].map((n) => n.variation.id)).toEqual(['c'])
  })

  test('orphaned parentNodeId falls back to a root node', () => {
    const src = makeSource()
    const trees = buildPartTrees(src, toMap([makeVariation({ id: 'a', parentNodeId: 'gone' })]))
    expect(trees[0].map((n) => n.variation.id)).toEqual(['a'])
  })
})

describe('composite', () => {
  test('no selection = source notes verbatim', () => {
    const src = makeSource()
    expect(compositeNotes(src, new Map())).toEqual(
      [...src.notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
    )
  })

  test('selected node replaces only its part', () => {
    const src = makeSource()
    const v = makeVariation({ id: 'a', partIndex: 0, selected: true })
    const sel = selectionFor(toMap([v]), 'src')
    expect(variedPartIndices(sel)).toEqual([0])
    const notes = compositeNotes(src, sel)
    expect(notes.filter((n) => (n.part ?? 0) === 0)).toEqual(v.notes)
    expect(notes.filter((n) => (n.part ?? 0) === 1)).toHaveLength(2)
  })

  test('compositeMotif keeps source shape under a new id', () => {
    const src = makeSource()
    const mix = compositeMotif(src, new Map(), 'src::mix')
    expect(mix.id).toBe('src::mix')
    expect(mix.parts).toEqual(src.parts)
    expect(mix.bars).toBe(src.bars)
  })

  test('selected take with a sound override swaps only its part instrument', () => {
    const src = makeSource()
    src.parts[0].preset = {
      oscillator: 'sawtooth',
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
    }
    const v = makeVariation({
      id: 'a',
      partIndex: 0,
      selected: true,
      instrument: 'piano',
      provenance: { kind: 'sound', instrument: 'piano' },
    })
    const mix = compositeMotif(src, selectionFor(toMap([v]), 'src'), 'src::mix')
    // the source part's synth preset must not survive the swap to piano
    expect(mix.parts[0]).toEqual({ name: 'lead', instrument: 'piano' })
    expect(mix.parts[1]).toEqual(src.parts[1])
  })

  test('a synth sound override carries its rolled preset into the mix part', () => {
    const src = makeSource()
    const preset = {
      oscillator: 'square' as const,
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.4, release: 0.6 },
    }
    const v = makeVariation({
      id: 'a',
      partIndex: 1,
      selected: true,
      instrument: 'synth',
      preset,
      provenance: { kind: 'sound', instrument: 'synth' },
    })
    const mix = compositeMotif(src, selectionFor(toMap([v]), 'src'), 'src::mix')
    expect(mix.parts[1]).toEqual({ name: 'bass', instrument: 'synth', preset })
  })
})

describe('contextMotifForNode', () => {
  test('focused node overrides the selection for its own part', () => {
    const src = makeSource()
    const selected = makeVariation({ id: 'sel', partIndex: 0, selected: true })
    const focused = makeVariation({
      id: 'focus',
      partIndex: 0,
      notes: [makeNote({ pitch: 65, startBeat: 0, part: 0 })],
    })
    const sel = selectionFor(toMap([selected]), 'src')
    const ctx = contextMotifForNode(src, sel, 0, focused)
    expect(ctx.notes.filter((n) => (n.part ?? 0) === 0)).toEqual(focused.notes)
  })

  test('origin focus reverts its part to the source', () => {
    const src = makeSource()
    const selected = makeVariation({ id: 'sel', partIndex: 0, selected: true })
    const sel = selectionFor(toMap([selected]), 'src')
    const ctx = contextMotifForNode(src, sel, 0, null)
    expect(ctx.notes.filter((n) => (n.part ?? 0) === 0)).toEqual(partNotes(src, 0))
  })
})

describe('rebase / prune', () => {
  test('rebase keeps ancestor paths of selected nodes, hides the rest', () => {
    const vs = toMap([
      makeVariation({ id: 'a' }),
      makeVariation({ id: 'b', parentNodeId: 'a', selected: true, createdAt: 2 }),
      makeVariation({ id: 'c', parentNodeId: 'a', createdAt: 3 }),
      makeVariation({ id: 'd', partIndex: 1 }), // unselected part: all hidden
    ])
    expect(rebaseHiddenIds(vs, 'src').sort()).toEqual(['c', 'd'])
  })

  test('prune adds already-hidden nodes', () => {
    const vs = toMap([
      makeVariation({ id: 'a', selected: true }),
      makeVariation({ id: 'b', hidden: true, createdAt: 2 }),
    ])
    expect(pruneIds(vs, 'src').sort()).toEqual(['b'])
  })

  test('no selections at all hides everything', () => {
    const vs = toMap([makeVariation({ id: 'a' }), makeVariation({ id: 'b', createdAt: 2 })])
    expect(rebaseHiddenIds(vs, 'src').sort()).toEqual(['a', 'b'])
  })
})

describe('variationsFromChildren', () => {
  test('extracts only the mutated part and drops misshapen children', () => {
    const src = makeSource()
    const good = makeMotif({
      id: 'child-1',
      parts: src.parts,
      notes: [
        makeNote({ pitch: 61, startBeat: 0, part: 0 }),
        makeNote({ pitch: 48, startBeat: 0, part: 1 }),
      ],
    })
    const wrongBars = makeMotif({ id: 'child-2', parts: src.parts, bars: 4 })
    const emptyPart = makeMotif({
      id: 'child-3',
      parts: src.parts,
      notes: [makeNote({ pitch: 48, startBeat: 0, part: 1 })],
    })
    let n = 0
    const vs = variationsFromChildren(
      [good, wrongBars, emptyPart],
      src,
      0,
      null,
      { kind: 'llm', brief: 'b' },
      () => `v${n++}`,
      42,
    )
    expect(vs).toHaveLength(1)
    expect(vs[0]).toMatchObject({
      id: 'v0',
      sourceMotifId: 'src',
      partIndex: 0,
      parentNodeId: null,
      createdAt: 42,
      selected: false,
      hidden: false,
    })
    expect(vs[0].notes).toEqual([makeNote({ pitch: 61, startBeat: 0, part: 0 })])
  })
})
