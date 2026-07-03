import { describe, expect, it } from 'vitest'
import type { Note } from '../src/types'
import { type RawMotif, trimRawMotif } from '../src/generation/neural/adapters'

const note = (startBeat: number, durationBeats = 1): Note => ({
  pitch: 60,
  startBeat,
  durationBeats,
  velocity: 90,
})

const raw = (notes: Note[], bars = 4): RawMotif => ({
  notes,
  parts: [],
  key: 'C',
  mode: 'ionian',
  bars,
  timeSig: '4/4',
  tempo: 120,
})

describe('trimRawMotif', () => {
  it('drops whole blank bars at the start, keeping the in-bar offset', () => {
    // content begins at beat 9.5 — two blank bars, then a half-beat pickup
    const out = trimRawMotif(raw([note(9.5), note(10), note(12)]), 0, 4)
    expect(out.notes.map((n) => n.startBeat)).toEqual([1.5, 2, 4])
    expect(out.bars).toBe(4)
  })

  it('leaves a partial-bar pickup alone', () => {
    const out = trimRawMotif(raw([note(2), note(3), note(4)]), 0, 4)
    expect(out.notes.map((n) => n.startBeat)).toEqual([2, 3, 4])
  })

  it('shifts before clamping, so late content slides into the window', () => {
    // all notes sit in bars 3-4 of a 2-bar request: previously all dropped
    const out = trimRawMotif(raw([note(8), note(10), note(12)]), 0, 2)
    expect(out.notes.map((n) => n.startBeat)).toEqual([0, 2, 4])
    expect(out.notes).toHaveLength(3)
  })

  it('rebases continuations to fromBeat before detecting blank bars', () => {
    // keeper prompt fills beats 0-8; generation resumes with a blank bar
    const prompt = [note(0), note(4)]
    const generated = [note(12), note(13), note(14)]
    const out = trimRawMotif(raw([...prompt, ...generated], 8), 8, 4)
    expect(out.notes.map((n) => n.startBeat)).toEqual([0, 1, 2])
  })

  it('still clamps trailing durations into the bar window', () => {
    const out = trimRawMotif(raw([note(0), note(14, 8)]), 0, 4)
    expect(out.notes[1].durationBeats).toBe(2)
  })

  it('handles an all-blank decode without shifting anything', () => {
    const out = trimRawMotif(raw([]), 0, 4)
    expect(out.notes).toEqual([])
  })
})
