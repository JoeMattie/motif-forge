import { describe, expect, it } from 'vitest'
import type { Note } from '../src/types'
import { beatsPerBar, isInScale } from '../src/core/theory'
import { mulberry32 } from '../src/generation/symbolic/prng'
import {
  chordProgressionNotes,
  chordVoicing,
  DOMINANT_DEGREES,
  type HarmonyParams,
  harmonizeLine,
  progression,
  progressionLabel,
  romanNumeral,
  TONIC_DEGREES,
} from '../src/generation/symbolic/harmony'
import { makeNote } from './fixtures'

const params = (partial: Partial<HarmonyParams> = {}): HarmonyParams => ({
  key: 'C',
  mode: 'ionian',
  bars: 4,
  timeSig: '4/4',
  ...partial,
})

/** Group note pitches by onset (chords strike all tones at one startBeat). */
function byOnset(notes: Note[]): Map<number, number[]> {
  const m = new Map<number, number[]>()
  for (const n of notes) {
    const at = m.get(n.startBeat) ?? []
    at.push(n.pitch)
    m.set(n.startBeat, at)
  }
  return m
}

describe('progression', () => {
  it('starts tonic, ends with a D→I cadence, and tiles the phrase exactly', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const segs = progression(4, '4/4', mulberry32(seed))
      expect(segs.length).toBeGreaterThanOrEqual(4)
      expect(TONIC_DEGREES).toContain(segs[0].rootDegree)
      expect(DOMINANT_DEGREES).toContain(segs[segs.length - 2].rootDegree)
      expect(segs[segs.length - 1].rootDegree).toBe(0)
      let cursor = 0
      for (const s of segs) {
        expect(s.startBeat).toBeCloseTo(cursor, 9)
        cursor += s.durationBeats
        expect(s.rootDegree).toBeGreaterThanOrEqual(0)
        expect(s.rootDegree).toBeLessThanOrEqual(6)
      }
      expect(cursor).toBeCloseTo(4 * beatsPerBar('4/4'), 9)
    }
  })

  it('never repeats a root between adjacent walked segments', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const segs = progression(8, '4/4', mulberry32(seed))
      // The forced cadence may prolong a dominant; the walk itself never repeats.
      for (let i = 1; i < segs.length - 2; i++) {
        expect(segs[i].rootDegree).not.toBe(segs[i - 1].rootDegree)
      }
    }
  })

  it('honors allowHalfBar: false with exactly one segment per bar', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const bars of [2, 4, 8]) {
        const segs = progression(bars, '4/4', mulberry32(seed), { allowHalfBar: false })
        expect(segs).toHaveLength(bars)
        for (const s of segs) expect(s.durationBeats).toBe(4)
      }
    }
  })

  it('is deterministic per seed and differs across seeds', () => {
    const a = progression(4, '4/4', mulberry32(9))
    const b = progression(4, '4/4', mulberry32(9))
    expect(a).toEqual(b)
    const rolls = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      rolls.add(JSON.stringify(progression(4, '4/4', mulberry32(seed))))
    }
    expect(rolls.size).toBeGreaterThanOrEqual(2)
  })
})

describe('romanNumeral / progressionLabel', () => {
  it('derives quality from the mode', () => {
    expect(romanNumeral(0, false, 'C', 'ionian')).toBe('I')
    expect(romanNumeral(1, false, 'C', 'ionian')).toBe('ii')
    expect(romanNumeral(6, false, 'C', 'ionian')).toBe('vii°')
    expect(romanNumeral(4, true, 'C', 'ionian')).toBe('V7')
    expect(romanNumeral(0, false, 'A', 'aeolian')).toBe('i')
    expect(romanNumeral(1, false, 'A', 'aeolian')).toBe('ii°')
  })

  it('labels a progression as dash-joined numerals', () => {
    const segs = [
      { rootDegree: 0, seventh: false, startBeat: 0, durationBeats: 4 },
      { rootDegree: 4, seventh: true, startBeat: 4, durationBeats: 4 },
    ]
    expect(progressionLabel(segs, 'C', 'ionian')).toBe('I–V7')
  })
})

describe('chordVoicing', () => {
  it('places the root inside the window with the stack in scale', () => {
    for (const key of ['C', 'F#', 'Eb']) {
      for (let degree = 0; degree < 7; degree++) {
        const tones = chordVoicing(degree, false, key, 'ionian', { maxVoices: 4 })
        expect(tones[0]).toBeGreaterThanOrEqual(48)
        expect(tones[0]).toBeLessThanOrEqual(60)
        for (const p of tones) expect(isInScale(p, key, 'ionian')).toBe(true)
      }
    }
  })

  it('drops the whole stack an octave to duck under a ceiling', () => {
    const high = chordVoicing(0, false, 'C', 'ionian', { maxVoices: 3 }) // 48 52 55... C-E-G at 48
    const ducked = chordVoicing(0, false, 'C', 'ionian', { maxVoices: 3, ceiling: high[2] - 1 })
    expect(ducked).toEqual(high.map((p) => p - 12))
  })

  it('never drops below the pitch floor and clamps into 36–96', () => {
    const tones = chordVoicing(0, false, 'C', 'ionian', { maxVoices: 3, ceiling: 10 })
    for (const p of tones) {
      expect(p).toBeGreaterThanOrEqual(36)
      expect(p).toBeLessThanOrEqual(96)
    }
  })

  it('maxVoices 3 drops the seventh; maxVoices 4 keeps it', () => {
    expect(chordVoicing(4, true, 'C', 'ionian', { maxVoices: 3 })).toHaveLength(3)
    expect(chordVoicing(4, true, 'C', 'ionian', { maxVoices: 4 })).toHaveLength(4)
  })

  it('honors a custom root window', () => {
    for (let degree = 0; degree < 7; degree++) {
      const tones = chordVoicing(degree, false, 'D', 'dorian', {
        maxVoices: 4,
        rootWindow: [45, 57],
      })
      expect(tones[0]).toBeGreaterThanOrEqual(45)
      expect(tones[0]).toBeLessThanOrEqual(57)
    }
  })
})

describe('chordProgressionNotes', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = chordProgressionNotes(params(), mulberry32(3))
    const b = chordProgressionNotes(params(), mulberry32(3))
    const c = chordProgressionNotes(params(), mulberry32(4))
    expect(a).toEqual(b)
    expect(JSON.stringify(a.notes)).not.toEqual(JSON.stringify(c.notes))
  })

  it('emits 3-4 in-scale, in-range tones per onset inside the phrase', () => {
    for (const key of ['C', 'Eb'] as const) {
      for (const mode of ['ionian', 'aeolian', 'dorian'] as const) {
        for (let seed = 1; seed <= 10; seed++) {
          const p = params({ key, mode, bars: 4 })
          const { notes } = chordProgressionNotes(p, mulberry32(seed))
          const total = p.bars * beatsPerBar(p.timeSig)
          expect(notes.length).toBeGreaterThanOrEqual(3)
          for (const n of notes) {
            expect(n.pitch).toBeGreaterThanOrEqual(36)
            expect(n.pitch).toBeLessThanOrEqual(96)
            expect(isInScale(n.pitch, key, mode)).toBe(true)
            expect(n.startBeat).toBeGreaterThanOrEqual(0)
            expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(total + 1e-6)
            expect(n.velocity).toBeGreaterThanOrEqual(60)
            expect(n.velocity).toBeLessThanOrEqual(100)
          }
          for (const pitches of byOnset(notes).values()) {
            const unique = new Set(pitches)
            expect(unique.size).toBeGreaterThanOrEqual(3)
            expect(unique.size).toBeLessThanOrEqual(4)
          }
        }
      }
    }
  })

  it('maxVoices 3 never emits a fourth tone', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { notes } = chordProgressionNotes(params({ maxVoices: 3 }), mulberry32(seed))
      for (const pitches of byOnset(notes).values()) {
        expect(new Set(pitches).size).toBeLessThanOrEqual(3)
      }
    }
  })

  it('restrike patterns vary the harmonic surface across seeds', () => {
    let sawRestruck = false
    for (let seed = 1; seed <= 20 && !sawRestruck; seed++) {
      const { notes, segments } = chordProgressionNotes(params(), mulberry32(seed))
      if (byOnset(notes).size > segments.length) sawRestruck = true
    }
    expect(sawRestruck).toBe(true)
  })
})

describe('harmonizeLine', () => {
  it('picks I under a plain C-E-G arpeggio (outside the forced cadence)', () => {
    // A full C-E-G triplet arpeggio on every beat: I covers 100% of every
    // segment window, so it strictly beats every rival candidate.
    const melody: Note[] = []
    for (let b = 0; b < 16; b++) {
      for (const [k, pitch] of [60, 64, 67].entries()) {
        melody.push(makeNote({ pitch, startBeat: b + k / 3, durationBeats: 1 / 3, velocity: 96 }))
      }
    }
    for (let seed = 1; seed <= 10; seed++) {
      const { segments } = harmonizeLine(melody, params({ bars: 4 }), mulberry32(seed))
      for (const s of segments.slice(0, -2)) expect(s.rootDegree).toBe(0)
      expect(segments[segments.length - 1].rootDegree).toBe(0)
      expect(DOMINANT_DEGREES).toContain(segments[segments.length - 2].rootDegree)
    }
  })

  it('keeps chord velocities below the lead and every tone in scale', () => {
    const melody = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) =>
      makeNote({ pitch, startBeat: i * 2, durationBeats: 2, velocity: 96 }),
    )
    for (let seed = 1; seed <= 10; seed++) {
      const { notes } = harmonizeLine(melody, params({ bars: 4 }), mulberry32(seed))
      expect(notes.length).toBeGreaterThanOrEqual(3)
      for (const n of notes) {
        expect(n.velocity).toBeLessThan(96)
        expect(isInScale(n.pitch, 'C', 'ionian')).toBe(true)
        expect(n.pitch).toBeGreaterThanOrEqual(36)
        expect(n.pitch).toBeLessThanOrEqual(96)
      }
    }
  })

  it('maxVoices 3 keeps every accompaniment onset to a triad', () => {
    const melody = [72, 74, 76, 77].map((pitch, i) =>
      makeNote({ pitch, startBeat: i * 4, durationBeats: 4, velocity: 96 }),
    )
    for (let seed = 1; seed <= 20; seed++) {
      const { notes } = harmonizeLine(melody, params({ bars: 4, maxVoices: 3 }), mulberry32(seed))
      for (const pitches of byOnset(notes).values()) {
        expect(new Set(pitches).size).toBeLessThanOrEqual(3)
      }
    }
  })

  it('is deterministic given (melody, params, seed)', () => {
    const melody = [60, 64, 67].map((pitch, i) =>
      makeNote({ pitch, startBeat: i, velocity: 96 }),
    )
    const a = harmonizeLine(melody, params({ bars: 2 }), mulberry32(5))
    const b = harmonizeLine(melody, params({ bars: 2 }), mulberry32(5))
    expect(a).toEqual(b)
  })
})
