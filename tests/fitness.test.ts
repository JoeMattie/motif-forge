import { describe, expect, it } from 'vitest'
import type { Note } from '../src/types'
import { mulberry32 } from '../src/generation/symbolic/prng'
import { randomWalkNotes } from '../src/generation/symbolic/walk'
import {
  DEFAULT_TARGETS,
  extractFeatures,
  type FitnessContext,
  fitnessScore,
  similarity,
  type TargetTable,
} from '../src/generation/symbolic/fitness'
import { makeNote } from './fixtures'

const ctx: FitnessContext = { key: 'C', mode: 'ionian', bars: 2, timeSig: '4/4' }

/** C–D–E–F… stepwise line, one note per beat across 2 bars of 4/4. */
function stepwiseLine(): Note[] {
  const pitches = [60, 62, 64, 65, 67, 65, 64, 60]
  return pitches.map((pitch, b) => makeNote({ pitch, startBeat: b }))
}

describe('feature extraction', () => {
  it('measures pitch and interval features on a hand-checked line', () => {
    const f = extractFeatures(stepwiseLine(), ctx)
    expect(f.notesPerBar).toBe(4)
    expect(f.pitchRange).toBe(7) // C4..G4
    expect(f.stepwiseRatio).toBe(6 / 7) // 7 intervals, only the closing −4 is a leap
    expect(f.bigLeapRatio).toBe(0)
    expect(f.dissonantRatio).toBe(0)
    expect(f.offBeatRatio).toBe(0)
    expect(f.restRatio).toBe(0) // every beat covered by a 1-beat note
    expect(f.rhythmicVariety).toBe(1) // all quarter notes
  })

  it('covers strong beats and anchors on the tonic triad', () => {
    const f = extractFeatures(stepwiseLine(), ctx)
    // Strong beats 0/2/4/6 all carry onsets; first (C) and last (C) are triad tones.
    expect(f.strongBeatCoverage).toBe(1)
    expect(f.tonalAnchor).toBe(1)
    expect(f.inScaleRatio).toBe(1)
  })

  it('finds repeated interval n-grams', () => {
    // Two identical 4-note cells: intervals +2,+2,-4 repeat (7 intervals, len-3 repeat).
    const pitches = [60, 62, 64, 60, 60, 62, 64, 60]
    const notes = pitches.map((pitch, b) => makeNote({ pitch, startBeat: b }))
    const f = extractFeatures(notes, ctx)
    expect(f.repetitionScore).toBeGreaterThanOrEqual(3 / 7)
    // A non-repeating contour scores 0.
    const jumble = [60, 65, 62, 71, 64, 69, 67, 72].map((pitch, b) =>
      makeNote({ pitch, startBeat: b }),
    )
    expect(extractFeatures(jumble, ctx).repetitionScore).toBe(0)
  })

  it('flags off-beat onsets, rests, and out-of-scale pitches', () => {
    const notes = [
      makeNote({ pitch: 60, startBeat: 0, durationBeats: 0.5 }),
      makeNote({ pitch: 61, startBeat: 1.5, durationBeats: 0.5 }), // off-beat + chromatic
      makeNote({ pitch: 64, startBeat: 4, durationBeats: 1 }),
    ]
    const f = extractFeatures(notes, ctx)
    expect(f.offBeatRatio).toBe(1 / 3)
    expect(f.inScaleRatio).toBe(2 / 3)
    expect(f.restRatio).toBe(24 / 32) // 8 of 32 sixteenths covered
  })
})

describe('fitnessScore', () => {
  it('is deterministic and lands in (0, 1]', () => {
    const notes = stepwiseLine()
    const a = fitnessScore(notes, ctx)
    expect(fitnessScore(notes, ctx)).toBe(a)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThanOrEqual(1)
  })

  it('scores 0 for degenerate lines', () => {
    expect(fitnessScore([], ctx)).toBe(0)
    expect(fitnessScore([makeNote({ pitch: 60, startBeat: 0 })], ctx)).toBe(0)
  })

  it('a feature exactly at μ contributes its full weight', () => {
    // Single-feature table: pitchRange μ=7 matches the stepwise line exactly.
    const targets: TargetTable = {
      ...DEFAULT_TARGETS,
      pitchRange: { mu: 7, sigma: 5, w: 1 },
    }
    // Zero all other weights so the score isolates the one Gaussian.
    for (const k of Object.keys(targets) as (keyof TargetTable)[]) {
      if (k !== 'pitchRange') targets[k] = { ...targets[k], w: 0 }
    }
    expect(fitnessScore(stepwiseLine(), ctx, targets)).toBeCloseTo(1, 10)
  })

  it('prefers a musical line over a monotone and over random wide leaps', () => {
    const musical = fitnessScore(stepwiseLine(), ctx)
    const monotone = stepwiseLine().map((n) => ({ ...n, pitch: 60 }))
    const rng = mulberry32(7)
    const leapy = stepwiseLine().map((n) => ({ ...n, pitch: 36 + Math.floor(rng() * 60) }))
    expect(musical).toBeGreaterThan(fitnessScore(monotone, ctx))
    expect(musical).toBeGreaterThan(fitnessScore(leapy, ctx))
  })

  it('rates real random walks solidly across seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const notes = randomWalkNotes(
        { key: 'D', mode: 'dorian', bars: 4, timeSig: '4/4', contour: 'arch', rhythm: 'straight' },
        mulberry32(seed),
      )
      const score = fitnessScore(notes, { key: 'D', mode: 'dorian', bars: 4, timeSig: '4/4' })
      expect(score).toBeGreaterThan(0.3)
      expect(score).toBeLessThanOrEqual(1)
    }
  })
})

describe('similarity', () => {
  it('is 1 for identical lines and 0 for disjoint ones', () => {
    const a = stepwiseLine()
    expect(similarity(a, stepwiseLine())).toBe(1)
    const moved = a.map((n) => ({ ...n, pitch: n.pitch + 12 }))
    expect(similarity(a, moved)).toBe(0)
    expect(similarity([], [])).toBe(1)
  })

  it('degrades smoothly with partial overlap', () => {
    const a = stepwiseLine()
    const half = a.map((n, i) => (i < 4 ? n : { ...n, pitch: n.pitch + 12 }))
    const s = similarity(a, half)
    expect(s).toBeGreaterThan(0.2)
    expect(s).toBeLessThan(0.8)
  })
})
