import { describe, expect, test } from 'vitest'
import {
  MODES,
  MODE_INTERVALS,
  keyToPitchClass,
  beatsPerBar,
  scalePitchClasses,
  isInScale,
  pitchToDegree,
  degreeToPitch,
  pitchName,
  pitchToHz,
} from '../src/core/theory'

describe('keyToPitchClass', () => {
  test('naturals, sharps, flats', () => {
    expect(keyToPitchClass('C')).toBe(0)
    expect(keyToPitchClass('D')).toBe(2)
    expect(keyToPitchClass('F#')).toBe(6)
    expect(keyToPitchClass('Bb')).toBe(10)
  })

  test('accidentals wrap around the octave', () => {
    expect(keyToPitchClass('Cb')).toBe(11)
    expect(keyToPitchClass('B#')).toBe(0)
  })

  test('lowercase letters are accepted', () => {
    expect(keyToPitchClass('d')).toBe(2)
    expect(keyToPitchClass('bb')).toBe(10)
  })

  test('throws on a non-note letter', () => {
    expect(() => keyToPitchClass('H')).toThrow()
    expect(() => keyToPitchClass('')).toThrow()
  })
})

describe('beatsPerBar', () => {
  test('reads the numerator', () => {
    expect(beatsPerBar('4/4')).toBe(4)
    expect(beatsPerBar('3/4')).toBe(3)
    expect(beatsPerBar('7/8')).toBe(7)
  })

  test('falls back to 4 on garbage or non-positive numerators', () => {
    expect(beatsPerBar('garbage')).toBe(4)
    expect(beatsPerBar('0/4')).toBe(4)
    expect(beatsPerBar('-2/4')).toBe(4)
  })
})

describe('scales', () => {
  test('C ionian is the white keys', () => {
    expect(scalePitchClasses('C', 'ionian')).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  test('D dorian contains the same pitch classes as C ionian', () => {
    const cMajor = scalePitchClasses('C', 'ionian')
    for (const pc of scalePitchClasses('D', 'dorian')) {
      expect(cMajor).toContain(pc)
    }
  })

  test('isInScale distinguishes diatonic from chromatic pitches', () => {
    expect(isInScale(60, 'C', 'ionian')).toBe(true) // C
    expect(isInScale(61, 'C', 'ionian')).toBe(false) // C#
    expect(isInScale(63, 'C', 'aeolian')).toBe(true) // Eb in C minor
    expect(isInScale(64, 'C', 'aeolian')).toBe(false) // E natural in C minor
  })

  test('every mode has 7 strictly ascending intervals starting at 0', () => {
    for (const mode of MODES) {
      const iv = MODE_INTERVALS[mode]
      expect(iv).toHaveLength(7)
      expect(iv[0]).toBe(0)
      expect(iv[6]).toBeLessThan(12)
      for (let i = 1; i < iv.length; i++) expect(iv[i]).toBeGreaterThan(iv[i - 1])
    }
  })
})

describe('pitch ↔ scale-degree decomposition', () => {
  test('diatonic pitches decompose with zero chromatic offset', () => {
    expect(pitchToDegree(60, 'C', 'ionian')).toEqual({ degree: 0, octave: 5, chromaticOffset: 0 })
    expect(pitchToDegree(64, 'C', 'ionian')).toEqual({ degree: 2, octave: 5, chromaticOffset: 0 })
    expect(pitchToDegree(71, 'C', 'ionian')).toEqual({ degree: 6, octave: 5, chromaticOffset: 0 })
  })

  test('chromatic pitches map to the nearest degree below with offset +1', () => {
    // C# in C ionian: degree 0 (C) raised a semitone
    expect(pitchToDegree(61, 'C', 'ionian')).toEqual({ degree: 0, octave: 5, chromaticOffset: 1 })
    // F# in C ionian: degree 3 (F) raised a semitone
    expect(pitchToDegree(66, 'C', 'ionian')).toEqual({ degree: 3, octave: 5, chromaticOffset: 1 })
  })

  test('degreeToPitch inverts pitchToDegree for every pitch, key, and mode (totality)', () => {
    for (const key of ['C', 'F#', 'Bb', 'E', 'B']) {
      for (const mode of MODES) {
        for (let pitch = 36; pitch <= 96; pitch++) {
          const pos = pitchToDegree(pitch, key, mode)
          expect(degreeToPitch(pos, key, mode), `pitch ${pitch} in ${key} ${mode}`).toBe(pitch)
        }
      }
    }
  })
})

describe('pitch naming and frequency', () => {
  test('pitchName follows MIDI octave convention (60 = C4)', () => {
    expect(pitchName(60)).toBe('C4')
    expect(pitchName(61)).toBe('C#4')
    expect(pitchName(69)).toBe('A4')
    expect(pitchName(36)).toBe('C2')
    expect(pitchName(96)).toBe('C7')
  })

  test('pitchToHz is 440 at A4 and doubles per octave', () => {
    expect(pitchToHz(69)).toBe(440)
    expect(pitchToHz(81)).toBeCloseTo(880, 9)
    expect(pitchToHz(57)).toBeCloseTo(220, 9)
    expect(pitchToHz(60)).toBeCloseTo(261.6256, 3)
  })
})
