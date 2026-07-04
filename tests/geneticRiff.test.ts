import { describe, expect, it } from 'vitest'
import type { GenerationBrief, Motif } from '../src/types'
import { beatsPerBar, isInScale } from '../src/core/theory'
import { childSeed, mulberry32 } from '../src/generation/symbolic/prng'
import {
  barSimilarity,
  EUCLID_SEED_FRACTION,
  euclid,
  evolveRhythm,
  fitness,
  initialGenome,
  POP,
  RIFF_PRESET_NAMES,
  RIFF_PRESETS,
  surprisePreset,
  tiledAccents,
} from '../src/generation/genetic/rhythm'
import { ACCENT_VELOCITY, BASE_VELOCITY } from '../src/generation/genetic/pitch'
import { generateGeneticBatch } from '../src/generation/genetic'

const brief = (partial: Partial<GenerationBrief> = {}): GenerationBrief => ({
  key: 'D',
  mode: 'dorian',
  tempo: 120,
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

/** Signature that ignores ids/timestamps so determinism can be compared. */
const essence = (m: Motif) => [m.name, m.key, m.mode, m.bars, m.tempo, m.rationale, m.notes]

const onsetSteps = (g: number[]) => g.flatMap((bit, i) => (bit === 1 ? [i] : []))

describe('euclid (Bjorklund)', () => {
  it('matches known patterns', () => {
    // This port (like ga-riffs) emits rotations of the canonical patterns.
    expect(euclid(8, 3)).toEqual([0, 1, 0, 0, 1, 0, 0, 1]) // tresillo, rotated
    expect(euclid(16, 4)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]) // four-on-the-floor, rotated
    expect(euclid(4, 4)).toEqual([1, 1, 1, 1])
    expect(euclid(8, 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('places the exact pulse count with maximally even circular gaps', () => {
    for (const steps of [8, 12, 16]) {
      for (let pulses = 1; pulses <= steps; pulses++) {
        const g = euclid(steps, pulses)
        expect(g).toHaveLength(steps)
        const on = onsetSteps(g)
        expect(on).toHaveLength(pulses)
        if (on.length >= 2) {
          const gaps = on.map((s, i) => ((on[(i + 1) % on.length] - s + steps) % steps) || steps)
          expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('fitness', () => {
  const techno = RIFF_PRESETS.techno

  it('penalizes empty and near-empty genomes below groove-shaped ones', () => {
    const empty = new Array(16).fill(0)
    const single = [...empty]
    single[0] = 1
    const groove = euclid(16, 6)
    expect(fitness(empty, techno, 1)).toBeLessThan(fitness(single, techno, 1))
    expect(fitness(single, techno, 1)).toBeLessThan(fitness(groove, techno, 1))
  })

  it('rewards hits on the preset accents at equal density', () => {
    const withGenome = (steps: number[]) => {
      const g = new Array(16).fill(0)
      for (const s of steps) g[s] = 1
      return g
    }
    // Same 6-hit density; A lands all four techno accents, B lands none.
    const a = withGenome([0, 2, 4, 8, 10, 12])
    const b = withGenome([1, 3, 5, 7, 9, 11])
    expect(fitness(a, techno, 1)).toBeGreaterThan(fitness(b, techno, 1))
  })

  it('penalizes runs of four or more consecutive hits', () => {
    const withGenome = (steps: number[]) => {
      const g = new Array(16).fill(0)
      for (const s of steps) g[s] = 1
      return g
    }
    // Identical density, accent hits, offbeat count, and saturated variety
    // scores — the only fitness difference is C's 4-run.
    const c = withGenome([0, 1, 2, 3, 10, 15]) // run of 4 at the top
    const d = withGenome([0, 1, 3, 6, 10, 15]) // same terms, no run >= 4
    expect(fitness(c, techno, 1)).toBeLessThan(fitness(d, techno, 1))
    expect(fitness(d, techno, 1) - fitness(c, techno, 1)).toBeCloseTo(techno.longRunPenalty, 6)
  })

  it('keeps repeatW at 0 on the shipped presets so their old seeds still reproduce', () => {
    for (const name of RIFF_PRESET_NAMES) expect(RIFF_PRESETS[name].repeatW).toBe(0)
  })

  it('adds exactly repeatW * barSimilarity on top of the other terms', () => {
    const loopy = { ...techno, repeatW: 1.2 }
    const bar = euclid(16, 6)
    const repeated = bar.concat(bar)
    const shifted = bar.concat(bar.map((_, i) => bar[(i + 5) % 16]))
    for (const g of [repeated, shifted]) {
      expect(fitness(g, loopy, 2) - fitness(g, techno, 2)).toBeCloseTo(
        loopy.repeatW * barSimilarity(g, 16),
        9,
      )
    }
    expect(barSimilarity(repeated, 16)).toBe(1)
    expect(barSimilarity(shifted, 16)).toBeLessThan(1)
    expect(barSimilarity(bar, 16)).toBe(1) // single bar: trivially self-similar
    const complement = bar.concat(bar.map((b) => 1 - b))
    expect(barSimilarity(complement, 16)).toBe(0)
  })
})

describe('surprisePreset', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const a = surprisePreset(mulberry32(7))
    const b = surprisePreset(mulberry32(7))
    const c = surprisePreset(mulberry32(8))
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c))
  })

  it('samples every field inside its band with Euclidean accents', () => {
    for (let s = 0; s < 50; s++) {
      const { preset, blurb } = surprisePreset(mulberry32(1000 + s))
      expect([12, 16]).toContain(preset.steps)
      expect(preset.targetHits).toBeGreaterThanOrEqual(4)
      expect(preset.targetHits).toBeLessThanOrEqual(Math.round(preset.steps * 0.6))
      expect(preset.accents.length).toBeGreaterThanOrEqual(2)
      expect(preset.accents.length).toBeLessThanOrEqual(5)
      for (const a of preset.accents) {
        expect(Number.isInteger(a)).toBe(true)
        expect(a).toBeGreaterThanOrEqual(0)
        expect(a).toBeLessThan(preset.steps)
      }
      // Accents are a rotated Euclidean skeleton: circular gaps differ by <= 1.
      if (preset.accents.length >= 2) {
        const on = preset.accents
        const gaps = on.map(
          (step, i) => ((on[(i + 1) % on.length] - step + preset.steps) % preset.steps) || preset.steps,
        )
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
      }
      expect(preset.syncOpty).toBeGreaterThanOrEqual(0.3)
      expect(preset.syncOpty).toBeLessThan(0.8)
      expect(preset.longRunPenalty).toBeGreaterThanOrEqual(0.15)
      expect(preset.longRunPenalty).toBeLessThan(0.35)
      expect(preset.densityW).toBeGreaterThanOrEqual(1.5)
      expect(preset.densityW).toBeLessThan(2.2)
      expect(preset.strongW).toBeGreaterThanOrEqual(0.8)
      expect(preset.strongW).toBeLessThan(1.8)
      expect(preset.syncW).toBeGreaterThanOrEqual(1.0)
      expect(preset.syncW).toBeLessThan(1.7)
      expect(preset.varW).toBeGreaterThanOrEqual(1.0)
      expect(preset.varW).toBeLessThan(1.5)
      expect(preset.repeatW).toBeGreaterThanOrEqual(0.8)
      expect(preset.repeatW).toBeLessThan(1.8)
      expect(blurb).toContain(`${preset.steps} steps`)
      expect(blurb).toContain(`${preset.targetHits} hits/bar`)
    }
  })
})

describe('evolveRhythm', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const a = evolveRhythm(RIFF_PRESETS.techno, 4, mulberry32(42))
    const b = evolveRhythm(RIFF_PRESETS.techno, 4, mulberry32(42))
    const c = evolveRhythm(RIFF_PRESETS.techno, 4, mulberry32(43))
    expect(a).toEqual(b)
    expect(JSON.stringify(a.genome)).not.toEqual(JSON.stringify(c.genome))
  })

  it('never scores below the best initial genome (elitism)', () => {
    for (const name of RIFF_PRESET_NAMES) {
      const preset = RIFF_PRESETS[name]
      const seed = 7 + RIFF_PRESET_NAMES.indexOf(name)
      // Rebuild the initial population from the same rng draws evolveRhythm makes.
      const rng = mulberry32(seed)
      const euclidCount = Math.round(POP * EUCLID_SEED_FRACTION)
      let bestInitial = -Infinity
      for (let i = 0; i < POP; i++) {
        const g = initialGenome(preset, 2, i < euclidCount, rng)
        bestInitial = Math.max(bestInitial, fitness(g, preset, 2))
      }
      const evolved = evolveRhythm(preset, 2, mulberry32(seed))
      expect(evolved.fitness).toBeGreaterThanOrEqual(bestInitial - 1e-9)
      expect(evolved.fitness).toBeCloseTo(fitness(evolved.genome, preset, 2), 9)
    }
  })

  // 45 full GA runs (presets × bars × seeds) — over Vitest's 5s default on CI runners.
  it('always lands enough hits for a valid motif (>=3 notes)', { timeout: 20000 }, () => {
    for (const name of RIFF_PRESET_NAMES) {
      for (const bars of [2, 4, 8]) {
        for (let s = 0; s < 5; s++) {
          const { genome, hits } = evolveRhythm(RIFF_PRESETS[name], bars, mulberry32(1000 + s))
          expect(genome).toHaveLength(RIFF_PRESETS[name].steps * bars)
          expect(hits).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

describe('generateGeneticBatch', () => {
  it('produces n valid, in-scale, in-range riffs for every preset and bar count', () => {
    for (const name of [...RIFF_PRESET_NAMES, 'surprise' as const]) {
      for (const bars of [2, 4, 8]) {
        const b = brief({ bars })
        const result = generateGeneticBatch(b, 2, name, 99)
        expect(result.valid).toHaveLength(2)
        expect(result.droppedCount).toBe(0)
        expect(result.errors).toEqual([])
        const totalBeats = bars * beatsPerBar(b.timeSig)
        for (const m of result.valid) {
          expect(m.parts).toEqual([])
          expect(m.notes.length).toBeGreaterThanOrEqual(3)
          expect(m.scaleWarning).toBe(false)
          let prevStart = -1
          for (const note of m.notes) {
            expect(note.pitch).toBeGreaterThanOrEqual(36)
            expect(note.pitch).toBeLessThanOrEqual(96)
            expect(isInScale(note.pitch, m.key, m.mode)).toBe(true)
            expect(note.velocity).toBeGreaterThanOrEqual(1)
            expect(note.velocity).toBeLessThanOrEqual(127)
            expect(note.startBeat).toBeGreaterThanOrEqual(prevStart)
            expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(totalBeats + 1e-6)
            prevStart = note.startBeat
          }
        }
      }
    }
  })

  it('plays accented steps louder than unaccented ones', () => {
    const b = brief({ bars: 2 })
    const preset = RIFF_PRESETS.techno
    const accents = tiledAccents(preset, b.bars)
    const stepDur = beatsPerBar(b.timeSig) / preset.steps
    const { valid } = generateGeneticBatch(b, 3, 'techno', 123)
    let sawAccent = 0
    for (const m of valid) {
      for (const note of m.notes) {
        const step = Math.round(note.startBeat / stepDur)
        if (accents.has(step)) {
          sawAccent++
          expect(note.velocity).toBeGreaterThanOrEqual(ACCENT_VELOCITY - 4)
        } else {
          expect(note.velocity).toBeLessThanOrEqual(BASE_VELOCITY + 6)
        }
      }
    }
    // The fitness's strong-beat term makes accent hits all but certain.
    expect(sawAccent).toBeGreaterThan(0)
  })

  it('puts organic riffs on the 8th-note-triplet grid', () => {
    const { valid } = generateGeneticBatch(brief({ bars: 2 }), 2, 'organic', 5)
    for (const m of valid) {
      for (const note of m.notes) {
        expect(Math.abs(note.startBeat * 3 - Math.round(note.startBeat * 3))).toBeLessThan(1e-6)
      }
    }
  })

  it('is deterministic for a given seed with per-motif child seeds', () => {
    const b = brief()
    const a = generateGeneticBatch(b, 3, 'tribal', 77)
    const c = generateGeneticBatch(b, 3, 'tribal', 77)
    const d = generateGeneticBatch(b, 3, 'tribal', 78)
    expect(a.valid.map(essence)).toEqual(c.valid.map(essence))
    expect(JSON.stringify(a.valid.map(essence))).not.toEqual(JSON.stringify(d.valid.map(essence)))
    a.valid.forEach((m, i) => {
      expect(m.source).toMatchObject({ kind: 'genetic', preset: 'tribal', seed: childSeed(77, i) })
      if (m.source.kind === 'genetic') expect(Number.isFinite(m.source.fitness)).toBe(true)
    })
  })

  it("'surprise' synthesizes a per-motif preset deterministically from its seed", () => {
    const b = brief({ bars: 4 })
    const a = generateGeneticBatch(b, 6, 'surprise', 55)
    const c = generateGeneticBatch(b, 6, 'surprise', 55)
    expect(a.valid.map(essence)).toEqual(c.valid.map(essence))
    const rationales = a.valid.map((m) => m.rationale ?? '')
    for (const m of a.valid) {
      expect(m.source).toMatchObject({ kind: 'genetic', preset: 'surprise' })
      expect(m.rationale).toMatch(/surprise genome \(1[26] steps, euclid\(1[26],[2-5]\)/)
      // Rolled steps are 16 or 12, so notes sit on the 16th or triplet grid.
      for (const note of m.notes) {
        const on16 = Math.abs(note.startBeat * 4 - Math.round(note.startBeat * 4)) < 1e-6
        const on12 = Math.abs(note.startBeat * 3 - Math.round(note.startBeat * 3)) < 1e-6
        expect(on16 || on12).toBe(true)
      }
    }
    // Six independent rolls all landing the same groove would be a broken rng.
    expect(new Set(rationales.map((r) => r.slice(0, r.indexOf(', fitness')))).size).toBeGreaterThanOrEqual(2)
  })

  it("'chords' voicing emits low-voiced in-scale chord stabs, still partless and deterministic", () => {
    const b = brief({ voicing: 'chords', bars: 2 })
    const a = generateGeneticBatch(b, 3, 'techno', 77)
    const c = generateGeneticBatch(b, 3, 'techno', 77)
    expect(a.valid.map(essence)).toEqual(c.valid.map(essence))
    const stepDur = beatsPerBar(b.timeSig) / RIFF_PRESETS.techno.steps
    for (const m of a.valid) {
      expect(m.parts).toEqual([])
      expect(m.source).toMatchObject({ kind: 'genetic', preset: 'techno', voicing: 'chords' })
      expect(m.rationale).toContain('chord riff')
      const byOnset = new Map<number, number[]>()
      for (const n of m.notes) {
        expect(isInScale(n.pitch, m.key, m.mode)).toBe(true)
        expect(n.pitch).toBeGreaterThanOrEqual(36)
        expect(n.pitch).toBeLessThanOrEqual(96)
        expect(n.durationBeats).toBeCloseTo(stepDur, 9)
        byOnset.set(n.startBeat, [...(byOnset.get(n.startBeat) ?? []), n.pitch])
      }
      for (const pitches of byOnset.values()) {
        const unique = new Set(pitches)
        // Triads, plus the segment's seeded 7th on accents: 3-4 tones, root low.
        expect(unique.size).toBeGreaterThanOrEqual(3)
        expect(unique.size).toBeLessThanOrEqual(4)
        const root = Math.min(...pitches)
        expect(root).toBeGreaterThanOrEqual(45)
        expect(root).toBeLessThanOrEqual(57)
      }
    }
  })

  it("'both' voicing clamps defensively to line (the UI gates it off this engine)", () => {
    const a = generateGeneticBatch(brief({ voicing: 'both' }), 2, 'tribal', 5)
    const b = generateGeneticBatch(brief({ voicing: 'line' }), 2, 'tribal', 5)
    expect(a.valid.map(essence)).toEqual(b.valid.map(essence))
    for (const m of a.valid) {
      if (m.source.kind === 'genetic') expect(m.source.voicing).toBeUndefined()
    }
  })

  it("'line' riffs stay strictly monophonic (one pitch per onset)", () => {
    const { valid } = generateGeneticBatch(brief({ bars: 2 }), 3, 'techno', 41)
    for (const m of valid) {
      const starts = m.notes.map((n) => n.startBeat)
      expect(new Set(starts).size).toBe(starts.length)
    }
  })

  it("'any' rolls a concrete preset per motif from its seed", () => {
    const a = generateGeneticBatch(brief({ bars: 2 }), 12, 'any', 31)
    const b = generateGeneticBatch(brief({ bars: 2 }), 12, 'any', 31)
    expect(a.valid.map(essence)).toEqual(b.valid.map(essence))
    const presets = a.valid.map((m) => (m.source.kind === 'genetic' ? m.source.preset : ''))
    for (const p of presets) expect(RIFF_PRESET_NAMES).toContain(p)
    expect(new Set(presets).size).toBeGreaterThanOrEqual(2)
  })
})
