import { describe, expect, it } from 'vitest'
import type { GenerationBrief, Motif, Note } from '../src/types'
import { mulberry32 } from '../src/generation/symbolic/prng'
import { DEFAULT_TARGETS } from '../src/generation/symbolic/fitness'
import { DEFAULT_RANGE } from '../src/generation/symbolic/walk'
import { drumNotes } from '../src/generation/symbolic/drums'
import {
  moodDensity,
  moodRange,
  moodTargets,
  NEUTRAL_MOOD,
} from '../src/generation/symbolic/mood'
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
  includeRhythm: false,
  extraInstruments: false,
  ...partial,
})

/** Signature that ignores ids/timestamps so determinism can be compared. */
const essence = (m: Motif) => [m.name, m.key, m.mode, m.bars, m.tempo, m.notes, m.parts]

function denseKeeper(partial: Partial<Motif> = {}): Motif {
  const bars = partial.bars ?? 4
  const pitches = [62, 64, 65, 67, 69, 67, 65, 64]
  const notes: Note[] = []
  for (let b = 0; b < bars * 4; b++) {
    notes.push(makeNote({ pitch: pitches[b % pitches.length], startBeat: b }))
  }
  return makeMotif({ id: 'keeper', key: 'D', mode: 'dorian', bars, notes, rating: 4, ...partial })
}

describe('moodTargets', () => {
  it('NEUTRAL_MOOD is bit-identical to DEFAULT_TARGETS (load-bearing)', () => {
    expect(moodTargets(NEUTRAL_MOOD)).toEqual(DEFAULT_TARGETS)
  })

  it('shifts μ monotonically along the paper’s axes, leaving σ and w alone', () => {
    const bright = moodTargets({ valence: 1, arousal: 0.5 })
    const dark = moodTargets({ valence: -1, arousal: 0.5 })
    const driven = moodTargets({ valence: 0, arousal: 1 })
    const calm = moodTargets({ valence: 0, arousal: 0 })
    // Valence: brighter wants more unique pitches, wider range, fewer rests,
    // less strictly stepwise motion.
    expect(bright.uniquePitchesPerBar.mu).toBeGreaterThan(dark.uniquePitchesPerBar.mu)
    expect(bright.pitchRange.mu).toBeGreaterThan(dark.pitchRange.mu)
    expect(bright.restRatio.mu).toBeLessThan(dark.restRatio.mu)
    expect(bright.stepwiseRatio.mu).toBeLessThan(dark.stepwiseRatio.mu)
    // Arousal: hotter wants more notes, more syncopation, less anchoring.
    expect(driven.notesPerBar.mu).toBeGreaterThan(calm.notesPerBar.mu)
    expect(driven.offBeatRatio.mu).toBeGreaterThan(calm.offBeatRatio.mu)
    expect(driven.rhythmicVariety.mu).toBeGreaterThan(calm.rhythmicVariety.mu)
    expect(driven.tonalAnchor.mu).toBeLessThan(calm.tonalAnchor.mu)
    expect(driven.restRatio.mu).toBeLessThan(calm.restRatio.mu)
    // σ/w untouched everywhere.
    for (const table of [bright, dark, driven, calm]) {
      for (const k of Object.keys(table) as (keyof typeof table)[]) {
        expect(table[k].sigma).toBe(DEFAULT_TARGETS[k].sigma)
        expect(table[k].w).toBe(DEFAULT_TARGETS[k].w)
      }
    }
  })

  it('clamps ratio targets into [0, 1] and never lets a μ go negative', () => {
    const extreme = moodTargets({ valence: -1, arousal: 1 })
    for (const k of Object.keys(extreme) as (keyof typeof extreme)[]) {
      expect(extreme[k].mu).toBeGreaterThanOrEqual(0)
    }
    // dissonantRatio at full arousal: 0.03 − 0.02 stays non-negative; pushing
    // out-of-range inputs is clamped before shifting.
    const silly = moodTargets({ valence: -99, arousal: 99 })
    expect(silly.restRatio.mu).toBeGreaterThanOrEqual(0)
    expect(silly.restRatio.mu).toBeLessThanOrEqual(1)
  })
})

describe('moodRange / moodDensity', () => {
  it('neutral leaves the walk register untouched; moods slide it, clamped', () => {
    expect(moodRange(NEUTRAL_MOOD)).toEqual(DEFAULT_RANGE)
    const up = moodRange({ valence: 1, arousal: 1 })
    const down = moodRange({ valence: -1, arousal: 0 })
    expect(up.min).toBeGreaterThan(DEFAULT_RANGE.min)
    expect(up.max).toBeGreaterThan(DEFAULT_RANGE.max)
    expect(down.min).toBeLessThan(DEFAULT_RANGE.min)
    expect(down.max).toBeLessThan(DEFAULT_RANGE.max)
    for (const r of [up, down]) {
      expect(r.min).toBeGreaterThanOrEqual(36)
      expect(r.max).toBeLessThanOrEqual(96)
    }
  })

  it('moodDensity defers to the melody at neutral arousal', () => {
    expect(moodDensity(0.5)).toBeNull()
    expect(moodDensity(0)).toBe('sparse')
    expect(moodDensity(1)).toBe('busy')
  })
})

describe('drum energy', () => {
  it('omitting energy is byte-identical to the pre-energy generator', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const bare = drumNotes({ bars: 4, timeSig: '4/4', density: 'medium' }, mulberry32(seed))
      const neutral = drumNotes(
        { bars: 4, timeSig: '4/4', density: 'medium', energy: 0.5 },
        mulberry32(seed),
      )
      expect(neutral).toEqual(bare)
    }
  })

  it('driven kits play louder than calm kits on average', () => {
    const avgVel = (energy: number, seed: number) => {
      const notes = drumNotes({ bars: 4, timeSig: '4/4', density: 'medium', energy }, mulberry32(seed))
      return notes.reduce((s, n) => s + n.velocity, 0) / notes.length
    }
    for (let seed = 1; seed <= 10; seed++) {
      expect(avgVel(1, seed)).toBeGreaterThan(avgVel(0, seed))
    }
  })
})

describe('mood-conditioned batches', () => {
  it('a hot bright batch is deterministic per seed and differs from neutral', () => {
    const hot = brief({ mood: { valence: 1, arousal: 1 } })
    const a = generateSymbolicBatch(hot, 5, [], 77)
    const b = generateSymbolicBatch(hot, 5, [], 77)
    const neutral = generateSymbolicBatch(brief(), 5, [], 77)
    expect(a.valid.map(essence)).toEqual(b.valid.map(essence))
    expect(JSON.stringify(a.valid.map(essence))).not.toEqual(
      JSON.stringify(neutral.valid.map(essence)),
    )
  })

  it('stamps the resolved mood into source.spec, and the spec round-trips', () => {
    const hot = brief({ mood: { valence: 1, arousal: 1 } })
    const first = generateSymbolicBatch(hot, 5, [denseKeeper()], 42)
    for (const m of first.valid) {
      const s = m.source
      if (s.kind !== 'symbolic' && s.kind !== 'ga') throw new Error('unexpected source kind')
      expect(s.spec?.valence).toBe(1)
      expect(s.spec?.arousal).toBe(1)
      expect(s.spec?.progression).toHaveLength(4)
      // Replay from (seed, brief, keepers, stored spec) reproduces the batch.
      const replay = generateSymbolicBatch(hot, 5, [denseKeeper()], 42, s.spec)
      expect(replay.valid.map(essence)).toEqual(first.valid.map(essence))
    }
  })

  it('neutral batches carry a spec with only the progression', () => {
    const result = generateSymbolicBatch(brief(), 3, [], 9)
    for (const m of result.valid) {
      const s = m.source
      if (s.kind !== 'symbolic' && s.kind !== 'ga') throw new Error('unexpected source kind')
      expect(s.spec?.valence).toBeUndefined()
      expect(s.spec?.arousal).toBeUndefined()
      expect(s.spec?.progression).toHaveLength(4)
      expect(s.spec?.progression?.[0]).toBe(0)
    }
  })
})
