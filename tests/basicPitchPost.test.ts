import { describe, expect, it } from 'vitest'
import {
  argRelMax,
  BP_ANNOTATIONS_FPS,
  BP_AUDIO_SAMPLE_RATE,
  BP_FFT_HOP,
  constrainFrequency,
  getInferredOnsets,
  modelFrameToTime,
  noteFramesToTime,
  outputToNotesPoly,
} from '../src/noodle/transcribe/basicPitch/postprocess'

const N_BINS = 88
const MIDI_OFFSET = 21

/** nFrames × 88 zero posteriogram. */
const zeros = (nFrames: number): number[][] =>
  Array.from({ length: nFrames }, () => new Array(N_BINS).fill(0))

/** Paint one note: onset spike + sustained frame energy at a pitch bin. */
function paintNote(
  frames: number[][],
  onsets: number[][],
  pitch: number,
  startFrame: number,
  durFrames: number,
  energy = 0.9,
  onset = 0.9,
): void {
  const bin = pitch - MIDI_OFFSET
  onsets[startFrame][bin] = onset
  for (let f = startFrame; f < startFrame + durFrames; f++) frames[f][bin] = energy
}

describe('outputToNotesPoly', () => {
  it('extracts a clean onset-led note', () => {
    const frames = zeros(100)
    const onsets = zeros(100)
    paintNote(frames, onsets, 60, 10, 30)
    const notes = outputToNotesPoly(frames, onsets, { inferOnsets: false, melodiaTrick: false })
    expect(notes).toHaveLength(1)
    expect(notes[0].pitchMidi).toBe(60)
    expect(notes[0].startFrame).toBe(10)
    // the follower runs to the frame where energy drops below threshold
    expect(notes[0].durationFrames).toBeGreaterThanOrEqual(28)
    expect(notes[0].durationFrames).toBeLessThanOrEqual(32)
    expect(notes[0].amplitude).toBeCloseTo(0.9, 5)
  })

  it('drops notes shorter than minNoteLen', () => {
    const frames = zeros(100)
    const onsets = zeros(100)
    paintNote(frames, onsets, 60, 10, 5)
    const notes = outputToNotesPoly(frames, onsets, {
      inferOnsets: false,
      melodiaTrick: false,
      minNoteLen: 11,
    })
    expect(notes).toHaveLength(0)
  })

  it('separates two polyphonic notes', () => {
    const frames = zeros(120)
    const onsets = zeros(120)
    paintNote(frames, onsets, 60, 10, 40)
    paintNote(frames, onsets, 67, 30, 40)
    const notes = outputToNotesPoly(frames, onsets, { inferOnsets: false, melodiaTrick: false })
    expect(notes.map((n) => n.pitchMidi).sort((a, b) => a - b)).toEqual([60, 67])
  })

  it('melodiaTrick rescues sustained energy with no onset', () => {
    const frames = zeros(100)
    const onsets = zeros(100)
    const bin = 64 - MIDI_OFFSET
    for (let f = 20; f < 60; f++) frames[f][bin] = 0.8
    const notes = outputToNotesPoly(frames, onsets, { inferOnsets: false, melodiaTrick: true })
    expect(notes).toHaveLength(1)
    expect(notes[0].pitchMidi).toBe(64)
    expect(notes[0].startFrame).toBeGreaterThanOrEqual(19)
    expect(notes[0].startFrame).toBeLessThanOrEqual(22)
  })

  it('respects the onset threshold knob', () => {
    const frames = zeros(100)
    const onsets = zeros(100)
    paintNote(frames, onsets, 60, 10, 30, 0.9, 0.4)
    const strict = outputToNotesPoly(frames.map((r) => r.slice()), onsets.map((r) => r.slice()), {
      inferOnsets: false,
      melodiaTrick: false,
      onsetThresh: 0.5,
    })
    expect(strict).toHaveLength(0)
    const lax = outputToNotesPoly(frames.map((r) => r.slice()), onsets.map((r) => r.slice()), {
      inferOnsets: false,
      melodiaTrick: false,
      onsetThresh: 0.3,
    })
    expect(lax).toHaveLength(1)
  })

  it('respects the frame threshold knob (note sensitivity)', () => {
    const frames = zeros(100)
    const onsets = zeros(100)
    paintNote(frames, onsets, 60, 10, 30, 0.25)
    const strict = outputToNotesPoly(frames.map((r) => r.slice()), onsets.map((r) => r.slice()), {
      inferOnsets: false,
      melodiaTrick: false,
      frameThresh: 0.3,
    })
    expect(strict).toHaveLength(0)
    const lax = outputToNotesPoly(frames.map((r) => r.slice()), onsets.map((r) => r.slice()), {
      inferOnsets: false,
      melodiaTrick: false,
      frameThresh: 0.2,
    })
    expect(lax).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('argRelMax finds isolated time-axis peaks', () => {
    const m = zeros(10)
    m[3][5] = 0.9
    m[7][2] = 0.5
    const peaks = argRelMax(m)
    expect(peaks).toContainEqual([3, 5])
    expect(peaks).toContainEqual([7, 2])
    expect(peaks.filter(([, c]) => c === 5)).toHaveLength(1)
  })

  it('constrainFrequency zeroes bins outside the range', () => {
    const frames = zeros(4)
    const onsets = zeros(4)
    frames[0][0] = 1 // A0 (21) — below min
    frames[0][39] = 1 // C4 (60) — inside
    constrainFrequency(onsets, frames, 2000, 100)
    expect(frames[0][0]).toBe(0)
    expect(frames[0][39]).toBe(1)
  })

  it('getInferredOnsets adds onsets at sharp frame rises', () => {
    const frames = zeros(20)
    const onsets = zeros(20)
    onsets[2][10] = 0.6 // establishes the onset max used for rescaling
    for (let f = 10; f < 15; f++) frames[f][30] = 0.9 // sharp rise at f=10
    const inferred = getInferredOnsets(onsets, frames)
    expect(inferred[10][30]).toBeCloseTo(0.6, 5)
    expect(inferred[2][10]).toBeCloseTo(0.6, 5)
    expect(inferred[12][30]).toBe(0) // sustain, no rise
  })

  it('modelFrameToTime matches the hop math inside one window', () => {
    expect(modelFrameToTime(0)).toBeCloseTo(0, 10)
    expect(modelFrameToTime(86)).toBeCloseTo((86 * BP_FFT_HOP) / BP_AUDIO_SAMPLE_RATE, 10)
  })

  it('modelFrameToTime subtracts one window offset per stitched window', () => {
    const perWindow = modelFrameToTime(172) - (172 * BP_FFT_HOP) / BP_AUDIO_SAMPLE_RATE
    const twoWindows = modelFrameToTime(344) - (344 * BP_FFT_HOP) / BP_AUDIO_SAMPLE_RATE
    expect(perWindow).toBeLessThan(0)
    expect(twoWindows).toBeCloseTo(2 * perWindow, 10)
  })

  it('noteFramesToTime converts start and duration', () => {
    const [t] = noteFramesToTime([
      { startFrame: 43, durationFrames: 43, pitchMidi: 60, amplitude: 0.5 },
    ])
    // 43 frames ≈ half a second at ~86 fps
    expect(t.startTimeSeconds).toBeCloseTo(0.499, 2)
    expect(t.durationSeconds).toBeCloseTo(0.499, 2)
    expect(BP_ANNOTATIONS_FPS).toBe(86)
  })
})
