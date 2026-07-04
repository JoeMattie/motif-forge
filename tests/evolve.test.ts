import { describe, expect, it } from 'vitest'
import type { GenerationBrief, Motif, Note } from '../src/types'
import { beatsPerBar, isInScale } from '../src/core/theory'
import { mulberry32 } from '../src/generation/symbolic/prng'
import {
  EVOLVE_DEFAULTS,
  type EvolveContext,
  type EvolveTuning,
  evolvePopulation,
} from '../src/generation/symbolic/evolve'
import { similarity } from '../src/generation/symbolic/fitness'
import { moodRange, moodTargets } from '../src/generation/symbolic/mood'
import { generateSymbolicBatch } from '../src/generation/symbolic'
import { makeMotif, makeNote } from './fixtures'

const brief = (partial: Partial<GenerationBrief> = {}): GenerationBrief => ({
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
  ...partial,
})

const ctx: EvolveContext = { key: 'D', mode: 'dorian', bars: 4, timeSig: '4/4', tempo: 100 }

function denseKeeper(partial: Partial<Motif> = {}): Motif {
  const bars = partial.bars ?? 4
  const pitches = [62, 64, 65, 67, 69, 67, 65, 64]
  const notes: Note[] = []
  for (let b = 0; b < bars * 4; b++) {
    notes.push(makeNote({ pitch: pitches[b % pitches.length], startBeat: b }))
  }
  return makeMotif({ id: 'keeper', key: 'D', mode: 'dorian', bars, notes, rating: 4, ...partial })
}

/** Signature that ignores ids/timestamps so determinism can be compared. */
const essence = (m: Motif) => [m.name, m.key, m.mode, m.bars, m.tempo, m.notes, m.parts]

describe('evolvePopulation', () => {
  it('elitism keeps the best fitness from dropping across generations', () => {
    for (const keepers of [[], [denseKeeper()], [denseKeeper(), denseKeeper({ id: 'k2', key: 'G' })]]) {
      for (let seed = 1; seed <= 5; seed++) {
        const { initialBest, finalBest } = evolvePopulation(ctx, keepers, 5, mulberry32(seed))
        expect(finalBest).toBeGreaterThanOrEqual(initialBest - 1e-6)
      }
    }
  })

  it('returns exactly n mutually-distinct survivors', () => {
    for (const n of [1, 5, 8]) {
      for (const keepers of [[], [denseKeeper()], [denseKeeper(), denseKeeper({ id: 'k2' }), denseKeeper({ id: 'k3' })]]) {
        const { picked } = evolvePopulation(ctx, keepers, n, mulberry32(42))
        expect(picked).toHaveLength(n)
        for (let i = 0; i < picked.length; i++) {
          for (let j = i + 1; j < picked.length; j++) {
            expect(similarity(picked[i].notes, picked[j].notes)).toBeLessThanOrEqual(
              EVOLVE_DEFAULTS.dedupThreshold,
            )
          }
        }
      }
    }
  })

  it('mood-tuned + progression runs still return n distinct valid survivors', () => {
    const mood = { valence: -0.5, arousal: 1 }
    const tuning: EvolveTuning = {
      targets: moodTargets(mood),
      range: moodRange(mood),
      contourWeights: { descend: 3, arch: 1 },
      rhythmWeights: { syncopated: 2, straight: 1 },
    }
    const tunedCtx: EvolveContext = { ...ctx, progression: [0, 5, 3, 4] }
    const keepers = [denseKeeper(), denseKeeper({ id: 'k2', key: 'G' })]
    for (let seed = 1; seed <= 3; seed++) {
      const { picked } = evolvePopulation(tunedCtx, keepers, 6, mulberry32(seed), EVOLVE_DEFAULTS, tuning)
      expect(picked).toHaveLength(6)
      for (let i = 0; i < picked.length; i++) {
        expect(picked[i].notes.length).toBeGreaterThanOrEqual(3)
        for (const n of picked[i].notes) {
          expect(isInScale(n.pitch, picked[i].ctx.key, picked[i].ctx.mode)).toBe(true)
          expect(n.pitch).toBeGreaterThanOrEqual(36)
          expect(n.pitch).toBeLessThanOrEqual(96)
        }
        for (let j = i + 1; j < picked.length; j++) {
          expect(similarity(picked[i].notes, picked[j].notes)).toBeLessThanOrEqual(
            EVOLVE_DEFAULTS.dedupThreshold,
          )
        }
      }
    }
  })

  it('an empty tuning reproduces the untuned run exactly', () => {
    const a = evolvePopulation(ctx, [denseKeeper()], 5, mulberry32(21))
    const b = evolvePopulation(ctx, [denseKeeper()], 5, mulberry32(21), EVOLVE_DEFAULTS, {})
    expect(b.picked.map((i) => i.notes)).toEqual(a.picked.map((i) => i.notes))
    expect(b.finalBest).toBe(a.finalBest)
  })

  it('keeper ancestry survives crossover and mutation generations', () => {
    const keepers = [denseKeeper({ id: 'k1' }), denseKeeper({ id: 'k2', key: 'A' })]
    const { picked } = evolvePopulation(ctx, keepers, 8, mulberry32(7))
    const ids = new Set(['k1', 'k2'])
    for (const ind of picked) {
      for (const id of ind.keeperIds) expect(ids.has(id)).toBe(true)
    }
    // With strong keepers in the pool, at least one survivor descends from them.
    expect(picked.some((ind) => ind.keeperIds.size > 0)).toBe(true)
  })

  it('every survivor is a valid in-scale line inside its own context', () => {
    const keepers = [denseKeeper({ id: 'k1' }), denseKeeper({ id: 'k2', key: 'G', mode: 'mixolydian' })]
    for (let seed = 1; seed <= 5; seed++) {
      const { picked } = evolvePopulation(ctx, keepers, 6, mulberry32(seed))
      for (const ind of picked) {
        const total = ind.ctx.bars * beatsPerBar(ind.ctx.timeSig)
        expect(ind.notes.length).toBeGreaterThanOrEqual(3)
        for (const n of ind.notes) {
          expect(isInScale(n.pitch, ind.ctx.key, ind.ctx.mode)).toBe(true)
          expect(n.pitch).toBeGreaterThanOrEqual(36)
          expect(n.pitch).toBeLessThanOrEqual(96)
          expect(n.startBeat).toBeGreaterThanOrEqual(0)
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(total + 1e-6)
        }
      }
    }
  })
})

describe('generateSymbolicBatch with rhythm', () => {
  it('is deterministic given (seed, brief, keepers), drums included', () => {
    const keepers = [denseKeeper({ id: 'k1' }), denseKeeper({ id: 'k2', key: 'A' })]
    const b = brief({ includeRhythm: true })
    const x = generateSymbolicBatch(b, 5, keepers, 99)
    const y = generateSymbolicBatch(b, 5, keepers, 99)
    const z = generateSymbolicBatch(b, 5, keepers, 100)
    expect(x.valid.map(essence)).toEqual(y.valid.map(essence))
    expect(JSON.stringify(x.valid.map(essence))).not.toEqual(JSON.stringify(z.valid.map(essence)))
  })

  it('adds a drums part with GM pitches and keeps the lead in-scale', () => {
    const result = generateSymbolicBatch(brief({ includeRhythm: true }), 5, [], 31)
    expect(result.valid).toHaveLength(5)
    expect(result.scaleWarningCount).toBe(0)
    for (const m of result.valid) {
      expect(m.parts.map((p) => p.instrument)).toEqual(['synth', 'drums'])
      const lead = m.notes.filter((n) => (n.part ?? 0) === 0)
      const kit = m.notes.filter((n) => n.part === 1)
      expect(lead.length).toBeGreaterThanOrEqual(3)
      expect(kit.length).toBeGreaterThanOrEqual(3)
      for (const n of lead) expect(isInScale(n.pitch, m.key, m.mode)).toBe(true)
      for (const n of kit) expect(n.pitch).toBeGreaterThanOrEqual(35)
      expect(m.scaleWarning).toBe(false)
    }
  })

  it('stays partless without the rhythm flag', () => {
    const result = generateSymbolicBatch(brief(), 5, [], 31)
    for (const m of result.valid) {
      expect(m.parts).toEqual([])
      expect(m.notes.every((n) => n.part === undefined)).toBe(true)
    }
  })
})

/** Peak simultaneous voices, the same sweep-line validateBatch runs. */
function maxSimultaneousVoices(notes: Note[]): number {
  const edges = notes
    .flatMap((n) => [
      { t: n.startBeat, d: 1 },
      { t: n.startBeat + n.durationBeats, d: -1 },
    ])
    .sort((a, b) => a.t - b.t || a.d - b.d) // note-off before note-on at equal times
  let voices = 0
  let peak = 0
  for (const e of edges) {
    voices += e.d
    peak = Math.max(peak, voices)
  }
  return peak
}

/** Distinct pitches per chord onset. */
function onsetSizes(notes: Note[]): number[] {
  const byOnset = new Map<number, Set<number>>()
  for (const n of notes) {
    const s = byOnset.get(n.startBeat) ?? new Set<number>()
    s.add(n.pitch)
    byOnset.set(n.startBeat, s)
  }
  return [...byOnset.values()].map((s) => s.size)
}

describe('generateSymbolicBatch voicing', () => {
  it("'both' layers a chords part under a seed-identical lead line", () => {
    const keepers = [denseKeeper({ id: 'k1' })]
    const line = generateSymbolicBatch(brief(), 5, keepers, 99)
    const both = generateSymbolicBatch(brief({ voicing: 'both' }), 5, keepers, 99)
    expect(both.valid).toHaveLength(5)
    both.valid.forEach((m, i) => {
      expect(m.parts.map((p) => p.name)).toEqual(['lead', 'chords'])
      // Seed compat: the lead is bit-identical whichever way the switch sits
      // (chords draw from their own childSeed stream).
      const lead = m.notes.filter((n) => n.part === 0).map(({ part: _p, ...n }) => ({ ...n }))
      expect(lead).toEqual(line.valid[i].notes)
      const chords = m.notes.filter((n) => n.part === 1)
      expect(chords.length).toBeGreaterThanOrEqual(3)
      for (const n of chords) expect(isInScale(n.pitch, m.key, m.mode)).toBe(true)
      const s = m.source
      expect(s.kind === 'symbolic' || s.kind === 'ga').toBe(true)
      if (s.kind === 'symbolic' || s.kind === 'ga') expect(s.voicing).toBe('both')
      expect(m.rationale).toMatch(/[IViv]/)
    })
  })

  it("'both' + rhythm stays at or under the 8-voice cap via triads-only chords", () => {
    const b = brief({ voicing: 'both', includeRhythm: true })
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = generateSymbolicBatch(b, 5, [denseKeeper()], seed)
      for (const m of result.valid) {
        expect(m.parts.map((p) => p.name)).toEqual(['lead', 'chords', 'kit'])
        expect(m.parts.map((p) => p.instrument)).toEqual(['synth', 'synth', 'drums'])
        expect(maxSimultaneousVoices(m.notes)).toBeLessThanOrEqual(8)
        // The voice-cap rule: melody + drums present, so triads only.
        const chords = m.notes.filter((n) => n.part === 1)
        for (const size of onsetSizes(chords)) expect(size).toBeLessThanOrEqual(3)
      }
    }
  })

  it("'chords' emits a single chords part of stacked in-scale triads/7ths, no GA fitness", () => {
    const result = generateSymbolicBatch(brief({ voicing: 'chords' }), 5, [], 42)
    expect(result.valid).toHaveLength(5)
    for (const m of result.valid) {
      expect(m.parts).toEqual([{ name: 'chords', instrument: 'synth' }])
      expect(m.name).toMatch(/^Prog /)
      expect(m.source).toMatchObject({ kind: 'symbolic', voicing: 'chords' })
      if (m.source.kind === 'symbolic') expect(m.source.fitness).toBeUndefined()
      for (const n of m.notes) expect(isInScale(n.pitch, m.key, m.mode)).toBe(true)
      for (const size of onsetSizes(m.notes)) {
        expect(size).toBeGreaterThanOrEqual(3)
        expect(size).toBeLessThanOrEqual(4)
      }
      expect(maxSimultaneousVoices(m.notes)).toBeLessThanOrEqual(8)
    }
  })

  it("'chords' + rhythm adds a kit and still clears the 8-voice cap (7ths allowed)", () => {
    for (const seed of [7, 8, 9]) {
      const result = generateSymbolicBatch(
        brief({ voicing: 'chords', includeRhythm: true }),
        5,
        [],
        seed,
      )
      for (const m of result.valid) {
        expect(m.parts.map((p) => p.instrument)).toEqual(['synth', 'drums'])
        const kit = m.notes.filter((n) => n.part === 1)
        expect(kit.length).toBeGreaterThanOrEqual(3)
        for (const n of kit) expect(n.pitch).toBeGreaterThanOrEqual(35)
        expect(maxSimultaneousVoices(m.notes)).toBeLessThanOrEqual(8)
      }
    }
  })

  it("'chords' batches are deterministic given (seed, brief)", () => {
    const b = brief({ voicing: 'chords', includeRhythm: true })
    const x = generateSymbolicBatch(b, 5, [], 99)
    const y = generateSymbolicBatch(b, 5, [], 99)
    const z = generateSymbolicBatch(b, 5, [], 100)
    expect(x.valid.map(essence)).toEqual(y.valid.map(essence))
    expect(JSON.stringify(x.valid.map(essence))).not.toEqual(JSON.stringify(z.valid.map(essence)))
  })
})

describe('generateSymbolicBatch with the chord scaffold (EXTRA)', () => {
  it('lays lead+bass+pad(+kit), lead first, all by-construction valid', () => {
    const result = generateSymbolicBatch(
      brief({ extraInstruments: true, includeRhythm: true }),
      5,
      [],
      47,
    )
    expect(result.valid).toHaveLength(5)
    for (const m of result.valid) {
      // Lead MUST stay part 0 (melodicLine/bay/crossover depend on it).
      expect(m.parts.map((p) => p.name)).toEqual(['lead', 'bass', 'pad', 'kit'])
      expect(m.parts.map((p) => p.instrument)).toEqual(['synth', 'synth', 'strings', 'drums'])
      expect(m.parts.length).toBeLessThanOrEqual(6)
      expect(m.parts[1].preset?.oscillator).toBe('triangle')
      const s = m.source
      if (s.kind !== 'symbolic' && s.kind !== 'ga') throw new Error('unexpected source kind')
      const prog = s.spec?.progression
      expect(prog).toHaveLength(m.bars)
      const byPart = (i: number) => m.notes.filter((n) => (n.part ?? 0) === i)
      expect(byPart(0).length).toBeGreaterThanOrEqual(3)
      // Bass: chord tones in the bass register.
      for (const n of byPart(1)) {
        expect(n.pitch).toBeGreaterThanOrEqual(36)
        expect(n.pitch).toBeLessThanOrEqual(55)
      }
      // Pad: 3 sustained voices per bar.
      expect(byPart(2)).toHaveLength(m.bars * 3)
      // Never more than 8 simultaneous melodic voices (drums excluded).
      const melodic = m.notes.filter((n) => (n.part ?? 0) !== 3)
      for (let t = 0; t < m.bars * 4; t += 0.25) {
        const sounding = melodic.filter(
          (n) => n.startBeat <= t + 1e-6 && n.startBeat + n.durationBeats > t + 1e-6,
        )
        expect(sounding.length).toBeLessThanOrEqual(8)
      }
    }
  })

  it('is deterministic and replayable from the stored spec', () => {
    const b = brief({ extraInstruments: true })
    const x = generateSymbolicBatch(b, 4, [], 88)
    const y = generateSymbolicBatch(b, 4, [], 88)
    expect(x.valid.map(essence)).toEqual(y.valid.map(essence))
    const s = x.valid[0].source
    if (s.kind !== 'symbolic' && s.kind !== 'ga') throw new Error('unexpected source kind')
    const replay = generateSymbolicBatch(b, 4, [], 88, s.spec)
    expect(replay.valid.map(essence)).toEqual(x.valid.map(essence))
  })

  it('without EXTRA there is no scaffold: rhythm-only stays lead+kit', () => {
    const result = generateSymbolicBatch(brief({ includeRhythm: true }), 3, [], 12)
    for (const m of result.valid) {
      expect(m.parts.map((p) => p.name)).toEqual(['lead', 'kit'])
    }
  })
})
