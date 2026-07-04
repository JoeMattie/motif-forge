/**
 * Mood conditioning for the INSTANT tier, after M6(GPT)3's valence/arousal
 * axes (arXiv 2409.12638): a mood shifts the Gaussian fitness targets, the
 * walk register, and the drum groove density instead of touching any
 * generator internals. Pure, deterministic, no RNG.
 *
 * Hard invariant: a NEUTRAL_MOOD leaves everything bit-identical to the
 * un-conditioned engine — moodTargets(NEUTRAL_MOOD) deep-equals the base
 * table, moodRange(NEUTRAL_MOOD) equals the walk's DEFAULT_RANGE, and
 * moodDensity(0.5) defers to the melody-derived density.
 */
import {
  DEFAULT_TARGETS,
  type FitnessFeature,
  type TargetTable,
} from './fitness'
import { DEFAULT_RANGE } from './walk'
import type { DrumDensity } from './drums'

export interface Mood {
  /** −1 (dark) .. 1 (bright). */
  valence: number
  /** 0 (calm) .. 1 (driven). */
  arousal: number
}

export const NEUTRAL_MOOD: Mood = { valence: 0, arousal: 0.5 }

/** Register the walk may use, in MIDI pitch. */
export interface PitchRange {
  min: number
  max: number
}

/**
 * Per-feature μ shift coefficients: μ' = μ + valence·dv + (arousal−0.5)·2·da.
 * The paper's mapping — brighter/hotter moods want more pitches, wider range,
 * denser and more syncopated rhythm; darker/calmer moods want stepwise,
 * anchored, resty lines. σ and w stay untouched.
 */
const MU_SHIFTS: Partial<Record<FitnessFeature, { dv: number; da: number }>> = {
  uniquePitchesPerBar: { dv: 0.8, da: 0.8 },
  dissonantRatio: { dv: 0, da: -0.02 },
  pitchRange: { dv: 2, da: 2 },
  pitchSd: { dv: 0, da: 1 },
  restRatio: { dv: -0.06, da: -0.08 },
  notesPerBar: { dv: 0, da: 2 },
  rhythmicVariety: { dv: -0.5, da: 0.7 },
  offBeatRatio: { dv: 0, da: 0.1 },
  stepwiseRatio: { dv: -0.1, da: 0 },
  repetitionScore: { dv: 0, da: 0.1 },
  tonalAnchor: { dv: 0, da: -0.3 },
}

/** Features whose targets are ratios and must stay inside [0, 1]. */
const RATIO_FEATURES = new Set<FitnessFeature>([
  'stepwiseRatio',
  'bigLeapRatio',
  'dissonantRatio',
  'strongBeatCoverage',
  'offBeatRatio',
  'restRatio',
  'repetitionScore',
  'tonalAnchor',
  'inScaleRatio',
  'chordToneRatio',
])

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * Shift the fitness targets toward a mood. NEUTRAL_MOOD returns a deep copy
 * that deep-equals `base` — centered knobs are bit-identical to today.
 */
export function moodTargets(mood: Mood, base: TargetTable = DEFAULT_TARGETS): TargetTable {
  const v = clamp(mood.valence, -1, 1)
  const a = (clamp(mood.arousal, 0, 1) - 0.5) * 2
  const out = {} as TargetTable
  for (const name of Object.keys(base) as FitnessFeature[]) {
    const t = base[name]
    const shift = MU_SHIFTS[name]
    const mu = shift ? t.mu + v * shift.dv + a * shift.da : t.mu
    out[name] = {
      ...t,
      mu: RATIO_FEATURES.has(name) ? clamp(mu, 0, 1) : Math.max(0, mu),
    }
  }
  return out
}

/**
 * Shift the walk register with the mood (the paper's "average pitch rises
 * with valence and arousal"), clamped inside the app's hard 36–96 limits.
 */
export function moodRange(mood: Mood, base: PitchRange = DEFAULT_RANGE): PitchRange {
  const v = clamp(mood.valence, -1, 1)
  const a = (clamp(mood.arousal, 0, 1) - 0.5) * 2
  return shiftRange(base, Math.round(3 * v + 4 * a))
}

/** Slide a register by `semitones`, clamped to the hard 36–96 pitch limits. */
export function shiftRange(base: PitchRange, semitones: number): PitchRange {
  return {
    min: clamp(base.min + semitones, 36, 96),
    max: clamp(base.max + semitones, 36, 96),
  }
}

/**
 * Groove density for an arousal level; null means "no opinion" — the caller
 * falls back to the melody-derived densityOf.
 */
export function moodDensity(arousal: number): DrumDensity | null {
  if (arousal <= 0.25) return 'sparse'
  if (arousal >= 0.75) return 'busy'
  return null
}
