import { describe, expect, it } from 'vitest'
import type { GenerationBrief } from '../src/types'
import { buildGenerationPrompt, buildMutationPrompt, buildSurprisePrompt } from '../src/api/prompts'
import { makeMotif } from './fixtures'

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

describe('generation prompt voicing rules', () => {
  it('line keeps the plain texture rule with no chords demand', () => {
    const p = buildGenerationPrompt(brief(), 5)
    expect(p).toContain('primarily a single melodic line')
    expect(p).not.toContain('named "chords"')
    expect(p).not.toContain('IS a chord progression')
  })

  it('chords replaces the texture rule with the progression rule', () => {
    const p = buildGenerationPrompt(brief({ voicing: 'chords' }), 5)
    expect(p).toContain('IS a chord progression')
    expect(p).toContain('named "chords"')
    expect(p).toContain('authentic V-I cadence')
    expect(p).toContain('root-position diatonic triads')
    // The lead/poly texture rule is moot without a melody.
    expect(p).not.toContain('primarily a single melodic line')
  })

  it('both keeps the texture rule and appends the accompaniment rule', () => {
    const p = buildGenerationPrompt(brief({ voicing: 'both', texture: 'lead' }), 5)
    expect(p).toContain('primarily a single melodic line')
    expect(p).toContain('- Accompaniment: additionally include one part named "chords"')
    expect(p).toContain('BELOW the melody')
  })

  it('mutation and surprise prompts are untouched by the voicing switch', () => {
    const mutation = buildMutationPrompt(makeMotif(), 'darker', 2)
    expect(mutation).not.toContain('IS a chord progression')
    expect(mutation).not.toContain('- Accompaniment:')
    const surprise = buildSurprisePrompt(5)
    expect(surprise).not.toContain('IS a chord progression')
    expect(surprise).not.toContain('- Accompaniment:')
  })
})
