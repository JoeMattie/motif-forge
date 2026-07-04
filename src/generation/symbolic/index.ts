/**
 * Tier-1 symbolic generation: fully offline, deterministic batch source that
 * plugs into the same queue/dispatch path as LLM generation. Each batch runs
 * a real GA — a population seeded from the user's kept motifs plus fresh
 * random-walk immigrants evolves against the Gaussian fitness (evolve.ts) and
 * only the top n distinct survivors come back; with nothing kept yet the gene
 * pool is all fresh walks. RHYTHM adds a seeded probabilistic drum part.
 */
import type { GenerationBrief, InstantSpec, Mode, Motif, MotifSource, Note, Part, SynthPreset } from '../../types'
import { beatsPerBar, isInScale, MODES } from '../../core/theory'
import { newId } from '../../core/ids'
import type { ValidationResult } from '../../core/validate'
import { childSeed, mulberry32, pick, randInt, type Rng } from './prng'
import { CONTOURS, randomWalkNotes, RHYTHMS } from './walk'
import { densityOf, drumNotes } from './drums'
import { EVOLVE_DEFAULTS, type EvolveContext, type EvolveTuning, evolvePopulation } from './evolve'
import { type Mood, moodDensity, moodRange, moodTargets, NEUTRAL_MOOD, shiftRange } from './mood'
import {
  bassNotes,
  chordProgressionNotes,
  crossPartScore,
  harmonizeLine,
  padNotes,
  progressionFor,
  progressionLabel,
} from './harmony'

export { keepersOf, KEEPER_MIN_RATING, GA_RATIOS, GA_DIVERSITY_FLOOR, melodicLine, mutateNotes } from './genetic'
export { EVOLVE_DEFAULTS, evolvePopulation, populationCounts, type PopulationCounts } from './evolve'
export { fitnessScore, similarity } from './fitness'
export { type Mood, moodDensity, moodRange, moodTargets, NEUTRAL_MOOD } from './mood'
export { parseInstantPlan } from './plan'

/** A random 32-bit batch seed (stored per motif so any result is reproducible). */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0
}

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export interface MotifFields {
  name: string
  notes: Note[]
  parts?: Part[]
  key: string
  mode: Mode
  bars: number
  timeSig: string
  tempo: number
  conceptId: string | null
  rationale: string
  source: MotifSource
}

export function buildMotif(f: MotifFields): Motif {
  const parts = f.parts ?? [] // partless melodic bones play on the transport sound
  const drumParts = new Set(parts.flatMap((p, i) => (p.instrument === 'drums' ? [i] : [])))
  return {
    id: newId(),
    name: f.name,
    notes: f.notes,
    parts,
    key: f.key,
    mode: f.mode,
    bars: f.bars,
    timeSig: f.timeSig,
    tempo: f.tempo,
    conceptId: f.conceptId,
    rating: 0,
    discarded: false,
    scaleWarning: f.notes.some(
      (n) => !drumParts.has(n.part ?? 0) && !isInScale(n.pitch, f.key, f.mode),
    ),
    rationale: f.rationale,
    createdAt: Date.now(),
    source: f.source,
  }
}

export const hex4 = (seed: number) => (seed >>> 0).toString(16).padStart(8, '0').slice(0, 4)

export function toResult(motifs: Motif[]): ValidationResult {
  return {
    valid: motifs,
    droppedCount: 0,
    scaleWarningCount: motifs.filter((m) => m.scaleWarning).length,
    errors: [],
  }
}

/** Walk-register shift for the planner's coarse register request. */
const REGISTER_SHIFT: Record<NonNullable<InstantSpec['register']>, number> = {
  low: -7,
  mid: 0,
  high: 7,
}

/** Plain but warm patch for the scaffold's bass part. */
const BASS_PRESET: SynthPreset = {
  oscillator: 'triangle',
  envelope: { attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.2 },
}

/** Bass takes auditioned per survivor; the most consonant one wins. */
const BASS_TAKES = 3

/**
 * CHORDS voicing: each motif IS a seeded chord progression — no melody, no GA
 * (the fitness is melodic; interval features over vertical stacks would be
 * noise). One mulberry32 per motif like generateGeneticBatch, so (seed, brief)
 * reproduces the batch. CHORDS+rhythm keeps 4-note 7ths: with no melody voice
 * the worst case is 4 chord tones + 4 coinciding drum hits = the 8-voice cap.
 */
function generateChordBatch(brief: GenerationBrief, n: number, seed: number): ValidationResult {
  const batchId = newId()
  const motifs: Motif[] = []
  for (let i = 0; i < n; i++) {
    const cs = childSeed(seed, i)
    const { notes: chordNotes, segments } = chordProgressionNotes(
      { key: brief.key, mode: brief.mode, bars: brief.bars, timeSig: brief.timeSig },
      mulberry32(cs),
    )
    const label = progressionLabel(segments, brief.key, brief.mode)

    const parts: Part[] = [{ name: 'chords', instrument: 'synth' }]
    let notes = chordNotes.map((x) => ({ ...x, part: 0 }))
    let drumTag = ''
    if (brief.includeRhythm) {
      // Groove density reads the harmonic rhythm: one onset per strike, not
      // one per stacked chord tone.
      const onsets = [...new Set(chordNotes.map((x) => x.startBeat))].map((startBeat) => ({
        pitch: 60,
        startBeat,
        durationBeats: 1,
        velocity: 80,
      }))
      const density = densityOf(onsets, brief.bars, brief.timeSig)
      const drums = drumNotes(
        { bars: brief.bars, timeSig: brief.timeSig, density },
        mulberry32(childSeed(seed, 0x2000 + i)),
      )
      parts.push({ name: 'kit', instrument: 'drums' })
      notes = [...notes, ...drums.map((x) => ({ ...x, part: 1 }))].sort(
        (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch,
      )
      drumTag = ` · ${density} kit`
    }

    motifs.push(
      buildMotif({
        name: `Prog ${hex4(cs)}`,
        notes,
        parts,
        key: brief.key,
        mode: brief.mode,
        bars: brief.bars,
        timeSig: brief.timeSig,
        tempo: brief.tempo,
        conceptId: null,
        rationale: `chord progression ${label}${drumTag}`,
        source: { kind: 'symbolic', batchId, seed, recipe: label, voicing: 'chords' },
      }),
    )
  }
  return toResult(motifs)
}

/**
 * One offline batch honoring the brief's key/mode/tempo/bars: evolve a
 * population from (keepers, fresh walks) and keep the fittest n distinct
 * survivors. Deterministic given (seed, brief, keepers, spec) — one
 * mulberry32 stream drives the whole run, so the batch seed + spec stored on
 * every motif reproduce it. The optional spec (MOOD/ENERGY knobs via
 * brief.mood, or a Claude-planned InstantSpec) shifts fitness targets, walk
 * register, template weights, and the drum groove. With includeRhythm each
 * survivor gains a seeded drum part. With BOTH voicing each gains a
 * harmonized chord part (its own childSeed stream, so a seed's lead line is
 * bit-identical whichever way the switch sits); with extraInstruments it
 * gains the chord scaffold instead — a seeded bass line (best of BASS_TAKES
 * by inter-track consonance) and a sustained pad following the batch
 * progression. BOTH wins when the two overlap: the harmonized chords part
 * already fills the harmony role, and stacking the scaffold on top would
 * blow the 8-voice cap. CHORDS voicing bypasses the GA entirely
 * (generateChordBatch).
 */
export function generateSymbolicBatch(
  brief: GenerationBrief,
  n: number,
  keepers: Motif[],
  seed: number,
  spec?: InstantSpec,
): ValidationResult {
  if (brief.voicing === 'chords') return generateChordBatch(brief, n, seed)
  const both = brief.voicing === 'both'
  const batchId = newId()
  const rng = mulberry32(seed)
  const mood: Mood = {
    valence: spec?.valence ?? brief.mood?.valence ?? NEUTRAL_MOOD.valence,
    arousal: spec?.arousal ?? brief.mood?.arousal ?? NEUTRAL_MOOD.arousal,
  }
  // Always draw the progression from the main stream — even when the spec
  // supplies one — so replaying with the stored (resolved) spec consumes the
  // stream identically to the original run.
  const drawn = progressionFor(brief.bars, rng)
  const progression =
    spec?.progression && spec.progression.length > 0 ? spec.progression : drawn
  const ctx: EvolveContext = {
    key: brief.key,
    mode: brief.mode,
    bars: brief.bars,
    timeSig: brief.timeSig,
    tempo: brief.tempo,
    progression,
  }
  const tuning: EvolveTuning = {
    targets: moodTargets(mood),
    range: shiftRange(moodRange(mood), REGISTER_SHIFT[spec?.register ?? 'mid']),
    contourWeights: spec?.contourWeights,
    rhythmWeights: spec?.rhythmWeights,
  }
  // The resolved spec persisted on every motif: replaying (seed, brief,
  // keepers, source.spec) reproduces the batch without re-planning.
  const resolvedSpec: InstantSpec = {
    ...(spec ?? {}),
    ...(mood.valence !== NEUTRAL_MOOD.valence ? { valence: mood.valence } : {}),
    ...(mood.arousal !== NEUTRAL_MOOD.arousal ? { arousal: mood.arousal } : {}),
    progression,
  }
  // Big asks widen the population so survivors stay distinct after dedup.
  const opts = {
    ...EVOLVE_DEFAULTS,
    population: Math.max(EVOLVE_DEFAULTS.population, Math.min(n * 2, 160)),
  }
  const { picked } = evolvePopulation(ctx, keepers, n, rng, opts, tuning)
  const keeperName = new Map(keepers.map((k) => [k.id, k.name]))

  const motifs = picked.map((ind, rank) => {
    const cs = childSeed(seed, rank)
    const fit = ind.fitness
    const parentIds = [...ind.keeperIds].slice(0, 4)
    const isGa = parentIds.length > 0

    // Assemble the part stack by construction (INSTANT bypasses validateBatch):
    // lead stays part 0 (melodicLine/bay/crossover depend on it); chord, bass,
    // and pad layers stay inside pitch 36–96 under a mono lead.
    const parts: Part[] = [{ name: 'lead', instrument: 'synth' }]
    const layers: Note[][] = [ind.notes]
    const tags: string[] = []

    if (both) {
      // BOTH: harmonize the survivor's line into a chord accompaniment part.
      // Voice-cap rule: with a melody part AND a drums part in play, triads
      // only (1 melody + 3 chord tones + 4 coinciding drum hits = the 8-voice
      // cap); without drums the 7ths fit (1 + 4 <= 8).
      const chords = harmonizeLine(
        ind.notes,
        {
          key: ind.ctx.key,
          mode: ind.ctx.mode,
          bars: ind.ctx.bars,
          timeSig: ind.ctx.timeSig,
          maxVoices: brief.includeRhythm ? 3 : 4,
        },
        mulberry32(childSeed(seed, 0x3000 + rank)),
      )
      parts.push({ name: 'chords', instrument: 'synth' })
      layers.push(chords.notes)
      tags.push(progressionLabel(chords.segments, ind.ctx.key, ind.ctx.mode))
    } else if (brief.extraInstruments) {
      // EXTRA scaffold — skipped under BOTH, whose chords part already fills
      // the harmony role (stacking both would blow the 8-voice cap).
      const harmonyCtx = {
        bars: ind.ctx.bars,
        timeSig: ind.ctx.timeSig,
        key: ind.ctx.key,
        mode: ind.ctx.mode,
        energy: mood.arousal,
      }
      const totalBeats = ind.ctx.bars * beatsPerBar(ind.ctx.timeSig)
      let bass: Note[] = []
      let bestScore = -Infinity
      for (let k = 0; k < BASS_TAKES; k++) {
        const bassRng: Rng = mulberry32((childSeed(seed, 0x3000 + rank) + k) >>> 0)
        const take = bassNotes(progression, harmonyCtx, bassRng)
        const score = crossPartScore(ind.notes, take, totalBeats)
        if (score > bestScore) {
          bestScore = score
          bass = take
        }
      }
      parts.push({ name: 'bass', instrument: 'synth', preset: BASS_PRESET })
      layers.push(bass)
      parts.push({ name: 'pad', instrument: 'strings' })
      layers.push(padNotes(progression, harmonyCtx))
      tags.push('chord scaffold')
    }

    if (brief.includeRhythm) {
      const density =
        spec?.density ??
        moodDensity(mood.arousal) ??
        densityOf(ind.notes, ind.ctx.bars, ind.ctx.timeSig)
      const drums = drumNotes(
        {
          bars: ind.ctx.bars,
          timeSig: ind.ctx.timeSig,
          density,
          energy: mood.arousal,
        },
        mulberry32(childSeed(seed, 0x2000 + rank)),
      )
      parts.push({ name: 'kit', instrument: 'drums' })
      layers.push(drums)
      tags.push(`${density} kit`)
    }

    const multiPart = parts.length > 1
    const notes = multiPart
      ? layers
          .flatMap((layer, part) => layer.map((x) => ({ ...x, part })))
          .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
      : ind.notes
    const tag = tags.length > 0 ? ` · ${tags.join(' · ')}` : ''

    const rationale = isGa
      ? `evolved from ${parentIds.map((id) => `“${keeperName.get(id) ?? id}”`).join(', ')} — fitness ${fit.toFixed(2)}${tag}`
      : `evolved random walk — fitness ${fit.toFixed(2)}${tag}`
    const source: MotifSource = isGa
      ? {
          kind: 'ga',
          batchId,
          seed,
          op: `evolve p${opts.population} g${opts.generations} #${rank}`,
          parentIds,
          fitness: fit,
          ...(both ? { voicing: 'both' as const } : {}),
          spec: resolvedSpec,
        }
      : {
          kind: 'symbolic',
          batchId,
          seed,
          recipe: `evolved #${rank}`,
          fitness: fit,
          ...(both ? { voicing: 'both' as const } : {}),
          spec: resolvedSpec,
        }

    return buildMotif({
      ...ind.ctx,
      name: `${isGa ? 'Evo' : 'Walk'} ${hex4(cs)}`,
      notes,
      parts: multiPart ? parts : undefined,
      conceptId: null,
      rationale,
      source,
    })
  })
  return toResult(motifs)
}

/** Free-rein offline batch: key/mode/tempo/bars rolled per motif. */
export function generateSymbolicSurprise(n: number, seed: number): ValidationResult {
  const batchId = newId()
  const motifs: Motif[] = []
  for (let i = 0; i < n; i++) {
    const cs = childSeed(seed, i)
    const rng = mulberry32(cs)
    const ctx = {
      key: pick(rng, KEYS),
      mode: pick(rng, MODES),
      bars: pick(rng, [2, 4, 8]),
      timeSig: '4/4',
      tempo: randInt(rng, 70, 170),
    }
    // Reuse the same rng so the surprise roll is part of the motif's seed story.
    const contour = pick(rng, CONTOURS)
    const rhythm = pick(rng, RHYTHMS)
    const notes = randomWalkNotes({ ...ctx, contour, rhythm }, rng)
    motifs.push(
      buildMotif({
        ...ctx,
        name: `Walk ${hex4(cs)}`,
        notes,
        conceptId: null,
        rationale: `surprise random walk — ${ctx.key} ${ctx.mode}, ${contour} contour, ${rhythm} rhythm`,
        source: { kind: 'symbolic', batchId, seed: cs, recipe: `${contour}/${rhythm}` },
      }),
    )
  }
  return toResult(motifs)
}
