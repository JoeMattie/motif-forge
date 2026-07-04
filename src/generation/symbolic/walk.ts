/**
 * Tier-1 constrained random walk: an offline, deterministic melody generator.
 * Pitch moves by scale degrees only (always in-key), pulled toward a contour
 * template, with leap-recovery — any leap wider than a third resolves by a
 * step in the opposite direction. Rhythm comes from per-beat archetype cells
 * on a 16th grid.
 */
import type { Mode, Note } from '../../types'
import { beatsPerBar, degreeToPitch, keyToPitchClass } from '../../core/theory'
import { pickWeighted, randInt, type Rng } from './prng'

export const CONTOURS = ['arch', 'ascend', 'descend', 'zigzag', 'flat'] as const
export type Contour = (typeof CONTOURS)[number]

export const RHYTHMS = ['straight', 'dotted', 'syncopated', 'sparse'] as const
export type RhythmArchetype = (typeof RHYTHMS)[number]

export interface WalkParams {
  key: string
  mode: Mode
  bars: number
  timeSig: string
  contour: Contour
  rhythm: RhythmArchetype
  /** Melodic register clamp (MIDI); the walk reflects off the edges. */
  range?: { min: number; max: number }
}

/** F3–D6: a comfortable lead register inside the app's hard 36–96 limits. */
export const DEFAULT_RANGE = { min: 53, max: 86 }

const GRID = 0.25 // beats per 16th

/** One beat-aligned rhythm figure: [offset, duration] pairs in 16ths. */
interface Cell {
  steps: [number, number][]
  beats: number // beats consumed (1 or 2)
}

interface CellTable {
  base: Cell[]
  variants: Cell[]
  restChance: number
}

const CELLS: Record<RhythmArchetype, CellTable> = {
  straight: {
    base: [
      { steps: [[0, 2], [2, 2]], beats: 1 },
      { steps: [[0, 4]], beats: 1 },
    ],
    variants: [
      { steps: [[0, 2], [2, 1], [3, 1]], beats: 1 },
      { steps: [[0, 1], [1, 1], [2, 2]], beats: 1 },
    ],
    restChance: 0.05,
  },
  dotted: {
    base: [
      { steps: [[0, 3], [3, 1]], beats: 1 },
      { steps: [[0, 4]], beats: 1 },
    ],
    variants: [
      { steps: [[0, 1], [1, 3]], beats: 1 }, // scotch snap
      { steps: [[0, 6], [6, 2]], beats: 2 },
    ],
    restChance: 0.05,
  },
  syncopated: {
    base: [
      { steps: [[0, 1], [2, 2]], beats: 1 },
      { steps: [[2, 2]], beats: 1 },
      { steps: [[0, 2], [3, 1]], beats: 1 },
    ],
    variants: [
      { steps: [[1, 3]], beats: 1 },
      { steps: [[1, 1], [3, 1]], beats: 1 },
    ],
    restChance: 0.12,
  },
  sparse: {
    base: [
      { steps: [[0, 4]], beats: 1 },
      { steps: [[0, 8]], beats: 2 },
    ],
    variants: [
      { steps: [[0, 6]], beats: 2 },
      { steps: [[0, 3]], beats: 1 },
    ],
    restChance: 0.3,
  },
}

const VARIANT_CHANCE = 0.35

interface Onset {
  startBeat: number
  durationBeats: number
}

function rhythmOnsets(params: WalkParams, rng: Rng, muted: boolean): Onset[] {
  const bpb = beatsPerBar(params.timeSig)
  const totalBeats = params.bars * bpb
  const table = CELLS[params.rhythm]
  const onsets: Onset[] = []
  let beat = 0
  while (beat < totalBeats) {
    const beatsLeft = totalBeats - beat
    // Rests are allowed anywhere except the very first beat (the phrase anchor).
    if (beat > 0 && !muted && rng() < table.restChance) {
      beat += 1
      continue
    }
    const pool =
      !muted && rng() < VARIANT_CHANCE && table.variants.length > 0 ? table.variants : table.base
    const fitting = pool.filter((c) => c.beats <= beatsLeft)
    const cell = fitting.length > 0 ? fitting[randInt(rng, 0, fitting.length - 1)] : table.base[0]
    for (const [off, dur] of cell.steps) {
      const start = beat + off * GRID
      if (start >= totalBeats) break
      onsets.push({
        startBeat: start,
        durationBeats: Math.min(dur * GRID, totalBeats - start),
      })
    }
    beat += Math.min(cell.beats, beatsLeft)
  }
  return onsets
}

/** Contour target, in scale degrees relative to the starting degree. */
function contourTarget(contour: Contour, t: number): number {
  switch (contour) {
    case 'arch':
      return Math.sin(Math.PI * t) * 5
    case 'ascend':
      return t * 7
    case 'descend':
      return -t * 7
    case 'zigzag': {
      const phase = (t * 2) % 1 // two rise/fall cycles across the phrase
      return (phase < 0.5 ? phase * 2 : 2 - phase * 2) * 4
    }
    case 'flat':
      return 0
  }
}

/** Where the walk starts relative to the contour's travel. */
const CONTOUR_START_NUDGE: Record<Contour, number> = {
  arch: -1,
  ascend: -3,
  descend: 3,
  zigzag: 0,
  flat: 0,
}

/** Baseline interval weights (scale degrees): steps dominate, leaps are rare. */
const INTERVAL_WEIGHTS: readonly (readonly [number, number])[] = [
  [-4, 2],
  [-3, 5],
  [-2, 14],
  [-1, 26],
  [0, 6],
  [1, 26],
  [2, 14],
  [3, 5],
  [4, 2],
]

/** Degrees that end a phrase at rest (tonic triad). */
const RESOLUTION_DEGREES = new Set([0, 2, 4])

/**
 * Deterministic melody for `params` drawn from `rng`. Guarantees: every pitch
 * in-scale and inside `range`, ≥3 notes, all notes within the bar count, and
 * every leap > a third followed by a step in the opposite direction.
 */
export function randomWalkNotes(params: WalkParams, rng: Rng): Note[] {
  const range = params.range ?? DEFAULT_RANGE
  const totalBeats = params.bars * beatsPerBar(params.timeSig)

  let onsets = rhythmOnsets(params, rng, false)
  // Degenerate rhythm draw (all rests / sparse): redo with rests and variants
  // muted, which yields at least one onset per beat pair.
  if (onsets.length < 4) onsets = rhythmOnsets(params, rng, true)

  // Walk in "degree index" space: octave * 7 + degree, always chromaticOffset 0.
  const idxPitch = (idx: number) =>
    degreeToPitch(
      { degree: ((idx % 7) + 7) % 7, octave: Math.floor(idx / 7), chromaticOffset: 0 },
      params.key,
      params.mode,
    )
  const inRange = (idx: number) => idxPitch(idx) >= range.min && idxPitch(idx) <= range.max

  const root = keyToPitchClass(params.key)
  // Tonic nearest middle-of-register, nudged so the contour has room to travel.
  let startIdx = Math.round((62 - root) / 12) * 7 + CONTOUR_START_NUDGE[params.contour]
  while (!inRange(startIdx)) startIdx += idxPitch(startIdx) < range.min ? 1 : -1

  const notes: Note[] = []
  let cur = startIdx
  let prevInterval = 0
  for (let i = 0; i < onsets.length; i++) {
    const onset = onsets[i]
    if (i > 0) {
      const isLast = i === onsets.length - 1
      let interval: number
      if (Math.abs(prevInterval) > 2) {
        // Leap recovery: a leap wider than a third resolves stepwise, opposite direction.
        interval = -Math.sign(prevInterval)
      } else if (isLast) {
        // Cadence: nearest in-range tonic-triad degree.
        let best = cur
        let bestDist = Infinity
        for (let idx = cur - 4; idx <= cur + 4; idx++) {
          if (!inRange(idx) || !RESOLUTION_DEGREES.has(((idx % 7) + 7) % 7)) continue
          const dist = Math.abs(idx - cur)
          if (dist < bestDist) {
            best = idx
            bestDist = dist
          }
        }
        interval = best - cur
      } else {
        const target = startIdx + contourTarget(params.contour, onset.startBeat / totalBeats)
        const weighted = INTERVAL_WEIGHTS.map(([d, w]) => {
          if (!inRange(cur + d)) return [d, 0] as const
          const dist = Math.abs(cur + d - target)
          return [d, w / (1 + 0.55 * dist)] as const
        })
        interval = pickWeighted(rng, weighted)
        if (!inRange(cur + interval)) interval = inRange(cur - interval) ? -interval : 0
      }
      cur += interval
      prevInterval = interval
    }
    const onBar = onset.startBeat % beatsPerBar(params.timeSig) === 0
    const onBeat = onset.startBeat % 1 === 0
    const base = onBar ? 102 : onBeat ? 94 : 86
    notes.push({
      pitch: idxPitch(cur),
      startBeat: onset.startBeat,
      durationBeats: onset.durationBeats,
      velocity: Math.min(127, Math.max(1, base + randInt(rng, -5, 5))),
    })
  }

  // Let the phrase ring: stretch the final note toward the end of the motif.
  const last = notes[notes.length - 1]
  last.durationBeats = Math.min(
    totalBeats - last.startBeat,
    Math.max(last.durationBeats, 1.5),
  )

  return notes
}
