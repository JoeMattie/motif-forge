import { describe, expect, it } from 'vitest'
import type { Note } from '../src/types'
import { mulberry32 } from '../src/generation/symbolic/prng'
import { randomWalkNotes } from '../src/generation/symbolic/walk'
import {
  bassNotes,
  chordAtBeat,
  chordPitchClasses,
  crossPartScore,
  type HarmonyContext,
  padNotes,
  PROGRESSIONS,
  progressionFor,
} from '../src/generation/symbolic/harmony'
import { makeNote } from './fixtures'

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
