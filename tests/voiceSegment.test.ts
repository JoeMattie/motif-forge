import { describe, expect, it } from 'vitest'
import {
  segmentPitchTrack,
  segmentsToNotes,
  SEGMENT_DEFAULTS,
  type PitchFrame,
} from '../src/noodle/transcribe/voice'

const FRAME_SEC = 0.0232 // ≈ hop 256 at 11025 Hz

const opts = { frameSec: FRAME_SEC, ...SEGMENT_DEFAULTS }

const voiced = (midi: number, rms = 0.1): PitchFrame => ({ midi, confidence: 0.9, rms })
const silent = (): PitchFrame => ({ midi: null, confidence: 0, rms: 0.001 })

const run = (frames: PitchFrame[]) => segmentPitchTrack(frames, opts)

describe('segmentPitchTrack', () => {
  it('turns one sustained pitch into one note', () => {
    const frames = Array.from({ length: 20 }, () => voiced(60))
    const notes = run(frames)
    expect(notes).toHaveLength(1)
    expect(notes[0].pitchMidi).toBe(60)
    expect(notes[0].startSec).toBeCloseTo(0)
    expect(notes[0].durationSec).toBeCloseTo(20 * FRAME_SEC, 5)
  })

  it('splits on a sustained pitch change', () => {
    const frames = [
      ...Array.from({ length: 15 }, () => voiced(60)),
      ...Array.from({ length: 15 }, () => voiced(64)),
    ]
    const notes = run(frames)
    expect(notes).toHaveLength(2)
    expect(notes[0].pitchMidi).toBe(60)
    expect(notes[1].pitchMidi).toBe(64)
    // the second note starts where the pitch actually moved
    expect(notes[1].startSec).toBeCloseTo(15 * FRAME_SEC, 3)
  })

  it('does NOT split on vibrato-sized wobble', () => {
    const frames = Array.from({ length: 30 }, (_, i) => voiced(60 + 0.4 * Math.sin(i / 2)))
    const notes = run(frames)
    expect(notes).toHaveLength(1)
    expect(notes[0].pitchMidi).toBe(60)
  })

  it('closes notes across silence gaps', () => {
    const frames = [
      ...Array.from({ length: 12 }, () => voiced(62)),
      ...Array.from({ length: 6 }, () => silent()),
      ...Array.from({ length: 12 }, () => voiced(62)),
    ]
    const notes = run(frames)
    expect(notes).toHaveLength(2)
    expect(notes.every((n) => n.pitchMidi === 62)).toBe(true)
  })

  it('splits repeated same-pitch syllables on energy re-onset', () => {
    const frames = [
      ...Array.from({ length: 12 }, () => voiced(60, 0.12)),
      voiced(60, 0.03), // dip below 40% of peak
      ...Array.from({ length: 12 }, () => voiced(60, 0.12)), // re-attack
    ]
    const notes = run(frames)
    expect(notes.length).toBe(2)
  })

  it('drops blips shorter than the minimum note length', () => {
    const frames = [
      ...Array.from({ length: 2 }, () => voiced(70)),
      ...Array.from({ length: 4 }, () => silent()),
      ...Array.from({ length: 20 }, () => voiced(60)),
    ]
    const notes = run(frames)
    expect(notes).toHaveLength(1)
    expect(notes[0].pitchMidi).toBe(60)
  })

  it('rounds the fractional track to the nearest semitone via the median', () => {
    const frames = Array.from({ length: 20 }, () => voiced(63.4))
    expect(run(frames)[0].pitchMidi).toBe(63)
  })
})

describe('segmentsToNotes', () => {
  it('maps seconds to beats on the known click grid', () => {
    // 120 BPM → 0.5 s per beat
    const notes = segmentsToNotes(
      [
        { pitchMidi: 60, startSec: 0, durationSec: 0.5, amplitude: 0.2 },
        { pitchMidi: 64, startSec: 1.0, durationSec: 0.25, amplitude: 0.1 },
      ],
      120,
      16,
    )
    expect(notes).toHaveLength(2)
    expect(notes[0].startBeat).toBeCloseTo(0)
    expect(notes[0].durationBeats).toBeCloseTo(1)
    expect(notes[1].startBeat).toBeCloseTo(2)
    expect(notes[1].durationBeats).toBeCloseTo(0.5)
    // loudest note gets the highest velocity
    expect(notes[0].velocity).toBeGreaterThan(notes[1].velocity)
    expect(notes[0].velocity).toBe(120)
  })

  it('drops notes past the loop end and clamps overhangs', () => {
    const notes = segmentsToNotes(
      [
        { pitchMidi: 60, startSec: 8.1, durationSec: 0.5, amplitude: 0.2 }, // past 16 beats @120
        { pitchMidi: 62, startSec: 7.5, durationSec: 2.0, amplitude: 0.2 }, // overhangs
      ],
      120,
      16,
    )
    expect(notes).toHaveLength(1)
    expect(notes[0].pitch).toBe(62)
    expect(notes[0].startBeat).toBeCloseTo(15)
    expect(notes[0].durationBeats).toBeCloseTo(1)
  })

  it('clamps pitches into the motif range', () => {
    const notes = segmentsToNotes(
      [{ pitchMidi: 30, startSec: 0, durationSec: 0.5, amplitude: 0.2 }],
      120,
      16,
    )
    expect(notes[0].pitch).toBe(36)
  })
})
