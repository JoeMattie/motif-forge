import { describe, expect, it } from 'vitest'
import type { GenerationBrief, Motif, Note } from '../src/types'
import { beatsPerBar, isInScale } from '../src/core/theory'
import { mulberry32 } from '../src/generation/symbolic/prng'
import {
  EVOLVE_DEFAULTS,
  type EvolveContext,
  evolvePopulation,
} from '../src/generation/symbolic/evolve'
import { similarity } from '../src/generation/symbolic/fitness'
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
