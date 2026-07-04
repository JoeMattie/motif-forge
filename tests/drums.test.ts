import { describe, expect, it } from 'vitest'
import type { Note } from '../src/types'
import { beatsPerBar } from '../src/core/theory'
import { validateBatch } from '../src/core/validate'
import { mulberry32 } from '../src/generation/symbolic/prng'
import {
  densityOf,
  type DrumDensity,
  type DrumParams,
  drumNotes,
} from '../src/generation/symbolic/drums'
import { makeNote } from './fixtures'

const GM = new Set([36, 38, 42, 46, 45, 47, 50, 49])
const TOMS = new Set([45, 47, 50])

const params = (partial: Partial<DrumParams> = {}): DrumParams => ({
  bars: 4,
  timeSig: '4/4',
  density: 'medium',
  ...partial,
})

describe('drumNotes', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = drumNotes(params(), mulberry32(11))
    const b = drumNotes(params(), mulberry32(11))
    const c = drumNotes(params(), mulberry32(12))
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c))
  })

  it('emits only GM kit pitches inside the bar window, with sane velocities', () => {
    for (const density of ['sparse', 'medium', 'busy'] as DrumDensity[]) {
      for (const timeSig of ['4/4', '3/4', '6/8']) {
        for (let seed = 1; seed <= 10; seed++) {
          const p = params({ density, timeSig, bars: 2 })
          const total = p.bars * beatsPerBar(timeSig)
          const notes = drumNotes(p, mulberry32(seed))
          expect(notes.length).toBeGreaterThanOrEqual(3)
          for (const n of notes) {
            expect(GM.has(n.pitch)).toBe(true)
            expect(n.pitch).toBeGreaterThanOrEqual(35)
            expect(n.startBeat).toBeGreaterThanOrEqual(0)
            expect(n.durationBeats).toBeGreaterThan(0)
            expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(total + 1e-6)
            expect(n.velocity).toBeGreaterThanOrEqual(1)
            expect(n.velocity).toBeLessThanOrEqual(127)
          }
        }
      }
    }
  })

  it('anchors every take with a downbeat kick, crash only when asked', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const withCrash = drumNotes(params(), mulberry32(seed))
      expect(withCrash.some((n) => n.pitch === 36 && n.startBeat === 0)).toBe(true)
      expect(withCrash.filter((n) => n.pitch === 49).length).toBe(1)
      expect(withCrash.find((n) => n.pitch === 49)?.startBeat).toBe(0)
      const noCrash = drumNotes(params({ crash: false }), mulberry32(seed))
      expect(noCrash.some((n) => n.pitch === 49)).toBe(false)
    }
  })

  it('keeps onsets on each signature’s 16th lattice', () => {
    for (const [timeSig, grid] of [
      ['4/4', 0.25],
      ['3/4', 0.25],
      ['6/8', 0.5], // the app beat is an 8th in /8 sigs, so a 16th is half a beat
    ] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const notes = drumNotes(params({ timeSig, density: 'busy' }), mulberry32(seed))
        for (const n of notes) {
          const steps = n.startBeat / grid
          expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('closes the last bar with a tom fill when enabled', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const p = params({ fill: true })
      const notes = drumNotes(p, mulberry32(seed))
      const lastBarStart = (p.bars - 1) * 4
      const fillHits = notes.filter((n) => n.startBeat >= lastBarStart)
      expect(fillHits.some((n) => TOMS.has(n.pitch) || n.pitch === 38)).toBe(true)
      // Fill off: the tail carries no toms at all.
      const flat = drumNotes(params({ fill: false }), mulberry32(seed))
      expect(flat.some((n) => TOMS.has(n.pitch))).toBe(false)
    }
  })

  it('scales hat density with the density setting', () => {
    const hats = (density: DrumDensity, seed: number) =>
      drumNotes(params({ density }), mulberry32(seed)).filter(
        (n) => n.pitch === 42 || n.pitch === 46,
      ).length
    for (let seed = 1; seed <= 10; seed++) {
      expect(hats('sparse', seed)).toBeLessThan(hats('medium', seed))
      expect(hats('medium', seed)).toBeLessThanOrEqual(hats('busy', seed))
    }
  })
})

describe('densityOf', () => {
  it('maps melodic busyness onto the three groove densities', () => {
    const line = (perBeat: number): Note[] => {
      const notes: Note[] = []
      for (let b = 0; b < 16 * perBeat; b++) {
        notes.push(makeNote({ pitch: 60, startBeat: b / perBeat, durationBeats: 0.5 / perBeat }))
      }
      return notes
    }
    expect(densityOf(line(0.5), 4, '4/4')).toBe('sparse')
    expect(densityOf(line(1), 4, '4/4')).toBe('medium')
    expect(densityOf(line(2), 4, '4/4')).toBe('busy')
  })
})

describe('validation round-trip', () => {
  it('a melody + generated drums motif passes validateBatch cleanly', () => {
    const melody = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, b) =>
      makeNote({ pitch, startBeat: b * 2, part: 0 }),
    )
    const drums = drumNotes(params(), mulberry32(3)).map((n) => ({ ...n, part: 1 }))
    const raw = {
      name: 'kit check',
      notes: [...melody, ...drums],
      parts: [
        { name: 'lead', instrument: 'synth' },
        { name: 'kit', instrument: 'drums' },
      ],
    }
    const result = validateBatch([raw], {
      key: 'C',
      mode: 'ionian',
      bars: 4,
      timeSig: '4/4',
      tempo: 120,
      allowChromatic: false,
      conceptId: null,
      source: () => ({ kind: 'seed' }) as const,
    })
    expect(result.errors).toEqual([])
    expect(result.valid).toHaveLength(1)
    expect(result.droppedCount).toBe(0)
    expect(result.valid[0].scaleWarning).toBe(false)
    expect(result.valid[0].notes.length).toBe(melody.length + drums.length)
  })
})
