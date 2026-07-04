import { describe, expect, it } from 'vitest'
import type { Note } from '../src/types'
import { beatsPerBar, isInScale } from '../src/core/theory'
import { mulberry32 } from '../src/generation/symbolic/prng'
import {
  bassNotes,
  chordAtBeat,
  chordPitchClasses,
  chordProgressionNotes,
  chordVoicing,
  crossPartScore,
  DOMINANT_DEGREES,
  type HarmonyContext,
  type HarmonyParams,
  harmonizeLine,
  padNotes,
  PROGRESSIONS,
  progression,
  progressionFor,
  progressionLabel,
  romanNumeral,
  TONIC_DEGREES,
} from '../src/generation/symbolic/harmony'
import { randomWalkNotes } from '../src/generation/symbolic/walk'
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

const ctx: HarmonyContext = { bars: 4, timeSig: '4/4', key: 'D', mode: 'dorian' }

describe('progressions and chords', () => {
  it('chordPitchClasses stacks in-mode thirds (hand-checked)', () => {
    // D dorian degree 0: D–F–A = pitch classes {2, 5, 9}.
    expect(chordPitchClasses(0, 'D', 'dorian')).toEqual([2, 5, 9])
    // C ionian degree 4: G–B–D = {7, 11, 2}.
    expect(chordPitchClasses(4, 'C', 'ionian')).toEqual([7, 11, 2])
    // Degrees wrap mod 7.
    expect(chordPitchClasses(7, 'D', 'dorian')).toEqual(chordPitchClasses(0, 'D', 'dorian'))
  })

  it('progressionFor cycles a pool entry to one degree per bar, deterministically', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const bars of [2, 4, 8]) {
        const p = progressionFor(bars, mulberry32(seed))
        expect(p).toHaveLength(bars)
        expect(p).toEqual(progressionFor(bars, mulberry32(seed)))
        for (const d of p) {
          expect(Number.isInteger(d)).toBe(true)
          expect(d).toBeGreaterThanOrEqual(0)
          expect(d).toBeLessThanOrEqual(6)
        }
        // The cycle comes from the shipped pool.
        expect(PROGRESSIONS.some((base) => p.every((d, i) => d === base[i % base.length]))).toBe(
          true,
        )
      }
    }
  })

  it('chordAtBeat cycles one chord per bar', () => {
    const prog = [0, 5, 3, 4]
    expect(chordAtBeat(prog, 0, 4)).toBe(0)
    expect(chordAtBeat(prog, 4, 4)).toBe(5)
    expect(chordAtBeat(prog, 7.5, 4)).toBe(5)
    expect(chordAtBeat(prog, 12, 4)).toBe(4)
    expect(chordAtBeat(prog, 16, 4)).toBe(0) // wraps for longer material
  })
})

describe('bassNotes', () => {
  it('emits chord tones only, in the bass register, deterministically', () => {
    const prog = [0, 5, 3, 4]
    for (let seed = 1; seed <= 20; seed++) {
      for (const energy of [0, 0.5, 1]) {
        const notes = bassNotes(prog, { ...ctx, energy }, mulberry32(seed))
        expect(notes.length).toBeGreaterThanOrEqual(ctx.bars)
        expect(notes).toEqual(bassNotes(prog, { ...ctx, energy }, mulberry32(seed)))
        for (const n of notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(36)
          expect(n.pitch).toBeLessThanOrEqual(55)
          const chord = chordPitchClasses(chordAtBeat(prog, n.startBeat, 4), ctx.key, ctx.mode)
          expect(chord).toContain(((n.pitch % 12) + 12) % 12)
          expect(n.startBeat).toBeGreaterThanOrEqual(0)
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(16 + 1e-6)
          expect(n.velocity).toBeGreaterThanOrEqual(1)
          expect(n.velocity).toBeLessThanOrEqual(127)
        }
        // Every bar opens with the chord root on its downbeat.
        for (let bar = 0; bar < ctx.bars; bar++) {
          const down = notes.find((n) => n.startBeat === bar * 4)
          expect(down).toBeDefined()
          const rootPc = chordPitchClasses(prog[bar], ctx.key, ctx.mode)[0]
          expect(down!.pitch % 12).toBe(rootPc)
        }
      }
    }
  })
})

describe('padNotes', () => {
  it('lays one sustained triad per bar in the pad register, deterministically', () => {
    const prog = [0, 5, 3, 4]
    const notes = padNotes(prog, ctx)
    expect(notes).toEqual(padNotes(prog, ctx))
    expect(notes).toHaveLength(ctx.bars * 3)
    for (let bar = 0; bar < ctx.bars; bar++) {
      const chordNotes = notes.filter((n) => n.startBeat === bar * 4)
      expect(chordNotes).toHaveLength(3)
      const chord = chordPitchClasses(prog[bar], ctx.key, ctx.mode)
      const pcs = chordNotes.map((n) => ((n.pitch % 12) + 12) % 12).sort((a, b) => a - b)
      expect(pcs).toEqual([...chord].sort((a, b) => a - b))
      for (const n of chordNotes) {
        expect(n.pitch).toBeGreaterThanOrEqual(55)
        expect(n.pitch).toBeLessThanOrEqual(74)
        expect(n.durationBeats).toBe(4)
      }
    }
  })

  it('voice-leads with small movements between bars', () => {
    const prog = [0, 5, 3, 4]
    const notes = padNotes(prog, ctx)
    const voicing = (bar: number) =>
      notes
        .filter((n) => n.startBeat === bar * 4)
        .map((n) => n.pitch)
        .sort((a, b) => a - b)
    for (let bar = 1; bar < ctx.bars; bar++) {
      const prev = voicing(bar - 1)
      const cur = voicing(bar)
      const movement = prev.reduce((s, p, i) => s + Math.abs(p - cur[i]), 0)
      expect(movement).toBeLessThanOrEqual(12) // nearest inversion, not a jump
    }
  })

  it('a pad under a busy lead stays inside the 8-voice cap', () => {
    const lead = randomWalkNotes(
      { key: 'D', mode: 'dorian', bars: 4, timeSig: '4/4', contour: 'zigzag', rhythm: 'straight' },
      mulberry32(5),
    )
    const prog = [0, 5, 3, 4]
    const pad = padNotes(prog, ctx)
    const bass = bassNotes(prog, ctx, mulberry32(5))
    const all = [...lead, ...pad, ...bass]
    for (let t = 0; t < 16; t += 0.25) {
      const sounding = all.filter(
        (n) => n.startBeat <= t + 1e-6 && n.startBeat + n.durationBeats > t + 1e-6,
      )
      expect(sounding.length).toBeLessThanOrEqual(8)
    }
  })
})

describe('crossPartScore', () => {
  const whole = (pitch: number): Note[] => [
    makeNote({ pitch, startBeat: 0, durationBeats: 4 }),
  ]

  it('rewards unisons/perfect intervals, punishes tritones', () => {
    expect(crossPartScore(whole(60), whole(60), 4)).toBeGreaterThan(0) // unison
    expect(crossPartScore(whole(60), whole(67), 4)).toBeGreaterThan(0) // P5
    expect(crossPartScore(whole(60), whole(66), 4)).toBeLessThan(0) // tritone
    expect(crossPartScore(whole(60), whole(61), 4)).toBeLessThan(0) // minor 2nd
  })

  it('treats rests as neutral-positive and stays in (−1, 1)', () => {
    expect(crossPartScore(whole(60), [], 4)).toBeGreaterThan(0)
    for (const other of [60, 61, 66, 67]) {
      const s = crossPartScore(whole(60), whole(other), 4)
      expect(s).toBeGreaterThan(-1)
      expect(s).toBeLessThan(1)
    }
  })

  it('is deterministic and ranks a chord-tone bass above a clashing one', () => {
    const lead = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, b) =>
      makeNote({ pitch, startBeat: b * 0.5, durationBeats: 0.5 }),
    )
    const consonant = [makeNote({ pitch: 48, startBeat: 0, durationBeats: 4 })] // C under C ionian line
    const clashing = [makeNote({ pitch: 49, startBeat: 0, durationBeats: 4 })] // C# under it
    expect(crossPartScore(lead, consonant, 4)).toBeGreaterThan(crossPartScore(lead, clashing, 4))
  })
})
