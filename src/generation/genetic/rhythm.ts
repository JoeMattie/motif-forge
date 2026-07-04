/**
 * GENETIC engine rhythm core — a faithful port of jporpha/ga-riffs: a fitness-
 * driven GA evolving binary onset genomes (1 = hit on a step) with tournament
 * selection, elitism, single-point crossover, and bit-flip mutation. Extended
 * to multi-bar motifs by tiling the preset's accents per bar and scaling the
 * density target; all randomness comes from an injected Rng so the stored seed
 * reproduces the riff exactly.
 */
import { randInt, type Rng, uniform } from '../symbolic/prng'

export type Genome = number[] // 0 | 1 per step

export type RiffPresetName = 'techno' | 'organic' | 'tribal'

export const RIFF_PRESET_NAMES: readonly RiffPresetName[] = ['techno', 'organic', 'tribal']

export interface RiffPreset {
  steps: number // steps per bar (16 = 16th grid, 12 = 8th-note triplets)
  targetHits: number // desired onsets per bar
  accents: number[] // strong-beat step indices within one bar
  syncOpty: number // appetite for off-beat hits
  longRunPenalty: number // per run of >=4 consecutive hits
  densityW: number
  strongW: number
  syncW: number
  varW: number
  repeatW: number // reward for bars echoing bar 0 (loopiness); 0 = through-composed
}

export const RIFF_PRESETS: Record<RiffPresetName, RiffPreset> = {
  techno: {
    steps: 16,
    targetHits: 6,
    accents: [0, 4, 8, 12],
    syncOpty: 0.5,
    longRunPenalty: 0.3,
    densityW: 2.0,
    strongW: 1.6,
    syncW: 1.2,
    varW: 1.2,
    repeatW: 0, // the shipped presets predate this term; 0 keeps their old seeds reproducible
  },
  organic: {
    steps: 12,
    targetHits: 5,
    accents: [0, 3, 6, 9],
    syncOpty: 0.6,
    longRunPenalty: 0.25,
    densityW: 1.8,
    strongW: 1.3,
    syncW: 1.4,
    varW: 1.3,
    repeatW: 0,
  },
  tribal: {
    steps: 16,
    targetHits: 8,
    accents: [0, 8],
    syncOpty: 0.7,
    longRunPenalty: 0.2,
    densityW: 1.7,
    strongW: 1.1,
    syncW: 1.5,
    varW: 1.4,
    repeatW: 0,
  },
}

export const POP = 120
export const GENS = 200
export const ELITE = 4
export const TOURNAMENT_K = 3
export const CROSSOVER_RATE = 0.9
export const MUTATION_RATE = 0.05
export const EUCLID_SEED_FRACTION = 0.25

/** Bjorklund's algorithm: `pulses` onsets spread maximally evenly over `steps`. */
export function euclid(steps: number, pulses: number): Genome {
  pulses = Math.min(pulses, steps)
  if (pulses <= 0) return new Array(steps).fill(0)
  const pattern: number[] = []
  const counts: number[] = []
  const remainders: number[] = [pulses]
  let divisor = steps - pulses
  let level = 0
  while (true) {
    counts.push(Math.floor(divisor / remainders[level]))
    remainders.push(divisor % remainders[level])
    divisor = remainders[level]
    level += 1
    if (remainders[level] <= 1) break
  }
  counts.push(divisor)
  const build = (l: number): void => {
    if (l === -1) pattern.push(0)
    else if (l === -2) pattern.push(1)
    else {
      for (let i = 0; i < counts[l]; i++) build(l - 1)
      if (remainders[l] !== 0) build(l - 2)
    }
  }
  build(level)
  if (pattern.length > steps) return pattern.slice(0, steps)
  if (pattern.length < steps) return pattern.concat(new Array(steps - pattern.length).fill(0))
  return pattern
}

/** The preset's per-bar accents tiled across the whole multi-bar genome. */
export function tiledAccents(preset: RiffPreset, bars: number): Set<number> {
  const out = new Set<number>()
  for (let bar = 0; bar < bars; bar++) {
    for (const a of preset.accents) out.add(bar * preset.steps + a)
  }
  return out
}

const countOnes = (g: Genome) => g.reduce((a, b) => a + b, 0)

function runLengths(g: Genome): number[] {
  const lens: number[] = []
  let run = 0
  for (const bit of g) {
    if (bit === 1) run++
    else if (run > 0) {
      lens.push(run)
      run = 0
    }
  }
  if (run > 0) lens.push(run)
  return lens
}

function interOnsetIntervals(g: Genome): number[] {
  const res: number[] = []
  let prev = -1
  for (let i = 0; i < g.length; i++) {
    if (g[i] !== 1) continue
    if (prev >= 0) res.push(i - prev)
    prev = i
  }
  return res
}

/** Mean per-bar bitwise similarity to bar 0 (1 = every bar repeats bar 0). */
export function barSimilarity(genome: Genome, steps: number): number {
  const bars = Math.floor(genome.length / steps)
  if (bars < 2) return 1
  let sum = 0
  for (let bar = 1; bar < bars; bar++) {
    let same = 0
    for (let i = 0; i < steps; i++) if (genome[bar * steps + i] === genome[i]) same++
    sum += same / steps
  }
  return sum / (bars - 1)
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length
}

/** ga-riffs fitness over the full multi-bar genome (accents tiled, target scaled). */
export function fitness(genome: Genome, preset: RiffPreset, bars: number): number {
  const target = preset.targetHits * bars
  const hits = countOnes(genome)
  const densityScore = Math.max(0, 1 - Math.abs(hits - target) / Math.max(1, target))

  const accents = tiledAccents(preset, bars)
  let strong = 0
  for (const i of accents) if (genome[i] === 1) strong++
  const strongScore = accents.size > 0 ? strong / accents.size : 0

  let offbeat = 0
  for (let i = 0; i < genome.length; i++) if (genome[i] === 1 && i % 2 === 1) offbeat++
  const syncopScore = Math.min(1, (hits > 0 ? offbeat / hits : 0) + preset.syncOpty * 0.15)

  const longRuns = runLengths(genome).filter((r) => r >= 4).length
  const varietyScore = Math.min(1, variance(interOnsetIntervals(genome)) / 2)
  const emptinessPenalty = hits === 0 ? 1.0 : hits === 1 ? 0.4 : 0

  return (
    preset.densityW * densityScore +
    preset.strongW * strongScore +
    preset.syncW * syncopScore +
    preset.varW * varietyScore +
    preset.repeatW * barSimilarity(genome, preset.steps) -
    (preset.longRunPenalty * longRuns + emptinessPenalty)
  )
}

export interface SurpriseRoll {
  preset: RiffPreset
  blurb: string // human-readable roll summary for the motif rationale
}

/**
 * Synthesize a whole preset from the rng. Called before evolveRhythm, so the
 * roll is the seed's first draws and the stored seed reproduces the riff —
 * but retuning these sampling bands orphans old surprise seeds, exactly like
 * changing the GA constants would. Accents come from a randomly rotated
 * Euclidean skeleton, so rolls land on clave/tresillo-family feels rather
 * than arbitrary step sets, and repeatW is always positive so a surprise
 * groove reads as a loop, not parameter noise.
 */
export function surprisePreset(rng: Rng): SurpriseRoll {
  const steps = rng() < 0.75 ? 16 : 12
  const pulses = randInt(rng, 2, 5)
  const rot = randInt(rng, 0, steps - 1)
  const skeleton = euclid(steps, pulses)
  const accents: number[] = []
  for (let i = 0; i < steps; i++) if (skeleton[(i + rot) % steps] === 1) accents.push(i)
  const preset: RiffPreset = {
    steps,
    targetHits: randInt(rng, 4, Math.round(steps * 0.6)),
    accents,
    syncOpty: uniform(rng, 0.3, 0.8),
    longRunPenalty: uniform(rng, 0.15, 0.35),
    densityW: uniform(rng, 1.5, 2.2),
    strongW: uniform(rng, 0.8, 1.8),
    syncW: uniform(rng, 1.0, 1.7),
    varW: uniform(rng, 1.0, 1.5),
    repeatW: uniform(rng, 0.8, 1.8),
  }
  return {
    preset,
    blurb: `${steps} steps, euclid(${steps},${pulses}) accents rot ${rot}, ${preset.targetHits} hits/bar`,
  }
}

/** One random bar per the reference's init: 2..min(10,steps) hits at random steps. */
function randomBar(steps: number, rng: Rng): Genome {
  const bar = new Array(steps).fill(0)
  const hits = randInt(rng, 2, Math.min(10, steps))
  for (let i = 0; i < hits; i++) bar[randInt(rng, 0, steps - 1)] = 1
  return bar
}

/** A euclid-seeded bar: near-target pulse count, randomly rotated. */
function euclidBar(preset: RiffPreset, rng: Rng): Genome {
  const pulses = Math.max(1, Math.min(preset.steps, preset.targetHits + randInt(rng, -1, 1)))
  const base = euclid(preset.steps, pulses)
  const rot = randInt(rng, 0, preset.steps - 1)
  return base.map((_, i) => base[(i + rot) % preset.steps])
}

/** Exported for tests: evolveRhythm's initial population reconstructs from the same rng. */
export function initialGenome(
  preset: RiffPreset,
  bars: number,
  euclidSeeded: boolean,
  rng: Rng,
): Genome {
  const genome: Genome = []
  for (let bar = 0; bar < bars; bar++) {
    genome.push(...(euclidSeeded ? euclidBar(preset, rng) : randomBar(preset.steps, rng)))
  }
  return genome
}

interface Individual {
  genome: Genome
  fit: number
}

function tournamentSelect(pop: Individual[], rng: Rng): Genome {
  let best: Individual | null = null
  for (let i = 0; i < TOURNAMENT_K; i++) {
    const c = pop[randInt(rng, 0, pop.length - 1)]
    if (!best || c.fit > best.fit) best = c
  }
  return best!.genome
}

function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const point = randInt(rng, 1, a.length - 2)
  return a.slice(0, point).concat(b.slice(point))
}

function mutate(g: Genome, rng: Rng): Genome {
  return g.map((bit) => (rng() < MUTATION_RATE ? 1 - bit : bit))
}

export interface EvolveResult {
  genome: Genome
  fitness: number
  hits: number
}

/** Evolve one riff genome: POP individuals over GENS generations, elitism ELITE. */
export function evolveRhythm(preset: RiffPreset, bars: number, rng: Rng): EvolveResult {
  const score = (g: Genome) => fitness(g, preset, bars)
  const euclidCount = Math.round(POP * EUCLID_SEED_FRACTION)
  let population: Individual[] = []
  for (let i = 0; i < POP; i++) {
    const genome = initialGenome(preset, bars, i < euclidCount, rng)
    population.push({ genome, fit: score(genome) })
  }

  for (let gen = 0; gen < GENS; gen++) {
    population.sort((x, y) => y.fit - x.fit)
    const next: Individual[] = population
      .slice(0, ELITE)
      .map((ind) => ({ genome: ind.genome.slice(), fit: ind.fit }))
    while (next.length < POP) {
      const p1 = tournamentSelect(population, rng)
      const p2 = tournamentSelect(population, rng)
      const child = mutate(rng() < CROSSOVER_RATE ? crossover(p1, p2, rng) : p1.slice(), rng)
      next.push({ genome: child, fit: score(child) })
    }
    population = next
  }

  population.sort((x, y) => y.fit - x.fit)
  const best = population[0]
  return { genome: best.genome, fitness: best.fit, hits: countOnes(best.genome) }
}
