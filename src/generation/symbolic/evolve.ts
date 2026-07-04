/**
 * Real multi-generation evolution for the INSTANT tier, after M6(GPT)3:
 * a population seeded from keeper crossovers/mutants plus fresh random walks
 * evolves under tournament selection against the Gaussian fitness, and only
 * the top n mutually-distinct survivors leave. The user's triage rating stays
 * the ultimate fitness — keepers define the gene pool, the score just decides
 * which candidates are worth their ears. Deterministic given one Rng stream.
 */
import type { Mode, Motif, Note } from '../../types'
import { pick, randInt, type Rng } from './prng'
import { CONTOURS, randomWalkNotes, RHYTHMS } from './walk'
import {
  crossover,
  GA_DIVERSITY_FLOOR,
  GA_RATIOS,
  type LineMaterial,
  melodicLine,
  mutateNotes,
} from './genetic'
import { fitnessScore, similarity } from './fitness'

export interface EvolveOptions {
  population: number
  generations: number
  tournamentK: number
  crossoverRate: number
  mutationRate: number
  elite: number
  immigrantsPerGen: number
  /** Survivors more Jaccard-similar than this to an already-picked one are skipped. */
  dedupThreshold: number
}

/** Sized for 2–8-bar lines: ~1.2k fitness evals ≈ tens of ms on the main thread
 * (same envelope as the GENETIC riff engine's synchronous runs). */
export const EVOLVE_DEFAULTS: EvolveOptions = {
  population: 48,
  generations: 24,
  tournamentK: 4,
  crossoverRate: 0.75,
  mutationRate: 0.35,
  elite: 4,
  immigrantsPerGen: 2,
  dedupThreshold: 0.85,
}

export interface EvolveContext {
  key: string
  mode: Mode
  bars: number
  timeSig: string
  tempo: number
}

export interface Individual {
  notes: Note[]
  ctx: EvolveContext
  fitness: number
  /** Distinct keeper ancestors accumulated through crossover/mutation. */
  keeperIds: ReadonlySet<string>
}

export interface EvolveResult {
  picked: Individual[]
  initialBest: number
  finalBest: number
}

export interface PopulationCounts {
  crossover: number
  mutant: number
  fresh: number
}

/** GA_RATIOS applied to a population, with a fresh-immigrant diversity floor. */
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

const NO_KEEPERS: ReadonlySet<string> = new Set()

const material = (ind: Individual): LineMaterial => ({ ...ind.ctx, parts: [], notes: ind.notes })

/** Pick two distinct keepers for a crossover pair. */
function pickPair(rng: Rng, keepers: Motif[]): [Motif, Motif] {
  const ai = randInt(rng, 0, keepers.length - 1)
  let bi = randInt(rng, 0, keepers.length - 2)
  if (bi >= ai) bi++
  return [keepers[ai], keepers[bi]]
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> {
  if (b.size === 0) return a
  if (a.size === 0) return b
  return new Set([...a, ...b])
}

/**
 * Evolve a population against the fitness and return the top `n` survivors,
 * mutually distinct under the similarity threshold (shortfall backfilled with
 * fresh walks so callers always get exactly n).
 */
export function evolvePopulation(
  ctx: EvolveContext,
  keepers: Motif[],
  n: number,
  rng: Rng,
  opts: EvolveOptions = EVOLVE_DEFAULTS,
): EvolveResult {
  const make = (notes: Note[], indCtx: EvolveContext, keeperIds: ReadonlySet<string>): Individual => ({
    notes,
    ctx: indCtx,
    fitness: fitnessScore(notes, indCtx),
    keeperIds,
  })

  const fresh = (): Individual => {
    const contour = pick(rng, CONTOURS)
    const rhythm = pick(rng, RHYTHMS)
    return make(randomWalkNotes({ ...ctx, contour, rhythm }, rng), ctx, NO_KEEPERS)
  }

  const keeperCtx = (k: Motif): EvolveContext => ({
    key: k.key,
    mode: k.mode,
    bars: k.bars,
    timeSig: k.timeSig,
    tempo: k.tempo,
  })

  const mutant = (ind: Individual): Individual =>
    make(mutateNotes(ind.notes, ind.ctx, rng).notes, ind.ctx, ind.keeperIds)

  // --- Seed: keeper crossovers + keeper mutants + fresh walks (GA_RATIOS mix).
  const counts = populationCounts(opts.population, keepers.length)
  let pop: Individual[] = []
  for (let i = 0; i < counts.crossover; i++) {
    const [a, b] = pickPair(rng, keepers)
    const res = crossover(a, b, rng)
    // Too-thin splices (short parents, empty windows) fall back to a fresh walk.
    pop.push(
      res
        ? make(
            res.notes,
            { ...keeperCtx(a), tempo: Math.round((a.tempo + b.tempo) / 2) },
            new Set([a.id, b.id]),
          )
        : fresh(),
    )
  }
  for (let i = 0; i < counts.mutant; i++) {
    const k = pick(rng, keepers)
    pop.push(make(mutateNotes(melodicLine(k), k, rng).notes, keeperCtx(k), new Set([k.id])))
  }
  for (let i = 0; i < counts.fresh; i++) pop.push(fresh())

  const best = (xs: Individual[]) => xs.reduce((m, x) => (x.fitness > m.fitness ? x : m))
  const initialBest = best(pop).fitness

  const tournament = (): Individual => {
    let winner = pop[randInt(rng, 0, pop.length - 1)]
    for (let i = 1; i < opts.tournamentK; i++) {
      const rival = pop[randInt(rng, 0, pop.length - 1)]
      if (rival.fitness > winner.fitness) winner = rival
    }
    return winner
  }

  // --- Evolve: elitism + fresh immigrants + tournament-bred offspring.
  for (let g = 0; g < opts.generations; g++) {
    const next = [...pop].sort((x, y) => y.fitness - x.fitness).slice(0, opts.elite)
    for (let i = 0; i < opts.immigrantsPerGen && next.length < opts.population; i++) {
      next.push(fresh())
    }
    while (next.length < opts.population) {
      const p1 = tournament()
      let child: Individual
      if (rng() < opts.crossoverRate) {
        const p2 = tournament()
        const res = p1 !== p2 ? crossover(material(p1), material(p2), rng) : null
        child = res
          ? make(
              res.notes,
              { ...p1.ctx, tempo: Math.round((p1.ctx.tempo + p2.ctx.tempo) / 2) },
              union(p1.keeperIds, p2.keeperIds),
            )
          : mutant(p1)
        if (rng() < opts.mutationRate) child = mutant(child)
      } else {
        // The non-crossover path always mutates, so no clone floods the pool.
        child = mutant(p1)
      }
      next.push(child)
    }
    pop = next
  }

  // --- Select: best-first, skipping near-duplicates of already-picked takes.
  const sorted = [...pop].sort((x, y) => y.fitness - x.fitness)
  const picked: Individual[] = []
  for (const ind of sorted) {
    if (picked.length >= n) break
    if (picked.some((p) => similarity(p.notes, ind.notes) > opts.dedupThreshold)) continue
    picked.push(ind)
  }
  while (picked.length < n) picked.push(fresh())

  return { picked, initialBest, finalBest: sorted[0].fitness }
}
