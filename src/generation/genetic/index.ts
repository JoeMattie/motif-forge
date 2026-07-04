/**
 * GENETIC engine batch entry — the ga-riffs port: each motif is one full GA
 * run evolving a rhythm genome (rhythm.ts), pitched in-key by the seeded
 * assigner (pitch.ts). Fully offline and deterministic given the batch seed;
 * plugs into the same queue/dispatch path as the other engines. Riffs are
 * partless melodic lines and always start their own family (no parents).
 */
import type { GenerationBrief, Motif, Note } from '../../types'
import { beatsPerBar } from '../../core/theory'
import { newId } from '../../core/ids'
import type { ValidationResult } from '../../core/validate'
import { buildMotif, hex4, toResult } from '../symbolic'
import { childSeed, mulberry32, pick } from '../symbolic/prng'
import {
  evolveRhythm,
  RIFF_PRESET_NAMES,
  RIFF_PRESETS,
  type RiffPreset,
  type RiffPresetName,
  surprisePreset,
  tiledAccents,
} from './rhythm'
import { assignPitches, type RiffOnset } from './pitch'

export { RIFF_PRESET_NAMES, RIFF_PRESETS, type RiffPresetName } from './rhythm'

/**
 * 'any' rolls a concrete named preset per motif from its seed; 'surprise'
 * synthesizes a brand-new preset per motif (Euclidean accent skeleton +
 * sampled fitness weights) as the seed's first draws.
 */
export type GeneticPresetChoice = RiffPresetName | 'any' | 'surprise'

/**
 * One offline genetic batch honoring the brief's key/mode/tempo/bars/timeSig
 * (texture/rhythm/extra flags don't apply — riffs are partless single lines).
 * Deterministic given (choice, seed): every motif's own seed derives from the
 * batch seed, and for 'any'/'surprise' the preset roll is the seed's first
 * draw(s), so the stored seed reproduces even a synthesized preset.
 */
export function generateGeneticBatch(
  brief: GenerationBrief,
  n: number,
  choice: GeneticPresetChoice,
  seed: number,
): ValidationResult {
  const batchId = newId()
  const motifs: Motif[] = []
  for (let i = 0; i < n; i++) {
    const cs = childSeed(seed, i)
    const rng = mulberry32(cs)
    let presetName: string
    let preset: RiffPreset
    let blurb = ''
    if (choice === 'surprise') {
      const roll = surprisePreset(rng)
      presetName = 'surprise'
      preset = roll.preset
      blurb = ` (${roll.blurb})`
    } else {
      presetName = choice === 'any' ? pick(rng, RIFF_PRESET_NAMES) : choice
      preset = RIFF_PRESETS[presetName as RiffPresetName]
    }
    const { genome, fitness, hits } = evolveRhythm(preset, brief.bars, rng)

    const accents = tiledAccents(preset, brief.bars)
    const onsets: RiffOnset[] = []
    for (let step = 0; step < genome.length; step++) {
      if (genome[step] === 1) onsets.push({ step, accented: accents.has(step) })
    }
    const pitched = assignPitches(onsets, { key: brief.key, mode: brief.mode }, rng)

    const stepDur = beatsPerBar(brief.timeSig) / preset.steps
    const notes: Note[] = onsets.map((o, j) => ({
      pitch: pitched[j].pitch,
      startBeat: o.step * stepDur,
      durationBeats: stepDur,
      velocity: pitched[j].velocity,
    }))

    motifs.push(
      buildMotif({
        name: `Riff ${hex4(cs)}`,
        notes,
        key: brief.key,
        mode: brief.mode,
        bars: brief.bars,
        timeSig: brief.timeSig,
        tempo: brief.tempo,
        conceptId: null,
        rationale: `genetic riff — ${presetName} genome${blurb}, ${hits} hits over ${brief.bars} bars, fitness ${fitness.toFixed(2)}`,
        source: { kind: 'genetic', batchId, seed: cs, preset: presetName, fitness },
      }),
    )
  }
  return toResult(motifs)
}
