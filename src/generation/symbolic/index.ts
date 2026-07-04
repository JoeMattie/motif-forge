/**
 * Tier-1 symbolic generation: fully offline, deterministic batch source that
 * plugs into the same queue/dispatch path as LLM generation. Each batch runs
 * a real GA — a population seeded from the user's kept motifs plus fresh
 * random-walk immigrants evolves against the Gaussian fitness (evolve.ts) and
 * only the top n distinct survivors come back; with nothing kept yet the gene
 * pool is all fresh walks. RHYTHM adds a seeded probabilistic drum part.
 */
import type { GenerationBrief, Mode, Motif, MotifSource, Note, Part } from '../../types'
import { isInScale, MODES } from '../../core/theory'
import { newId } from '../../core/ids'
import type { ValidationResult } from '../../core/validate'
import { childSeed, mulberry32, pick, randInt } from './prng'
import { CONTOURS, randomWalkNotes, RHYTHMS } from './walk'
import { densityOf, drumNotes } from './drums'
import { EVOLVE_DEFAULTS, type EvolveContext, evolvePopulation } from './evolve'

export { keepersOf, KEEPER_MIN_RATING, GA_RATIOS, GA_DIVERSITY_FLOOR, melodicLine, mutateNotes } from './genetic'
export { EVOLVE_DEFAULTS, evolvePopulation, populationCounts, type PopulationCounts } from './evolve'
export { fitnessScore, similarity } from './fitness'

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

/**
 * One offline batch honoring the brief's key/mode/tempo/bars: evolve a
 * population from (keepers, fresh walks) and keep the fittest n distinct
 * survivors. Deterministic given (seed, brief, keepers) — one mulberry32
 * stream drives the whole run, so the batch seed stored on every motif
 * reproduces it. With includeRhythm each survivor gains a seeded drum part.
 */
export function generateSymbolicBatch(
  brief: GenerationBrief,
  n: number,
  keepers: Motif[],
  seed: number,
): ValidationResult {
  const batchId = newId()
  const rng = mulberry32(seed)
  const ctx: EvolveContext = {
    key: brief.key,
    mode: brief.mode,
    bars: brief.bars,
    timeSig: brief.timeSig,
    tempo: brief.tempo,
  }
  // Big asks widen the population so survivors stay distinct after dedup.
  const opts = {
    ...EVOLVE_DEFAULTS,
    population: Math.max(EVOLVE_DEFAULTS.population, Math.min(n * 2, 160)),
  }
  const { picked } = evolvePopulation(ctx, keepers, n, rng, opts)
  const keeperName = new Map(keepers.map((k) => [k.id, k.name]))

  const motifs = picked.map((ind, rank) => {
    const cs = childSeed(seed, rank)
    const fit = ind.fitness
    const parentIds = [...ind.keeperIds].slice(0, 4)
    const isGa = parentIds.length > 0

    let notes = ind.notes
    let parts: Part[] | undefined
    let drumTag = ''
    if (brief.includeRhythm) {
      const density = densityOf(ind.notes, ind.ctx.bars, ind.ctx.timeSig)
      const drums = drumNotes(
        { bars: ind.ctx.bars, timeSig: ind.ctx.timeSig, density },
        mulberry32(childSeed(seed, 0x2000 + rank)),
      )
      parts = [
        { name: 'lead', instrument: 'synth' },
        { name: 'kit', instrument: 'drums' },
      ]
      notes = [
        ...ind.notes.map((x) => ({ ...x, part: 0 })),
        ...drums.map((x) => ({ ...x, part: 1 })),
      ].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
      drumTag = ` · ${density} kit`
    }

    const rationale = isGa
      ? `evolved from ${parentIds.map((id) => `“${keeperName.get(id) ?? id}”`).join(', ')} — fitness ${fit.toFixed(2)}${drumTag}`
      : `evolved random walk — fitness ${fit.toFixed(2)}${drumTag}`
    const source: MotifSource = isGa
      ? {
          kind: 'ga',
          batchId,
          seed,
          op: `evolve p${opts.population} g${opts.generations} #${rank}`,
          parentIds,
          fitness: fit,
        }
      : { kind: 'symbolic', batchId, seed, recipe: `evolved #${rank}`, fitness: fit }

    return buildMotif({
      ...ind.ctx,
      name: `${isGa ? 'Evo' : 'Walk'} ${hex4(cs)}`,
      notes,
      parts,
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
