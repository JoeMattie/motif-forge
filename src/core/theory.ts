import type { Mode } from '../types'

export const MODES: Mode[] = [
  'ionian',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
]

export const MODE_INTERVALS: Record<Mode, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
}

const PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

export function keyToPitchClass(key: string): number {
  const letter = key.charAt(0).toUpperCase()
  const base = PC[letter]
  if (base === undefined) throw new Error(`Bad key: ${key}`)
  let pc = base
  for (const acc of key.slice(1)) {
    if (acc === '#') pc += 1
    else if (acc === 'b') pc -= 1
  }
  return ((pc % 12) + 12) % 12
}

export function beatsPerBar(timeSig: string): number {
  const n = parseInt(timeSig.split('/')[0], 10)
  return Number.isFinite(n) && n > 0 ? n : 4
}

export function scalePitchClasses(key: string, mode: Mode): number[] {
  const root = keyToPitchClass(key)
  return MODE_INTERVALS[mode].map((i) => (root + i) % 12)
}

export function isInScale(pitch: number, key: string, mode: Mode): boolean {
  return scalePitchClasses(key, mode).includes(((pitch % 12) + 12) % 12)
}

export interface DegreePosition {
  degree: number // 0-6
  octave: number // octave index relative to MIDI octave numbering
  chromaticOffset: number // 0 or +1: semitones above the degree
}

/**
 * Decompose a pitch into scale degree + octave. Chromatic pitches map to the
 * nearest degree below with chromaticOffset +1, so the decomposition is total.
 */
export function pitchToDegree(pitch: number, key: string, mode: Mode): DegreePosition {
  const root = keyToPitchClass(key)
  const intervals = MODE_INTERVALS[mode]
  const rel = (((pitch - root) % 12) + 12) % 12
  let degree = 0
  for (let i = intervals.length - 1; i >= 0; i--) {
    if (intervals[i] <= rel) {
      degree = i
      break
    }
  }
  const chromaticOffset = rel - intervals[degree]
  const octave = Math.floor((pitch - root - rel) / 12)
  return { degree, octave, chromaticOffset }
}

export function degreeToPitch(pos: DegreePosition, key: string, mode: Mode): number {
  const root = keyToPitchClass(key)
  return root + pos.octave * 12 + MODE_INTERVALS[mode][pos.degree] + pos.chromaticOffset
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function pitchName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

export function pitchToHz(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}
