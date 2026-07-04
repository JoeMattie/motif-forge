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
  applyOp,
  crossover,
  keepersOf,
  melodicLine,
  mutateLine,
  mutateNotes,
  type MutationContext,
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

  it('melodicLine prefers a real lead over a chords bed', () => {
    const m = denseKeeper({
      parts: [
        { name: 'chords', instrument: 'synth' },
        { name: 'lead', instrument: 'synth' },
      ],
      notes: [
        makeNote({ pitch: 50, startBeat: 0, part: 0 }),
        makeNote({ pitch: 53, startBeat: 0, part: 0 }),
        makeNote({ pitch: 57, startBeat: 0, part: 0 }),
        makeNote({ pitch: 62, startBeat: 0, part: 1 }),
        makeNote({ pitch: 64, startBeat: 1, part: 1 }),
        makeNote({ pitch: 65, startBeat: 2, part: 1 }),
      ],
    })
    expect(melodicLine(m).map((n) => n.pitch)).toEqual([62, 64, 65])
  })

  it('melodicLine reduces a chords-only keeper to its top voice per onset', () => {
    const m = denseKeeper({
      parts: [
        { name: 'chords', instrument: 'synth' },
        { name: 'kit', instrument: 'drums' },
      ],
      notes: [
        makeNote({ pitch: 48, startBeat: 0, part: 0 }),
        makeNote({ pitch: 52, startBeat: 0, part: 0 }),
        makeNote({ pitch: 55, startBeat: 0, part: 0 }),
        makeNote({ pitch: 53, startBeat: 2, part: 0 }),
        makeNote({ pitch: 57, startBeat: 2, part: 0 }),
        makeNote({ pitch: 60, startBeat: 2, part: 0 }),
        makeNote({ pitch: 36, startBeat: 0, part: 1 }),
      ],
    })
    const line = melodicLine(m)
    expect(line.map((n) => n.pitch)).toEqual([55, 60])
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

  it('mutants stay valid: ≥3 notes, bounded growth, in-scale, in-bars, deterministic', () => {
    const parent = denseKeeper()
    const totalBeats = parent.bars * 4
    for (let seed = 1; seed <= 40; seed++) {
      const { notes, ops } = mutateLine(parent, mulberry32(seed))
      expect(ops.length).toBeGreaterThanOrEqual(1)
      expect(ops.length).toBeLessThanOrEqual(2)
      // Note counts may drift (repeat-paste, note-rest-toggle) but stay bounded.
      expect(notes.length).toBeGreaterThanOrEqual(3)
      expect(notes.length).toBeLessThanOrEqual(parent.notes.length * 2)
      for (const note of notes) {
        // In-scale parents beget in-scale children, inside the parent's bars.
        expect(isInScale(note.pitch, parent.key, parent.mode)).toBe(true)
        expect(note.startBeat).toBeGreaterThanOrEqual(0)
        expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(totalBeats + 1e-6)
      }
      // Seed-deterministic.
      expect(mutateLine(parent, mulberry32(seed))).toEqual({ notes, ops })
    }
  })

  it('mutateNotes is deterministic per seed and tolerates empty input', () => {
    const parent = denseKeeper()
    const a = mutateNotes(parent.notes, parent, mulberry32(7))
    const b = mutateNotes(parent.notes, parent, mulberry32(7))
    expect(a).toEqual(b)
    expect(mutateNotes([], parent, mulberry32(7))).toEqual({ notes: [], ops: [] })
    // The input is cloned, never edited in place.
    expect(parent.notes).toEqual(denseKeeper().notes)
  })

  it('drum mode never invents pitches — the output kit is a subset of the input kit', () => {
    const ctx = { key: 'D', mode: 'dorian' as const, bars: 2, timeSig: '4/4' }
    const kit = [36, 38, 42, 46] // GM kick/snare/hats — deliberately out-of-scale material
    const notes: Note[] = []
    for (let b = 0; b < 8; b++) notes.push(makeNote({ pitch: kit[b % kit.length], startBeat: b }))
    const DRUM_OPS = [
      'swap-adjacent',
      'alter-rhythm-cell',
      'retrograde-bar',
      'repeat-paste',
      'note-rest-toggle',
    ]
    for (let seed = 1; seed <= 40; seed++) {
      const { notes: out, ops } = mutateNotes(notes, ctx, mulberry32(seed), { drums: true })
      // No sort-run (sorting GM percussion is meaningless) and no degree math.
      expect(ops.every((op) => DRUM_OPS.includes(op))).toBe(true)
      const inputPitches = new Set(notes.map((n) => n.pitch))
      for (const n of out) expect(inputPitches.has(n.pitch)).toBe(true)
      expect(out.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('new mutation ops', () => {
  const ctx: MutationContext = { key: 'D', mode: 'dorian', bars: 4, timeSig: '4/4' }
  const line = () => denseKeeper().notes.map((n) => ({ ...n }))
  const onsets = (ns: Note[]) => ns.map((n) => [n.startBeat, n.durationBeats])
  const multiset = (xs: number[]) => [...xs].sort((a, b) => a - b)

  it('sort-run permutes pitches of one slice monotonically, timings untouched', () => {
    const input = line()
    let sawSorted = 0
    for (let seed = 1; seed <= 30; seed++) {
      const out = applyOp('sort-run', input, ctx, mulberry32(seed))
      // Pure permutation: same onsets/durations, same pitch multiset.
      expect(onsets(out)).toEqual(onsets(input))
      expect(multiset(out.map((n) => n.pitch))).toEqual(multiset(input.map((n) => n.pitch)))
      // Some contiguous slice of 3+ notes is monotone (asc or desc).
      const pitches = out.map((n) => n.pitch)
      for (let start = 0; start + 3 <= pitches.length; start++) {
        for (let len = 3; len <= Math.min(6, pitches.length - start); len++) {
          const slice = pitches.slice(start, start + len)
          const asc = slice.every((p, i) => i === 0 || slice[i - 1] <= p)
          const desc = slice.every((p, i) => i === 0 || slice[i - 1] >= p)
          if (asc || desc) sawSorted++
        }
      }
      // Deterministic per seed.
      expect(applyOp('sort-run', input, ctx, mulberry32(seed))).toEqual(out)
    }
    expect(sawSorted).toBeGreaterThan(0)
    // No-op under 3 notes.
    const tiny = input.slice(0, 2)
    expect(applyOp('sort-run', tiny, ctx, mulberry32(1))).toEqual(tiny)
  })

  it('repeat-paste replaces one bar with another bar’s material, shifted intact', () => {
    // Distinct pitch per bar so source/destination are unambiguous.
    const input: Note[] = []
    const barPitch = [62, 64, 65, 67]
    for (let b = 0; b < 16; b++) {
      input.push(makeNote({ pitch: barPitch[Math.floor(b / 4)], startBeat: b }))
    }
    for (let seed = 1; seed <= 30; seed++) {
      const out = applyOp('repeat-paste', input, ctx, mulberry32(seed))
      expect(out.length).toBe(input.length) // equal-density bars: replace, not overlay
      for (const n of out) {
        expect(n.startBeat).toBeGreaterThanOrEqual(0)
        expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(16 + 1e-6)
      }
      // Exactly one bar changed, and it now duplicates another bar exactly.
      const barsOf = (ns: Note[]) =>
        [0, 1, 2, 3].map((bar) =>
          ns
            .filter((n) => n.startBeat >= bar * 4 && n.startBeat < (bar + 1) * 4)
            .map((n) => [n.startBeat - bar * 4, n.durationBeats, n.pitch]),
        )
      const before = barsOf(input)
      const after = barsOf(out)
      const changed = [0, 1, 2, 3].filter(
        (b) => JSON.stringify(before[b]) !== JSON.stringify(after[b]),
      )
      expect(changed.length).toBe(1)
      const dst = changed[0]
      expect(before.some((src, b) => b !== dst && JSON.stringify(src) === JSON.stringify(after[dst]))).toBe(
        true,
      )
    }
    // Needs ≥2 bars.
    const oneBar = input.slice(0, 4)
    expect(applyOp('repeat-paste', oneBar, { ...ctx, bars: 1 }, mulberry32(1))).toEqual(oneBar)
  })

  it('note-rest-toggle keeps ≥3 notes and never adds simultaneity', () => {
    const voicesAt = (ns: Note[], t: number) =>
      ns.filter((n) => n.startBeat <= t + 1e-6 && n.startBeat + n.durationBeats > t + 1e-6).length
    const input = line()
    for (let seed = 1; seed <= 30; seed++) {
      const out = applyOp('note-rest-toggle', input, ctx, mulberry32(seed))
      expect(out.length).toBeGreaterThanOrEqual(3)
      expect(Math.abs(out.length - input.length)).toBe(1) // one deletion or one split
      // Sampled voice count never exceeds the input's.
      for (let t = 0; t < 16; t += 0.25) {
        expect(voicesAt(out, t)).toBeLessThanOrEqual(voicesAt(input, t))
      }
      expect(applyOp('note-rest-toggle', input, ctx, mulberry32(seed))).toEqual(out)
    }
    // At the 3-note floor with nothing splittable, it is a no-op.
    const floor = [
      makeNote({ pitch: 62, startBeat: 0, durationBeats: 0.25 }),
      makeNote({ pitch: 64, startBeat: 1, durationBeats: 0.25 }),
      makeNote({ pitch: 65, startBeat: 2, durationBeats: 0.25 }),
    ]
    for (let seed = 1; seed <= 10; seed++) {
      expect(applyOp('note-rest-toggle', floor, ctx, mulberry32(seed))).toEqual(floor)
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
    voicing: 'line',
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

  it('returns evolution survivors with keeper ancestry or fresh-walk descent', () => {
    const keepers = [
      denseKeeper({ id: 'k1' }),
      denseKeeper({ id: 'k2', key: 'G', mode: 'mixolydian' }),
      denseKeeper({ id: 'k3', key: 'C', mode: 'ionian' }),
    ]
    const result = generateSymbolicBatch(brief, 10, keepers, 1234)
    expect(result.valid).toHaveLength(10)
    expect(result.droppedCount).toBe(0)
    const ids = new Set(keepers.map((k) => k.id))
    for (const m of result.valid) {
      const s = m.source
      // Every survivor is either keeper-descended ('ga') or fresh-descended ('symbolic').
      expect(['ga', 'symbolic']).toContain(s.kind)
      if (s.kind === 'ga') {
        expect(s.parentIds.length).toBeGreaterThanOrEqual(1)
        expect(s.parentIds.length).toBeLessThanOrEqual(4)
        for (const pid of s.parentIds) expect(ids.has(pid)).toBe(true)
        expect(s.fitness).toBeGreaterThan(0)
      }
      // Fresh-descended survivors conform to the brief; keeper-descended ones
      // inherit their ancestors' key/mode/length (mixed keepers, mixed children).
      if (s.kind === 'symbolic') {
        expect([m.key, m.mode, m.bars, m.timeSig, m.tempo]).toEqual(['D', 'dorian', 4, '4/4', 100])
        expect(s.fitness).toBeGreaterThan(0)
      }
    }
    // The keepers themselves were never edited in place.
    expect(keepers[0].notes).toEqual(denseKeeper({ id: 'k1' }).notes)
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
