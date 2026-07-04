import { describe, expect, it } from 'vitest'
import {
  clampPitch,
  gridBeats,
  GRIDS,
  lockNotesToScale,
  quantizeFloor,
  quantizeNotes,
  quantizeRound,
  snapPitchToScale,
} from '../src/noodle/quantize'
import type { Note } from '../src/types'

const note = (pitch: number, startBeat: number, durationBeats = 1): Note => ({
  pitch,
  startBeat,
  durationBeats,
  velocity: 96,
})

describe('grid math', () => {
  it('exposes the four SNAP resolutions', () => {
    expect(GRIDS.map((g) => g.id)).toEqual(['1/4', '1/8', '1/16', '1/8T'])
    expect(gridBeats('1/16')).toBe(0.25)
    expect(gridBeats('1/8T')).toBeCloseTo(1 / 3, 10)
  })

  it('quantizeFloor snaps down (signal pencil rule)', () => {
    expect(quantizeFloor(1.24, 0.25)).toBeCloseTo(1.0)
    expect(quantizeFloor(1.26, 0.25)).toBeCloseTo(1.25)
    // exact grid values stay put despite float noise
    expect(quantizeFloor(0.75, 0.25)).toBeCloseTo(0.75)
    expect(quantizeFloor(2 / 3, 1 / 3)).toBeCloseTo(2 / 3)
  })

  it('quantizeRound snaps to the nearest line (live capture rule)', () => {
    expect(quantizeRound(1.13, 0.25)).toBeCloseTo(1.25)
    expect(quantizeRound(1.12, 0.25)).toBeCloseTo(1.0)
    expect(quantizeRound(0.51, 1 / 3)).toBeCloseTo(2 / 3)
  })
})

describe('snapPitchToScale', () => {
  it('passes in-scale pitches through', () => {
    // D dorian: D E F G A B C
    expect(snapPitchToScale(62, 'D', 'dorian')).toBe(62) // D
    expect(snapPitchToScale(65, 'D', 'dorian')).toBe(65) // F
  })

  it('moves chromatic pitches to the nearest scale tone, ties downward', () => {
    // D# sits between D and E in D dorian — tie resolves down to D
    expect(snapPitchToScale(63, 'D', 'dorian')).toBe(62)
    // F# in C ionian sits between F and G — tie resolves down to F
    expect(snapPitchToScale(66, 'C', 'ionian')).toBe(65)
    // C# in D dorian: C below, D above — equidistant → C
    expect(snapPitchToScale(61, 'D', 'dorian')).toBe(60)
  })

  it('crosses the octave boundary when the upper neighbor is the root', () => {
    // B in C ionian is degree 6; Bb (70) is between A (69) and B (71) → A (tie down)
    expect(snapPitchToScale(70, 'C', 'ionian')).toBe(69)
    // B (71) in C aeolian (…G Ab Bb C): between Bb (70) and C (72) → Bb
    expect(snapPitchToScale(71, 'C', 'aeolian')).toBe(70)
  })

  it('clampPitch keeps the editable range', () => {
    expect(clampPitch(30)).toBe(36)
    expect(clampPitch(120)).toBe(96)
    expect(clampPitch(60)).toBe(60)
  })
})

describe('quantizeNotes', () => {
  it('rounds starts and melodic durations to whole grid cells', () => {
    const [q] = quantizeNotes([note(60, 1.13, 0.61)], { grid: 0.25, totalBeats: 16 })
    expect(q.startBeat).toBeCloseTo(1.25)
    expect(q.durationBeats).toBeCloseTo(0.5)
  })

  it('never shrinks a note below one grid cell', () => {
    const [q] = quantizeNotes([note(60, 0.02, 0.05)], { grid: 0.25, totalBeats: 16 })
    expect(q.startBeat).toBe(0)
    expect(q.durationBeats).toBeCloseTo(0.25)
  })

  it('wraps starts that round up to the loop end', () => {
    const [q] = quantizeNotes([note(60, 15.95, 0.3)], { grid: 0.25, totalBeats: 16 })
    expect(q.startBeat).toBe(0)
  })

  it('clamps durations to the loop end', () => {
    const [q] = quantizeNotes([note(60, 15.4, 2)], { grid: 0.5, totalBeats: 16 })
    expect(q.startBeat).toBeCloseTo(15.5)
    expect(q.durationBeats).toBeCloseTo(0.5)
  })

  it('leaves drum-hit durations alone', () => {
    const [q] = quantizeNotes([note(38, 1.9, 0.1)], { grid: 0.25, totalBeats: 16, drums: true })
    expect(q.startBeat).toBeCloseTo(2)
    expect(q.durationBeats).toBeCloseTo(0.1)
  })
})

describe('lockNotesToScale', () => {
  it('snaps every pitch into key', () => {
    const locked = lockNotesToScale([note(63, 0), note(62, 1), note(61, 2)], 'D', 'dorian')
    expect(locked.map((n) => n.pitch)).toEqual([62, 62, 60])
    // timing untouched
    expect(locked.map((n) => n.startBeat)).toEqual([0, 1, 2])
  })
})
