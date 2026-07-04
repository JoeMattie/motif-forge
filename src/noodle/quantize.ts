/**
 * Pure snap/lock math for the Noodle panel — grid quantization for captured
 * and penciled notes, and key/mode pitch locking. Framework-free so it unit
 * tests directly (tests/noodleQuantize.test.ts).
 */
import type { Mode, Note } from '../types'
import { degreeToPitch, isInScale, MODE_INTERVALS, pitchToDegree } from '../core/theory'

/** Editable pitch viewport of the noodle roll (the motif data model's range). */
export const NOODLE_PITCH_MIN = 36
export const NOODLE_PITCH_MAX = 96

export type GridId = '1/4' | '1/8' | '1/16' | '1/8T'

/** Grid resolutions offered by the SNAP switch, in beats per cell. */
export const GRIDS: { id: GridId; beats: number }[] = [
  { id: '1/4', beats: 1 },
  { id: '1/8', beats: 0.5 },
  { id: '1/16', beats: 0.25 },
  { id: '1/8T', beats: 1 / 3 },
]

export function gridBeats(id: GridId): number {
  return GRIDS.find((g) => g.id === id)!.beats
}

/** Snap down to the grid — melodic note creation (the signal rule). */
export function quantizeFloor(beat: number, grid: number): number {
  return Math.floor(beat / grid + 1e-6) * grid
}

/** Snap to the nearest grid line — live capture and drum/rhythm material. */
export function quantizeRound(beat: number, grid: number): number {
  return Math.round(beat / grid) * grid
}

/**
 * Snap a pitch into the key/mode: in-scale pitches pass through; chromatic
 * ones move to the nearest scale tone (ties resolve downward, matching the
 * nearest-degree-below decomposition in core/theory).
 */
export function snapPitchToScale(pitch: number, key: string, mode: Mode): number {
  if (isInScale(pitch, key, mode)) return pitch
  const pos = pitchToDegree(pitch, key, mode)
  const below = degreeToPitch({ ...pos, chromaticOffset: 0 }, key, mode)
  const degrees = MODE_INTERVALS[mode].length
  const above = degreeToPitch(
    pos.degree === degrees - 1
      ? { degree: 0, octave: pos.octave + 1, chromaticOffset: 0 }
      : { ...pos, degree: pos.degree + 1, chromaticOffset: 0 },
    key,
    mode,
  )
  return pitch - below <= above - pitch ? below : above
}

export function clampPitch(pitch: number): number {
  return Math.max(NOODLE_PITCH_MIN, Math.min(NOODLE_PITCH_MAX, pitch))
}

export interface QuantizeOptions {
  /** Grid cell size in beats. */
  grid: number
  /** Loop length in beats — starts wrap, ends clamp. */
  totalBeats: number
  /** Rhythm-only material: starts snap, durations stay short and untouched. */
  drums?: boolean
}

/**
 * Destructive QUANTIZE: round every start to the grid (wrapping around the
 * loop), and round melodic durations to whole grid cells (min one cell).
 * Drum hits keep their (short) durations — only their placement moves.
 */
export function quantizeNotes(notes: Note[], opts: QuantizeOptions): Note[] {
  const { grid, totalBeats, drums } = opts
  return notes.map((n) => {
    let start = quantizeRound(n.startBeat, grid)
    start = ((start % totalBeats) + totalBeats) % totalBeats
    if (drums) return { ...n, startBeat: start }
    let duration = Math.max(grid, quantizeRound(n.durationBeats, grid))
    duration = Math.min(duration, totalBeats - start)
    return { ...n, startBeat: start, durationBeats: duration }
  })
}

/** Snap every melodic pitch into the key/mode (drum takes pass through). */
export function lockNotesToScale(notes: Note[], key: string, mode: Mode): Note[] {
  return notes.map((n) => ({ ...n, pitch: clampPitch(snapPitchToScale(n.pitch, key, mode)) }))
}
