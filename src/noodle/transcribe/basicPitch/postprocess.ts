/*
 * Ported from spotify/basic-pitch-ts (src/toMidi.ts) — posteriogram → note
 * post-processing for the Basic Pitch model. Behavior is kept faithful to the
 * reference (onset peak-picking, energy-tolerant frame following, the
 * "melodia trick" second pass, and the window-offset frame→time mapping);
 * pitch bends and MIDI-file emission are dropped — our data model carries
 * neither.
 *
 * Copyright 2022 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface BpNoteEvent {
  startFrame: number
  durationFrames: number
  pitchMidi: number
  amplitude: number
}

export interface BpNoteEventTime {
  startTimeSeconds: number
  durationSeconds: number
  pitchMidi: number
  amplitude: number
}

const MIDI_OFFSET = 21
export const BP_AUDIO_SAMPLE_RATE = 22050
const AUDIO_WINDOW_LENGTH = 2
export const BP_FFT_HOP = 256
export const BP_ANNOTATIONS_FPS = Math.floor(BP_AUDIO_SAMPLE_RATE / BP_FFT_HOP)
const ANNOT_N_FRAMES = BP_ANNOTATIONS_FPS * AUDIO_WINDOW_LENGTH
export const BP_AUDIO_N_SAMPLES = BP_AUDIO_SAMPLE_RATE * AUDIO_WINDOW_LENGTH - BP_FFT_HOP
const WINDOW_OFFSET =
  (BP_FFT_HOP / BP_AUDIO_SAMPLE_RATE) * (ANNOT_N_FRAMES - BP_AUDIO_N_SAMPLES / BP_FFT_HOP) + 0.0018 // reference magic constant for alignment
const MAX_FREQ_IDX = 87

export const BP_N_OVERLAPPING_FRAMES = 30
export const BP_OVERLAP_LENGTH = BP_N_OVERLAPPING_FRAMES * BP_FFT_HOP
export const BP_HOP_SIZE = BP_AUDIO_N_SAMPLES - BP_OVERLAP_LENGTH

const hzToMidi = (hz: number): number => 12 * (Math.log2(hz) - Math.log2(440.0)) + 69

/** Model frame index → seconds, correcting for the stitched-window offset. */
export const modelFrameToTime = (frame: number): number =>
  (frame * BP_FFT_HOP) / BP_AUDIO_SAMPLE_RATE - WINDOW_OFFSET * Math.floor(frame / ANNOT_N_FRAMES)

function globalMax(array: number[][]): number {
  return array.reduce((prev, row) => Math.max(prev, ...row), 0)
}

function argMax(arr: number[]): number {
  let best = 0
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i
  return best
}

/** Relative maxima over axis 0 (time), clipped edges — scipy argrelmax. */
export function argRelMax(array: number[][], order = 1): [number, number][] {
  const result: [number, number][] = []
  for (let col = 0; col < array[0].length; ++col) {
    for (let row = 0; row < array.length; ++row) {
      let isRelMax = true
      for (
        let cmp = Math.max(0, row - order);
        isRelMax && cmp <= Math.min(array.length - 1, row + order);
        ++cmp
      ) {
        if (cmp !== row) isRelMax = isRelMax && array[row][col] > array[cmp][col]
      }
      if (isRelMax) result.push([row, col])
    }
  }
  return result
}

/** Zero the posteriograms outside the frequency bounds (in place). */
export function constrainFrequency(
  onsets: number[][],
  frames: number[][],
  maxFreq: number | null,
  minFreq: number | null,
): void {
  if (maxFreq !== null) {
    const maxFreqIdx = Math.round(hzToMidi(maxFreq) - MIDI_OFFSET)
    for (const row of onsets) row.fill(0, maxFreqIdx)
    for (const row of frames) row.fill(0, maxFreqIdx)
  }
  if (minFreq !== null) {
    const minFreqIdx = Math.round(hzToMidi(minFreq) - MIDI_OFFSET)
    for (const row of onsets) row.fill(0, 0, minFreqIdx)
    for (const row of frames) row.fill(0, 0, minFreqIdx)
  }
}

/** Add inferred onsets from large frame-amplitude jumps (reference nDiff=2). */
export function getInferredOnsets(
  onsets: number[][],
  frames: number[][],
  nDiff = 2,
): number[][] {
  const nRows = frames.length
  const nCols = frames[0].length
  // min over n=1..nDiff of (frames - frames shifted by n), like the reference
  const frameDiff: number[][] = Array.from({ length: nRows }, () => new Array(nCols).fill(0))
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      let minDiff = Number.POSITIVE_INFINITY
      for (let n = 1; n <= nDiff; n++) {
        const prev = r - n >= 0 ? frames[r - n][c] : 0
        minDiff = Math.min(minDiff, frames[r][c] - prev)
      }
      frameDiff[r][c] = r < nDiff ? 0 : Math.max(minDiff, 0)
    }
  }
  const onsetMax = globalMax(onsets)
  const diffMax = globalMax(frameDiff)
  const out: number[][] = Array.from({ length: nRows }, () => new Array(nCols).fill(0))
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const rescaled = diffMax > 0 ? (onsetMax * frameDiff[r][c]) / diffMax : 0
      out[r][c] = Math.max(onsets[r][c], rescaled)
    }
  }
  return out
}

export interface OutputToNotesOptions {
  onsetThresh: number
  frameThresh: number
  /** Minimum note length in FRAMES (~11.6 ms each). */
  minNoteLen: number
  inferOnsets: boolean
  maxFreq: number | null
  minFreq: number | null
  melodiaTrick: boolean
  energyTolerance: number
}

export const BP_DEFAULTS: OutputToNotesOptions = {
  onsetThresh: 0.5,
  frameThresh: 0.3,
  minNoteLen: 11,
  inferOnsets: true,
  maxFreq: null,
  minFreq: null,
  melodiaTrick: true,
  energyTolerance: 11,
}

/**
 * Decode raw model output to polyphonic note events. Faithful port of the
 * reference `outputToNotesPoly`. MUTATES `frames`/`onsets` when frequency
 * bounds are set — pass copies if the posteriograms are reused (the client
 * re-runs this on knob changes, so it always passes fresh copies).
 */
export function outputToNotesPoly(
  frames: number[][],
  onsets: number[][],
  options: Partial<OutputToNotesOptions> = {},
): BpNoteEvent[] {
  const opts: OutputToNotesOptions = { ...BP_DEFAULTS, ...options }
  const nFrames = frames.length
  if (nFrames === 0) return []

  constrainFrequency(onsets, frames, opts.maxFreq, opts.minFreq)
  const inferredOnsets = opts.inferOnsets ? getInferredOnsets(onsets, frames) : onsets

  const peakThresholdMatrix = inferredOnsets.map((o) => o.map(() => 0))
  for (const [row, col] of argRelMax(inferredOnsets)) {
    peakThresholdMatrix[row][col] = inferredOnsets[row][col]
  }

  const noteStarts: number[] = []
  const freqIdxs: number[] = []
  for (let i = 0; i < peakThresholdMatrix.length; i++) {
    for (let j = 0; j < peakThresholdMatrix[i].length; j++) {
      if (peakThresholdMatrix[i][j] > opts.onsetThresh) {
        noteStarts.push(i)
        freqIdxs.push(j)
      }
    }
  }
  noteStarts.reverse()
  freqIdxs.reverse()

  const remainingEnergy = frames.map((row) => row.slice())
  const noteEvents: BpNoteEvent[] = []

  noteStarts.forEach((noteStartIdx, idx) => {
    const freqIdx = freqIdxs[idx]
    if (noteStartIdx >= nFrames - 1) return

    let i = noteStartIdx + 1
    let k = 0
    while (i < nFrames - 1 && k < opts.energyTolerance) {
      if (remainingEnergy[i][freqIdx] < opts.frameThresh) k += 1
      else k = 0
      i += 1
    }
    i -= k

    if (i - noteStartIdx <= opts.minNoteLen) return

    for (let j = noteStartIdx; j < i; ++j) {
      remainingEnergy[j][freqIdx] = 0
      if (freqIdx < MAX_FREQ_IDX) remainingEnergy[j][freqIdx + 1] = 0
      if (freqIdx > 0) remainingEnergy[j][freqIdx - 1] = 0
    }

    let ampSum = 0
    for (let j = noteStartIdx; j < i; j++) ampSum += frames[j][freqIdx]
    noteEvents.push({
      startFrame: noteStartIdx,
      durationFrames: i - noteStartIdx,
      pitchMidi: freqIdx + MIDI_OFFSET,
      amplitude: ampSum / (i - noteStartIdx),
    })
  })

  if (opts.melodiaTrick) {
    while (globalMax(remainingEnergy) > opts.frameThresh) {
      let iMid = 0
      let freqIdx = 0
      for (let r = 0; r < remainingEnergy.length; r++) {
        const c = argMax(remainingEnergy[r])
        if (remainingEnergy[r][c] > remainingEnergy[iMid][freqIdx]) {
          iMid = r
          freqIdx = c
        }
      }
      remainingEnergy[iMid][freqIdx] = 0

      let i = iMid + 1
      let k = 0
      while (i < nFrames - 1 && k < opts.energyTolerance) {
        if (remainingEnergy[i][freqIdx] < opts.frameThresh) k += 1
        else k = 0
        remainingEnergy[i][freqIdx] = 0
        if (freqIdx < MAX_FREQ_IDX) remainingEnergy[i][freqIdx + 1] = 0
        if (freqIdx > 0) remainingEnergy[i][freqIdx - 1] = 0
        i += 1
      }
      const iEnd = i - 1 - k

      i = iMid - 1
      k = 0
      while (i > 0 && k < opts.energyTolerance) {
        if (remainingEnergy[i][freqIdx] < opts.frameThresh) k += 1
        else k = 0
        remainingEnergy[i][freqIdx] = 0
        if (freqIdx < MAX_FREQ_IDX) remainingEnergy[i][freqIdx + 1] = 0
        if (freqIdx > 0) remainingEnergy[i][freqIdx - 1] = 0
        i -= 1
      }
      const iStart = i + 1 + k

      if (iEnd - iStart <= opts.minNoteLen) continue

      let ampSum = 0
      for (let j = iStart; j < iEnd; j++) ampSum += frames[j][freqIdx]
      noteEvents.push({
        startFrame: iStart,
        durationFrames: iEnd - iStart,
        pitchMidi: freqIdx + MIDI_OFFSET,
        amplitude: ampSum / (iEnd - iStart),
      })
    }
  }

  return noteEvents
}

export const noteFramesToTime = (notes: BpNoteEvent[]): BpNoteEventTime[] =>
  notes.map((note) => ({
    pitchMidi: note.pitchMidi,
    amplitude: note.amplitude,
    startTimeSeconds: modelFrameToTime(note.startFrame),
    durationSeconds:
      modelFrameToTime(note.startFrame + note.durationFrames) - modelFrameToTime(note.startFrame),
  }))
