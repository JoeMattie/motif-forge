import { describe, expect, it } from 'vitest'
import type { GenerationBrief, Motif, Note } from '../src/types'
import { beatsPerBar, isInScale, pitchToDegree } from '../src/core/theory'
import { childSeed, mulberry32 } from '../src/generation/symbolic/prng'
import {
  CONTOURS,
  RHYTHMS,
  randomWalkNotes,
  type WalkParams,
} from '../src/generation/symbolic/walk'
import {
  crossover,
  keepersOf,
  melodicLine,
  mutateLine,
} from '../src/generation/symbolic/genetic'
import {
  generateSymbolicBatch,
  generateSymbolicSurprise,
  populationCounts,
} from '../src/generation/symbolic'
import { makeMotif, makeNote } from './fixtures'

const walkParams = (partial: Partial<WalkParams> = {}): WalkParams => ({
  key: 'D',
  mode: 'dorian',
  bars: 4,
  timeSig: '4/4',
  contour: 'arch',
  rhythm: 'straight',
  ...partial,
})

/** Signature that ignores ids/timestamps so determinism can be compared. */
const essence = (m: Motif) => [m.name, m.key, m.mode, m.bars, m.tempo, m.notes]

/** A keeper with a note on every beat, so crossover windows are never empty. */
function denseKeeper(partial: Partial<Motif> = {}): Motif {
  const bars = partial.bars ?? 4
  const pitches = [62, 64, 65, 67, 69, 67, 65, 64]
  const notes: Note[] = []
  for (let b = 0; b < bars * 4; b++) {
    notes.push(makeNote({ pitch: pitches[b % pitches.length], startBeat: b }))
  }
  return makeMotif({ id: 'keeper', key: 'D', mode: 'dorian', bars, notes, rating: 4, ...partial })
}

describe('random walk', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const p = walkParams()
    const a = randomWalkNotes(p, mulberry32(42))
    const b = randomWalkNotes(p, mulberry32(42))
    const c = randomWalkNotes(p, mulberry32(43))
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c))
  })

  it('stays in-scale for every contour × rhythm combination', () => {
    for (const contour of CONTOURS) {
      for (const rhythm of RHYTHMS) {
        for (let seed = 1; seed <= 5; seed++) {
          const p = walkParams({ contour, rhythm, key: 'Eb', mode: 'aeolian' })
          for (const n of randomWalkNotes(p, mulberry32(seed))) {
            expect(isInScale(n.pitch, p.key, p.mode)).toBe(true)
          }
        }
      }
    }
  })

  it('fits the requested length with enough notes in a sane register', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const bars of [2, 4, 8]) {
        const p = walkParams({ bars, rhythm: 'sparse' })
        const notes = randomWalkNotes(p, mulberry32(seed))
        const total = bars * beatsPerBar(p.timeSig)
        expect(notes.length).toBeGreaterThanOrEqual(3)
        for (const n of notes) {
          expect(n.startBeat).toBeGreaterThanOrEqual(0)
          expect(n.durationBeats).toBeGreaterThan(0)
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(total + 1e-6)
          expect(n.pitch).toBeGreaterThanOrEqual(53)
          expect(n.pitch).toBeLessThanOrEqual(86)
          expect(n.velocity).toBeGreaterThanOrEqual(1)
          expect(n.velocity).toBeLessThanOrEqual(127)
        }
        // The phrase reaches its final bar rather than stopping short.
        const last = notes[notes.length - 1]
        expect(last.startBeat + last.durationBeats).toBeGreaterThan(total - beatsPerBar(p.timeSig))
      }
    }
  })

  it('recovers from every leap with a step in the opposite direction', () => {
    const degIdx = (pitch: number, p: WalkParams) => {
      const pos = pitchToDegree(pitch, p.key, p.mode)
      expect(pos.chromaticOffset).toBe(0)
      return pos.octave * 7 + pos.degree
    }
    for (const contour of CONTOURS) {
      for (let seed = 1; seed <= 30; seed++) {
        const p = walkParams({ contour, rhythm: 'straight' })
        const idx = randomWalkNotes(p, mulberry32(seed)).map((n) => degIdx(n.pitch, p))
        for (let i = 2; i < idx.length; i++) {
          const prev = idx[i - 1] - idx[i - 2]
          if (Math.abs(prev) > 2) {
            expect(idx[i] - idx[i - 1]).toBe(-Math.sign(prev))
          }
        }
      }
    }
  })
})

describe('genetic operators', () => {
  it('keepersOf keeps rated, non-discarded motifs only', () => {
    const keep = denseKeeper({ id: 'a', rating: 3 })
    const low = denseKeeper({ id: 'b', rating: 2 })
    const gone = denseKeeper({ id: 'c', rating: 5, discarded: true })
    expect(keepersOf([keep, low, gone]).map((m) => m.id)).toEqual(['a'])
  })

  it('melodicLine takes the first non-drum part and strips part indices', () => {
    const m = denseKeeper({
      parts: [
        { name: 'kit', instrument: 'drums' },
        { name: 'lead', instrument: 'synth' },
      ],
      notes: [
        makeNote({ pitch: 36, startBeat: 0, part: 0 }),
        makeNote({ pitch: 62, startBeat: 0, part: 1 }),
        makeNote({ pitch: 64, startBeat: 1, part: 1 }),
        makeNote({ pitch: 65, startBeat: 2, part: 1 }),
      ],
    })
    const line = melodicLine(m)
    expect(line.map((n) => n.pitch)).toEqual([62, 64, 65])
    expect(line.every((n) => n.part === undefined)).toBe(true)
  })

  it('crossover children splice head-of-A with re-spelled tail-of-B, in A’s scale', () => {
    const a = denseKeeper({ id: 'A', key: 'D', mode: 'dorian' })
    const b = denseKeeper({ id: 'B', key: 'G', mode: 'mixolydian' })
    for (let seed = 1; seed <= 10; seed++) {
      const res = crossover(a, b, mulberry32(seed))
      expect(res).not.toBeNull()
      const { notes, cutBar } = res!
      const cut = cutBar * 4
      expect(cutBar).toBeGreaterThanOrEqual(1)
      expect(cutBar).toBeLessThan(a.bars)
      const head = notes.filter((n) => n.startBeat < cut)
      const tail = notes.filter((n) => n.startBeat >= cut)
      expect(head.length).toBeGreaterThan(0)
      expect(tail.length).toBeGreaterThan(0)
      // Head notes are A's own material, verbatim.
      for (const n of head) {
        expect(a.notes.some((an) => an.startBeat === n.startBeat && an.pitch === n.pitch)).toBe(true)
      }
      // Everything (including B's re-spelled tail) lands in A's key/mode.
      for (const n of notes) expect(isInScale(n.pitch, a.key, a.mode)).toBe(true)
      // And inside A's length.
      for (const n of notes) expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(16 + 1e-6)
    }
  })

  it('mutants keep the parent’s note count and most of its material', () => {
    const parent = denseKeeper()
    const shared = (xs: number[], ys: number[]) => {
      const pool = [...ys]
      let count = 0
      for (const x of xs) {
        const at = pool.indexOf(x)
        if (at >= 0) {
          pool.splice(at, 1)
          count++
        }
      }
      return count
    }
    for (let seed = 1; seed <= 40; seed++) {
      const { notes, ops } = mutateLine(parent, mulberry32(seed))
      expect(ops.length).toBeGreaterThanOrEqual(1)
      expect(ops.length).toBeLessThanOrEqual(2)
      expect(notes.length).toBe(parent.notes.length)
      const n = parent.notes.length
      // Each op perturbs one dimension; at least one dimension survives nearly intact.
      const best = Math.max(
        shared(notes.map((x) => x.pitch), parent.notes.map((x) => x.pitch)),
        shared(notes.map((x) => x.startBeat), parent.notes.map((x) => x.startBeat)),
        shared(notes.map((x) => x.durationBeats), parent.notes.map((x) => x.durationBeats)),
      )
      expect(best).toBeGreaterThanOrEqual(n - 1)
      // In-scale parents beget in-scale children.
      for (const note of notes) expect(isInScale(note.pitch, parent.key, parent.mode)).toBe(true)
    }
  })
})

describe('population step', () => {
  const brief: GenerationBrief = {
    key: 'D',
    mode: 'dorian',
    tempo: 100,
    bars: 4,
    timeSig: '4/4',
    concept: '',
    text: '',
    allowChromatic: false,
    texture: 'lead',
    includeRhythm: false,
    extraInstruments: false,
  }

  it('applies the ratio constants with a fresh-immigrant diversity floor', () => {
    expect(populationCounts(10, 0)).toEqual({ crossover: 0, mutant: 0, fresh: 10 })
    expect(populationCounts(10, 1)).toEqual({ crossover: 0, mutant: 4, fresh: 6 })
    expect(populationCounts(10, 5)).toEqual({ crossover: 3, mutant: 4, fresh: 3 })
    for (let n = 1; n <= 25; n++) {
      for (const k of [0, 1, 2, 7]) {
        const c = populationCounts(n, k)
        expect(c.crossover + c.mutant + c.fresh).toBe(n)
        expect(c.fresh).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('mixes crossovers, mutants, and fresh walks when keepers exist', () => {
    const keepers = [
      denseKeeper({ id: 'k1' }),
      denseKeeper({ id: 'k2', key: 'G', mode: 'mixolydian' }),
      denseKeeper({ id: 'k3', key: 'C', mode: 'ionian' }),
    ]
    const result = generateSymbolicBatch(brief, 10, keepers, 1234)
    expect(result.valid).toHaveLength(10)
    expect(result.droppedCount).toBe(0)
    const sources = result.valid.map((m) => m.source)
    const crossovers = sources.filter((s) => s.kind === 'ga' && s.parentIds.length === 2)
    const mutants = sources.filter((s) => s.kind === 'ga' && s.parentIds.length === 1)
    const fresh = sources.filter((s) => s.kind === 'symbolic')
    expect(crossovers).toHaveLength(3)
    expect(mutants).toHaveLength(4)
    expect(fresh).toHaveLength(3)
    // GA children point at real keepers; fresh walks conform to the brief.
    const ids = new Set(keepers.map((k) => k.id))
    for (const s of [...crossovers, ...mutants]) {
      if (s.kind === 'ga') for (const pid of s.parentIds) expect(ids.has(pid)).toBe(true)
    }
    for (const m of result.valid.filter((m) => m.source.kind === 'symbolic')) {
      expect([m.key, m.mode, m.bars, m.timeSig, m.tempo]).toEqual(['D', 'dorian', 4, '4/4', 100])
    }
  })

  it('is deterministic given the same seed and keepers', () => {
    const keepers = [denseKeeper({ id: 'k1' }), denseKeeper({ id: 'k2', key: 'A' })]
    const a = generateSymbolicBatch(brief, 8, keepers, 99)
    const b = generateSymbolicBatch(brief, 8, keepers, 99)
    const c = generateSymbolicBatch(brief, 8, keepers, 100)
    expect(a.valid.map(essence)).toEqual(b.valid.map(essence))
    expect(JSON.stringify(a.valid.map(essence))).not.toEqual(JSON.stringify(c.valid.map(essence)))
  })

  it('generates a full batch of valid motifs with no keepers', () => {
    const result = generateSymbolicBatch(brief, 100, [], 7)
    expect(result.valid).toHaveLength(100)
    for (const m of result.valid) {
      expect(m.notes.length).toBeGreaterThanOrEqual(3)
      expect(m.source.kind).toBe('symbolic')
      expect(m.scaleWarning).toBe(false)
    }
  })

  it('surprise batches roll their own key/mode/tempo/bars deterministically', () => {
    const a = generateSymbolicSurprise(5, 55)
    const b = generateSymbolicSurprise(5, 55)
    expect(a.valid.map(essence)).toEqual(b.valid.map(essence))
    for (const m of a.valid) {
      expect([2, 4, 8]).toContain(m.bars)
      expect(m.tempo).toBeGreaterThanOrEqual(70)
      expect(m.tempo).toBeLessThanOrEqual(170)
      for (const n of m.notes) expect(isInScale(n.pitch, m.key, m.mode)).toBe(true)
    }
  })

  it('per-motif seeds derive independently from the batch seed', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 100; i++) seen.add(childSeed(42, i))
    expect(seen.size).toBe(100)
  })
})
