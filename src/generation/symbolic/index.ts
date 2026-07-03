/**
 * Tier-1 symbolic generation: fully offline, deterministic batch source that
 * plugs into the same queue/dispatch path as LLM generation. A batch mixes
 * crossover children and mutants of user-kept motifs with fresh random-walk
 * immigrants (ratios in GA_RATIOS); with nothing kept yet, it's all fresh.
 */
import type { GenerationBrief, Mode, Motif, MotifSource, Note } from '../../types'
import { isInScale, MODES } from '../../core/theory'
import { newId } from '../../core/ids'
import type { ValidationResult } from '../../core/validate'
import { childSeed, mulberry32, pick, randInt, type Rng } from './prng'
import { CONTOURS, randomWalkNotes, RHYTHMS } from './walk'
import { crossover, GA_DIVERSITY_FLOOR, GA_RATIOS, mutateLine } from './genetic'

export { keepersOf, KEEPER_MIN_RATING, GA_RATIOS, GA_DIVERSITY_FLOOR } from './genetic'

/** A random 32-bit batch seed (stored per motif so any result is reproducible). */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0
}

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export interface PopulationCounts {
  crossover: number
  mutant: number
  fresh: number
}

/** GA_RATIOS applied to a batch, with a fresh-immigrant diversity floor. */
export function populationCounts(n: number, keeperCount: number): PopulationCounts {
  if (keeperCount === 0) return { crossover: 0, mutant: 0, fresh: n }
  let crossoverN = keeperCount >= 2 ? Math.round(n * GA_RATIOS.crossover) : 0
  let mutantN = Math.round(n * GA_RATIOS.mutant)
  const minFresh = Math.max(1, Math.floor(n * GA_DIVERSITY_FLOOR))
  while (n - crossoverN - mutantN < minFresh) {
    if (mutantN >= crossoverN && mutantN > 0) mutantN--
    else if (crossoverN > 0) crossoverN--
    else break
  }
  return { crossover: crossoverN, mutant: mutantN, fresh: n - crossoverN - mutantN }
}

interface MotifFields {
  name: string
  notes: Note[]
  key: string
  mode: Mode
  bars: number
  timeSig: string
  tempo: number
  conceptId: string | null
  rationale: string
  source: MotifSource
}

function buildMotif(f: MotifFields): Motif {
  return {
    id: newId(),
    name: f.name,
    notes: f.notes,
    parts: [], // symbolic motifs are partless melodic bones (transport sound)
    key: f.key,
    mode: f.mode,
    bars: f.bars,
    timeSig: f.timeSig,
    tempo: f.tempo,
    conceptId: f.conceptId,
    rating: 0,
    discarded: false,
    scaleWarning: f.notes.some((n) => !isInScale(n.pitch, f.key, f.mode)),
    rationale: f.rationale,
    createdAt: Date.now(),
    source: f.source,
  }
}

const hex4 = (seed: number) => (seed >>> 0).toString(16).padStart(8, '0').slice(0, 4)
const firstWord = (name: string) => name.split(/[\s(]/)[0] || name

interface FreshContext {
  key: string
  mode: Mode
  bars: number
  timeSig: string
  tempo: number
}

function freshMotif(ctx: FreshContext, seed: number, batchId: string): Motif {
  const rng = mulberry32(seed)
  const contour = pick(rng, CONTOURS)
  const rhythm = pick(rng, RHYTHMS)
  const notes = randomWalkNotes({ ...ctx, contour, rhythm }, rng)
  return buildMotif({
    ...ctx,
    name: `Walk ${hex4(seed)}`,
    notes,
    conceptId: null,
    rationale: `constrained random walk — ${contour} contour, ${rhythm} rhythm`,
    source: { kind: 'symbolic', batchId, seed, recipe: `${contour}/${rhythm}` },
  })
}

function mutantMotif(parent: Motif, seed: number, batchId: string): Motif {
  const { notes, ops } = mutateLine(parent, mulberry32(seed))
  return buildMotif({
    name: `${parent.name} evo`,
    notes,
    key: parent.key,
    mode: parent.mode,
    bars: parent.bars,
    timeSig: parent.timeSig,
    tempo: parent.tempo,
    conceptId: parent.conceptId,
    rationale: `evolved from “${parent.name}”: ${ops.join(', ')}`,
    source: { kind: 'ga', batchId, seed, op: ops.join('+'), parentIds: [parent.id] },
  })
}

function crossoverMotif(a: Motif, b: Motif, seed: number, batchId: string): Motif | null {
  const res = crossover(a, b, mulberry32(seed))
  if (!res) return null
  return buildMotif({
    name: `${firstWord(a.name)} × ${firstWord(b.name)}`,
    notes: res.notes,
    key: a.key,
    mode: a.mode,
    bars: a.bars,
    timeSig: a.timeSig,
    tempo: Math.round((a.tempo + b.tempo) / 2),
    conceptId: a.conceptId ?? b.conceptId,
    rationale: `crossover of “${a.name}” × “${b.name}” at bar ${res.cutBar}`,
    source: { kind: 'ga', batchId, seed, op: `crossover@bar${res.cutBar}`, parentIds: [a.id, b.id] },
  })
}

function toResult(motifs: Motif[]): ValidationResult {
  return {
    valid: motifs,
    droppedCount: 0,
    scaleWarningCount: motifs.filter((m) => m.scaleWarning).length,
    errors: [],
  }
}

/** Pick two distinct keepers for a crossover pair. */
function pickPair(rng: Rng, keepers: Motif[]): [Motif, Motif] {
  const ai = randInt(rng, 0, keepers.length - 1)
  let bi = randInt(rng, 0, keepers.length - 2)
  if (bi >= ai) bi++
  return [keepers[ai], keepers[bi]]
}

/**
 * One offline batch honoring the brief's key/mode/tempo/bars. Deterministic
 * given (seed, keepers): every motif's own seed derives from the batch seed.
 */
export function generateSymbolicBatch(
  brief: GenerationBrief,
  n: number,
  keepers: Motif[],
  seed: number,
): ValidationResult {
  const batchId = newId()
  const rng = mulberry32(seed)
  const counts = populationCounts(n, keepers.length)
  const ctx: FreshContext = {
    key: brief.key,
    mode: brief.mode,
    bars: brief.bars,
    timeSig: brief.timeSig,
    tempo: brief.tempo,
  }
  const motifs: Motif[] = []
  for (let i = 0; i < n; i++) {
    const cs = childSeed(seed, i)
    if (i < counts.crossover) {
      const [a, b] = pickPair(rng, keepers)
      // Too-thin splices (short parents, empty windows) fall back to a fresh walk.
      motifs.push(crossoverMotif(a, b, cs, batchId) ?? freshMotif(ctx, cs, batchId))
    } else if (i < counts.crossover + counts.mutant) {
      motifs.push(mutantMotif(pick(rng, keepers), cs, batchId))
    } else {
      motifs.push(freshMotif(ctx, cs, batchId))
    }
  }
  return toResult(motifs)
}

/** Free-rein offline batch: key/mode/tempo/bars rolled per motif. */
export function generateSymbolicSurprise(n: number, seed: number): ValidationResult {
  const batchId = newId()
  const motifs: Motif[] = []
  for (let i = 0; i < n; i++) {
    const cs = childSeed(seed, i)
    const rng = mulberry32(cs)
    const ctx: FreshContext = {
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
