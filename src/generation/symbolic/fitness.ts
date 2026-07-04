/**
 * Gaussian multi-feature fitness for short melodic lines, after M6(GPT)3
 * (arXiv 2409.12638): score = Σ wᵢ·exp(−(rᵢ−μᵢ)²/2σᵢ²) / Σ wᵢ over musical
 * features, each with a hand-tuned target μ, tolerance σ, and weight w.
 * Drives the INSTANT tier's internal evolution and ranks NEURAL batches —
 * the user's triage rating stays the final fitness; this only raises the
 * floor of what reaches their ears. Pure and deterministic (no RNG).
 * Features are per-bar-normalized so mixed-length individuals compare fairly.
 */
import type { Mode, Note } from '../../types'
import { beatsPerBar, isInScale, pitchToDegree } from '../../core/theory'
import { EPS } from '../../core/validate'
import { chordAtBeat, chordPitchClasses } from './harmony'

export interface FitnessContext {
  key: string
  mode: Mode
  bars: number
  timeSig: string
  /** Per-bar chord degrees; absent = the chord-anchoring feature is skipped. */
  progression?: readonly number[]
}

export type FitnessFeature =
  | 'notesPerBar'
  | 'uniquePitchesPerBar'
  | 'pitchRange'
  | 'pitchSd'
  | 'stepwiseRatio'
  | 'bigLeapRatio'
  | 'dissonantRatio'
  | 'rhythmicVariety'
  | 'strongBeatCoverage'
  | 'offBeatRatio'
  | 'restRatio'
  | 'repetitionScore'
  | 'tonalAnchor'
  | 'inScaleRatio'
  | 'chordToneRatio'

export interface FeatureTarget {
  mu: number
  sigma: number
  w: number
}

export type TargetTable = Record<FitnessFeature, FeatureTarget>

/** Hand-tuned "good 2–8-bar motif" targets — a code constant, retune freely. */
export const DEFAULT_TARGETS: TargetTable = {
  notesPerBar: { mu: 6, sigma: 2.5, w: 1.0 },
  uniquePitchesPerBar: { mu: 4, sigma: 1.5, w: 1.0 },
  pitchRange: { mu: 12, sigma: 5, w: 1.0 },
  pitchSd: { mu: 3.5, sigma: 1.8, w: 0.7 },
  stepwiseRatio: { mu: 0.65, sigma: 0.18, w: 1.2 },
  bigLeapRatio: { mu: 0, sigma: 0.04, w: 1.0 },
  dissonantRatio: { mu: 0.03, sigma: 0.07, w: 0.8 },
  rhythmicVariety: { mu: 3, sigma: 1.3, w: 0.8 },
  strongBeatCoverage: { mu: 0.85, sigma: 0.2, w: 1.0 },
  offBeatRatio: { mu: 0.25, sigma: 0.15, w: 0.7 },
  restRatio: { mu: 0.15, sigma: 0.12, w: 0.6 },
  repetitionScore: { mu: 0.3, sigma: 0.18, w: 1.0 },
  tonalAnchor: { mu: 1, sigma: 0.4, w: 0.6 },
  inScaleRatio: { mu: 1, sigma: 0.06, w: 0.8 },
  chordToneRatio: { mu: 0.72, sigma: 0.2, w: 1.0 },
}

const GRID = 0.25 // beats per 16th

/** Intervals heard as harsh when leapt melodically (mod 12): tritone, m7/M7. */
const DISSONANT = new Set([6, 10, 11])

/** Degrees a phrase can anchor on (tonic triad). */
const ANCHOR_DEGREES = new Set([0, 2, 4])

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Longest interval n-gram (length ≥ 3) occurring at two start positions. */
function longestRepeat(intervals: number[]): number {
  let best = 0
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      let len = 0
      while (j + len < intervals.length && intervals[i + len] === intervals[j + len]) len++
      if (len > best) best = len
    }
  }
  return best >= 3 ? best : 0
}

/**
 * Feature vector for a note list. A feature is `null` when it cannot be
 * measured in this context (chordToneRatio without a progression, or with no
 * strong-beat onsets to judge) — fitnessScore skips null features AND their
 * weight, so scores without a progression are bit-identical to the
 * pre-progression engine.
 */
export function extractFeatures(
  notes: Note[],
  ctx: FitnessContext,
): Record<FitnessFeature, number | null> {
  const bpb = beatsPerBar(ctx.timeSig)
  const totalBeats = ctx.bars * bpb
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const pitches = sorted.map((n) => n.pitch)

  const perBarUnique: number[] = []
  for (let bar = 0; bar < ctx.bars; bar++) {
    const inBar = sorted.filter(
      (n) => n.startBeat >= bar * bpb - EPS && n.startBeat < (bar + 1) * bpb - EPS,
    )
    perBarUnique.push(new Set(inBar.map((n) => n.pitch)).size)
  }

  const intervals: number[] = []
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i].pitch - sorted[i - 1].pitch)
  const nonZero = intervals.filter((d) => d !== 0)

  const avg = mean(pitches)
  const sd = Math.sqrt(mean(pitches.map((p) => (p - avg) ** 2)))

  // Strong beats: every bar's downbeat, plus the midpoint when the bar splits evenly.
  const strong: number[] = []
  for (let bar = 0; bar < ctx.bars; bar++) {
    strong.push(bar * bpb)
    if (bpb % 2 === 0) strong.push(bar * bpb + bpb / 2)
  }
  const hasOnsetAt = (beat: number) => sorted.some((n) => Math.abs(n.startBeat - beat) < EPS)

  // Rest coverage on the 16th grid.
  const slots = Math.max(1, Math.round(totalBeats / GRID))
  const covered = new Array<boolean>(slots).fill(false)
  for (const n of sorted) {
    const from = Math.max(0, Math.floor(n.startBeat / GRID + EPS))
    const to = Math.min(slots, Math.ceil((n.startBeat + n.durationBeats) / GRID - EPS))
    for (let s = from; s < to; s++) covered[s] = true
  }

  const anchored = (n: Note) => {
    const pos = pitchToDegree(n.pitch, ctx.key, ctx.mode)
    return pos.chromaticOffset === 0 && ANCHOR_DEGREES.has(pos.degree) ? 1 : 0
  }

  // Chord anchoring: share of strong-beat onsets whose pitch class belongs to
  // the bar's chord. Unmeasurable (null) without a progression or when no
  // strong beat carries an onset.
  let chordToneRatio: number | null = null
  if (ctx.progression && ctx.progression.length > 0) {
    const strongOnsets = sorted.filter((n) =>
      strong.some((beat) => Math.abs(n.startBeat - beat) < EPS),
    )
    if (strongOnsets.length > 0) {
      const inChord = strongOnsets.filter((n) => {
        const degree = chordAtBeat(ctx.progression!, n.startBeat, bpb)
        return chordPitchClasses(degree, ctx.key, ctx.mode).includes(((n.pitch % 12) + 12) % 12)
      })
      chordToneRatio = inChord.length / strongOnsets.length
    }
  }

  return {
    notesPerBar: sorted.length / ctx.bars,
    uniquePitchesPerBar: mean(perBarUnique),
    pitchRange: Math.max(...pitches) - Math.min(...pitches),
    pitchSd: sd,
    stepwiseRatio:
      nonZero.length > 0 ? nonZero.filter((d) => Math.abs(d) <= 2).length / nonZero.length : 0,
    bigLeapRatio:
      intervals.length > 0 ? intervals.filter((d) => Math.abs(d) > 12).length / intervals.length : 0,
    dissonantRatio:
      intervals.length > 0
        ? intervals.filter((d) => DISSONANT.has(Math.abs(d) % 12)).length / intervals.length
        : 0,
    rhythmicVariety: new Set(sorted.map((n) => Math.max(1, Math.round(n.durationBeats / GRID))))
      .size,
    strongBeatCoverage: strong.filter(hasOnsetAt).length / strong.length,
    offBeatRatio: sorted.filter((n) => Math.abs(n.startBeat - Math.round(n.startBeat)) > EPS)
      .length / sorted.length,
    restRatio: covered.filter((c) => !c).length / slots,
    repetitionScore: intervals.length > 0 ? longestRepeat(intervals) / intervals.length : 0,
    tonalAnchor: (anchored(sorted[0]) + anchored(sorted[sorted.length - 1])) / 2,
    inScaleRatio: pitches.filter((p) => isInScale(p, ctx.key, ctx.mode)).length / pitches.length,
    chordToneRatio,
  }
}

/** Weighted-Gaussian score in (0, 1]; degenerate lines (<2 notes) score 0. */
export function fitnessScore(
  notes: Note[],
  ctx: FitnessContext,
  targets: TargetTable = DEFAULT_TARGETS,
): number {
  if (notes.length < 2) return 0
  const features = extractFeatures(notes, ctx)
  let sum = 0
  let weight = 0
  for (const name of Object.keys(targets) as FitnessFeature[]) {
    const r = features[name]
    if (r === null) continue // unmeasurable feature: skip it AND its weight
    const { mu, sigma, w } = targets[name]
    sum += w * Math.exp(-((r - mu) ** 2) / (2 * sigma * sigma))
    weight += w
  }
  return sum / weight
}

/** Jaccard similarity over 16th-quantized (start, pitch, duration) events. */
export function similarity(a: Note[], b: Note[]): number {
  const sig = (n: Note) =>
    `${Math.round(n.startBeat / GRID)}:${n.pitch}:${Math.max(1, Math.round(n.durationBeats / GRID))}`
  const sa = new Set(a.map(sig))
  const sb = new Set(b.map(sig))
  if (sa.size === 0 && sb.size === 0) return 1
  let shared = 0
  for (const s of sa) if (sb.has(s)) shared++
  return shared / (sa.size + sb.size - shared)
}
