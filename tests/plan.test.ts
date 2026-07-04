import { describe, expect, it } from 'vitest'
import type { GenerationBrief } from '../src/types'
import { parseInstantPlan } from '../src/generation/symbolic/plan'
import { buildPlanPrompt } from '../src/api/prompts'

const brief = (partial: Partial<GenerationBrief> = {}): GenerationBrief => ({
  key: 'D',
  mode: 'dorian',
  tempo: 100,
  bars: 4,
  timeSig: '4/4',
  concept: 'event horizon',
  text: 'slow rise then collapse, sparse and hollow',
  allowChromatic: false,
  voicing: 'line',
  texture: 'lead',
  includeRhythm: true,
  extraInstruments: false,
  ...partial,
})

describe('parseInstantPlan', () => {
  it('accepts a well-formed plan verbatim', () => {
    const spec = parseInstantPlan(
      {
        valence: -0.4,
        arousal: 0.2,
        contourWeights: { descend: 3, arch: 1 },
        rhythmWeights: { sparse: 2 },
        density: 'sparse',
        register: 'low',
        chromaticism: true,
        progression: [0, 5, 3, 4],
      },
      4,
    )
    expect(spec).toEqual({
      valence: -0.4,
      arousal: 0.2,
      contourWeights: { descend: 3, arch: 1 },
      rhythmWeights: { sparse: 2 },
      density: 'sparse',
      register: 'low',
      progression: [0, 5, 3, 4],
    })
  })

  it('clamps valence/arousal and progression degrees into range', () => {
    const spec = parseInstantPlan({ valence: 7, arousal: -3, progression: [9, -2, 3.6] }, 3)
    expect(spec).toEqual({ valence: 1, arousal: 0, progression: [6, 0, 4] })
  })

  it('cycles short progressions to one degree per bar and truncates long ones', () => {
    expect(parseInstantPlan({ progression: [0, 4] }, 4)?.progression).toEqual([0, 4, 0, 4])
    expect(parseInstantPlan({ progression: [0, 1, 2, 3, 4, 5] }, 2)?.progression).toEqual([0, 1])
  })

  it('whitelists contour/rhythm keys and drops empty or junk weight maps', () => {
    const spec = parseInstantPlan(
      {
        contourWeights: { arch: 2, wiggle: 9, flat: -1, zigzag: 'lots' },
        rhythmWeights: { funky: 3 },
      },
      4,
    )
    expect(spec).toEqual({ contourWeights: { arch: 2 } })
  })

  it('drops invalid enums and unknown fields', () => {
    const spec = parseInstantPlan(
      { density: 'thicc', register: 'subsonic', tempo: 180, key: 'F#', valence: 0.5 },
      4,
    )
    expect(spec).toEqual({ valence: 0.5 })
  })

  it('returns null on garbage and on payloads contributing nothing', () => {
    expect(parseInstantPlan(null, 4)).toBeNull()
    expect(parseInstantPlan('nope', 4)).toBeNull()
    expect(parseInstantPlan([1, 2, 3], 4)).toBeNull()
    expect(parseInstantPlan({}, 4)).toBeNull()
    // The e2e mock's generation payload: an object with no plan fields.
    expect(parseInstantPlan({ motifs: [{ name: 'x' }] }, 4)).toBeNull()
    expect(parseInstantPlan({ valence: 'dark', progression: [] }, 4)).toBeNull()
  })

  it('parses but ignores chromaticism (the walk is diatonic by design)', () => {
    const spec = parseInstantPlan({ chromaticism: true, arousal: 0.9 }, 4)
    expect(spec).toEqual({ arousal: 0.9 })
  })
})

describe('buildPlanPrompt', () => {
  it('spells out the schema, enums, and constraints', () => {
    const p = buildPlanPrompt(brief())
    expect(p).toContain('"valence"')
    expect(p).toContain('"arousal"')
    expect(p).toContain('"arch", "ascend", "descend", "zigzag", "flat"')
    expect(p).toContain('"straight", "dotted", "syncopated", "sparse"')
    expect(p).toContain('"sparse" | "medium" | "busy"')
    expect(p).toContain('"low" | "mid" | "high"')
    expect(p).toContain('0-6')
    expect(p).toContain('MINIFIED JSON')
    expect(p).toContain('slow rise then collapse')
    expect(p).toContain('D dorian')
    // Neutral knobs: no fixed-mood clause.
    expect(p).not.toContain('FIXED valence/arousal')
  })

  it('declares the mood FIXED when the knobs are touched', () => {
    const p = buildPlanPrompt(brief({ mood: { valence: 0.5, arousal: 0.5 } }))
    expect(p).toContain('FIXED valence/arousal')
    // Centered knobs are neutral — no clause.
    const neutral = buildPlanPrompt(brief({ mood: { valence: 0, arousal: 0.5 } }))
    expect(neutral).not.toContain('FIXED valence/arousal')
  })
})
