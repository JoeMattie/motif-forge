/**
 * GENETIC engine pitch assigner — the GA decides WHEN (the groove), this
 * decides WHAT: seeded in-key pitches on the evolved onsets. Works in degree
 * index space (octave * 7 + degree, chromaticOffset always 0) like walk.ts, so
 * every pitch is in-scale by construction. Root-heavy riff palette: accented
 * steps pull hard to root/5th/octave and play louder; unaccented steps add
 * passing color or move stepwise from the previous pitch.
 */
import type { Mode } from '../../types'
import { degreeToPitch, keyToPitchClass } from '../../core/theory'
import { pick, pickWeighted, randInt, type Rng } from '../symbolic/prng'

export const ACCENT_VELOCITY = 112
export const BASE_VELOCITY = 88

/** Riff register (A2–G5), well inside the app's hard 36–96 pitch bounds. */
const RANGE = { min: 45, max: 79 }

/** How often an unaccented onset moves stepwise from the previous pitch. */
const WALK_CHANCE = 0.3

/** Degree-index offsets from the riff root, weighted (root/5th/octave heavy). */
const ACCENT_PALETTE: readonly (readonly [number, number])[] = [
  [0, 6],
  [4, 3],
  [7, 2],
]
const PASSING_PALETTE: readonly (readonly [number, number])[] = [
  [0, 5],
  [4, 3],
  [7, 2],
  [2, 2],
  [1, 1],
  [-1, 1],
  [3, 1],
  [-3, 1],
]
const CADENCE_PALETTE: readonly (readonly [number, number])[] = [
  [0, 3],
  [4, 1],
]

export interface RiffOnset {
  step: number
  accented: boolean
}

export interface PitchedOnset {
  pitch: number
  velocity: number
}

export function assignPitches(
  onsets: RiffOnset[],
  ctx: { key: string; mode: Mode },
  rng: Rng,
): PitchedOnset[] {
  const idxPitch = (idx: number) =>
    degreeToPitch(
      { degree: ((idx % 7) + 7) % 7, octave: Math.floor(idx / 7), chromaticOffset: 0 },
      ctx.key,
      ctx.mode,
    )
  const inRange = (idx: number) => idxPitch(idx) >= RANGE.min && idxPitch(idx) <= RANGE.max

  // Tonic degree-index nearest the low riff register.
  let rootIdx = Math.round((52 - keyToPitchClass(ctx.key)) / 12) * 7
  while (!inRange(rootIdx)) rootIdx += idxPitch(rootIdx) < RANGE.min ? 1 : -1

  const fromPalette = (palette: readonly (readonly [number, number])[]) =>
    rootIdx +
    pickWeighted(
      rng,
      palette.map(([off, w]) => [off, inRange(rootIdx + off) ? w : 0] as const),
    )

  const out: PitchedOnset[] = []
  let prevIdx = rootIdx
  for (let i = 0; i < onsets.length; i++) {
    const { accented } = onsets[i]
    const isLast = i === onsets.length - 1
    let idx: number
    if (isLast) {
      idx = fromPalette(CADENCE_PALETTE)
    } else if (accented) {
      idx = fromPalette(ACCENT_PALETTE)
    } else if (i > 0 && rng() < WALK_CHANCE) {
      // Stepwise motion connecting riff tones; reflect at the range edges.
      const step = pick(rng, [-1, 1])
      idx = inRange(prevIdx + step) ? prevIdx + step : prevIdx - step
      if (!inRange(idx)) idx = prevIdx
    } else {
      idx = fromPalette(PASSING_PALETTE)
    }
    prevIdx = idx
    const base = accented ? ACCENT_VELOCITY + randInt(rng, -4, 4) : BASE_VELOCITY + randInt(rng, -6, 6)
    out.push({ pitch: idxPitch(idx), velocity: Math.min(127, Math.max(1, base)) })
  }
  return out
}
