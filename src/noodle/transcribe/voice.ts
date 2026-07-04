/**
 * VOICE transcription: hand-rolled YIN monophonic pitch tracking + note
 * segmentation, tuned for hum/whistle/singing (near-sinusoidal input). Pure
 * functions end to end — unit-tested on synthesized signals
 * (tests/yin.test.ts, tests/voiceSegment.test.ts).
 *
 * Pipeline: decimate to ~11 kHz → per-frame YIN (difference function → CMNDF
 * → threshold + parabolic interpolation) → confidence/energy voicing gate →
 * median smoothing + octave-jump correction → segmentation (sustained pitch
 * change or energy re-onset opens a new note) → beats (tempo is known — the
 * capture window is click-synced).
 */
import type { Note } from '../../types'

export interface YinOptions {
  frameSize: number // analysis window (power of two not required)
  hop: number
  threshold: number // CMNDF dip threshold
  fMin: number
  fMax: number
}

export const YIN_DEFAULTS: YinOptions = {
  frameSize: 1024,
  hop: 256,
  threshold: 0.15,
  fMin: 60,
  fMax: 1400,
}

export interface PitchFrame {
  /** Fractional MIDI pitch, or null when unvoiced. */
  midi: number | null
  /** 1 − CMNDF at the chosen lag (0..1, higher = more periodic). */
  confidence: number
  rms: number
}

export const hzToMidi = (hz: number): number => 12 * Math.log2(hz / 440) + 69

/**
 * Halfband-ish decimation by an integer factor with a short triangular
 * pre-filter — enough anti-aliasing for f0 tracking of voice-band signals.
 */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples
  const out = new Float32Array(Math.floor(samples.length / factor))
  for (let i = 0; i < out.length; i++) {
    const c = i * factor
    let sum = 0
    let wsum = 0
    for (let k = -factor + 1; k < factor; k++) {
      const j = c + k
      if (j < 0 || j >= samples.length) continue
      const w = factor - Math.abs(k)
      sum += samples[j] * w
      wsum += w
    }
    out[i] = sum / wsum
  }
  return out
}

/** Decimation factor that lands the rate in the 8–16 kHz band YIN wants. */
export function decimationFactor(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate / 11025))
}

/**
 * One YIN estimate over `frame` (length ≥ frameSize). Returns the f0 in Hz
 * and the CMNDF value at the chosen lag (lower = stronger periodicity), or
 * null when no dip beats the threshold.
 */
export function yinFrame(
  frame: Float32Array,
  sampleRate: number,
  opts: YinOptions = YIN_DEFAULTS,
): { f0: number | null; cmndf: number } {
  const w = Math.floor(opts.frameSize / 2)
  const tauMin = Math.max(2, Math.floor(sampleRate / opts.fMax))
  const tauMax = Math.min(w - 1, Math.ceil(sampleRate / opts.fMin))
  if (tauMax <= tauMin) return { f0: null, cmndf: 1 }

  // Difference function d(tau) over a w-sample window.
  const d = new Float64Array(tauMax + 1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0
    for (let j = 0; j < w; j++) {
      const diff = frame[j] - frame[j + tau]
      sum += diff * diff
    }
    d[tau] = sum
  }
  // Cumulative-mean-normalized difference function.
  const cmndf = new Float64Array(tauMax + 1)
  cmndf[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]
    cmndf[tau] = running === 0 ? 1 : (d[tau] * tau) / running
  }

  // First dip under the threshold (descend to its local minimum), else the
  // global minimum — reported with its CMNDF so the caller can gate voicing.
  let tau = -1
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmndf[t] < opts.threshold) {
      while (t + 1 <= tauMax && cmndf[t + 1] < cmndf[t]) t++
      tau = t
      break
    }
  }
  if (tau === -1) {
    let best = tauMin
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmndf[t] < cmndf[best]) best = t
    return { f0: null, cmndf: cmndf[best] }
  }

  // Parabolic interpolation around the dip for sub-sample lag precision.
  let refined = tau
  if (tau > 1 && tau < tauMax) {
    const a = cmndf[tau - 1]
    const b = cmndf[tau]
    const c = cmndf[tau + 1]
    const denom = a - 2 * b + c
    if (Math.abs(denom) > 1e-12) {
      const delta = (0.5 * (a - c)) / denom
      if (Math.abs(delta) < 1) refined = tau + delta
    }
  }
  return { f0: sampleRate / refined, cmndf: cmndf[tau] }
}

/** Frame-by-frame pitch track with RMS, voicing-gated. */
export function yinTrack(
  samples: Float32Array,
  sampleRate: number,
  opts: YinOptions = YIN_DEFAULTS,
): PitchFrame[] {
  const frames: PitchFrame[] = []
  if (samples.length < opts.frameSize) return frames
  // Energy gate is relative to the take's own level (plus an absolute floor).
  let peakRms = 0
  const rmsAt = (from: number): number => {
    let sum = 0
    for (let j = from; j < from + opts.frameSize; j++) sum += samples[j] * samples[j]
    return Math.sqrt(sum / opts.frameSize)
  }
  for (let i = 0; i + opts.frameSize <= samples.length; i += opts.hop) {
    peakRms = Math.max(peakRms, rmsAt(i))
  }
  const gate = Math.max(0.004, peakRms * 0.06)

  for (let i = 0; i + opts.frameSize <= samples.length; i += opts.hop) {
    const rms = rmsAt(i)
    if (rms < gate) {
      frames.push({ midi: null, confidence: 0, rms })
      continue
    }
    const { f0, cmndf } = yinFrame(samples.subarray(i, i + opts.frameSize), sampleRate, opts)
    if (f0 === null) {
      frames.push({ midi: null, confidence: Math.max(0, 1 - cmndf), rms })
    } else {
      frames.push({ midi: hzToMidi(f0), confidence: Math.max(0, 1 - cmndf), rms })
    }
  }
  return frames
}

/** Median smoothing over voiced values (nulls pass through untouched). */
export function medianSmooth(values: (number | null)[], radius = 2): (number | null)[] {
  return values.map((v, i) => {
    if (v === null) return null
    const window: number[] = []
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      const x = values[j]
      if (x !== null) window.push(x)
    }
    window.sort((a, b) => a - b)
    return window[Math.floor(window.length / 2)]
  })
}

/**
 * Octave-error correction: a voiced frame sitting ~an octave off the recent
 * voiced median folds back toward it (classic YIN halving/doubling glitches).
 * Only TRANSIENT glitches fold — when the following voiced frame agrees with
 * the jump, it's treated as a genuine octave move and left alone.
 */
export function correctOctaveJumps(values: (number | null)[]): (number | null)[] {
  const out = values.slice()
  const nextVoiced = (from: number): number | null => {
    for (let j = from; j < values.length; j++) {
      const x = values[j]
      if (x !== null) return x
    }
    return null
  }
  const recent: number[] = []
  for (let i = 0; i < out.length; i++) {
    const v = out[i]
    if (v === null) continue
    if (recent.length >= 3) {
      const sorted = [...recent].sort((a, b) => a - b)
      const ref = sorted[Math.floor(sorted.length / 2)]
      for (const shift of [-12, 12, -24, 24]) {
        if (Math.abs(v + shift - ref) < 3 && Math.abs(v - ref) > 7) {
          const next = nextVoiced(i + 1)
          if (next === null || Math.abs(next - ref) < Math.abs(next - v)) {
            out[i] = v + shift
          }
          break
        }
      }
    }
    recent.push(out[i] as number)
    if (recent.length > 8) recent.shift()
  }
  return out
}

export interface SegmentOptions {
  /** Seconds per analysis frame (hop / sampleRate). */
  frameSec: number
  minNoteSec: number
  /** Sustained pitch drift (semitones) that splits a note. */
  splitSemitones: number
  /** Frames of drift/silence tolerated before acting. */
  toleranceFrames: number
}

export const SEGMENT_DEFAULTS = {
  minNoteSec: 0.08,
  splitSemitones: 0.6,
  toleranceFrames: 2,
}

export interface SegmentedNote {
  pitchMidi: number
  startSec: number
  durationSec: number
  /** Mean RMS over the note, for velocity mapping. */
  amplitude: number
}

/**
 * Turn a (smoothed) pitch track into note events: a note opens on a voiced
 * run, closes after `toleranceFrames` of silence, and splits when the pitch
 * stays ≥ splitSemitones away from the note's running center — or when the
 * energy dips and re-attacks (repeated same-pitch syllables).
 */
export function segmentPitchTrack(
  frames: PitchFrame[],
  opts: SegmentOptions,
): SegmentedNote[] {
  const notes: SegmentedNote[] = []
  interface Open {
    start: number
    midis: number[]
    rmsSum: number
    peakRms: number
    dipped: boolean
    driftCount: number
  }
  let open: Open | null = null
  let silence = 0

  const close = (endFrame: number) => {
    if (!open) return
    const n = open.midis.length
    const durationSec = (endFrame - open.start) * opts.frameSec
    if (n > 0 && durationSec >= opts.minNoteSec) {
      const sorted = [...open.midis].sort((a, b) => a - b)
      notes.push({
        pitchMidi: Math.round(sorted[Math.floor(n / 2)]),
        startSec: open.start * opts.frameSec,
        durationSec,
        amplitude: open.rmsSum / n,
      })
    }
    open = null
  }

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f.midi === null) {
      if (open) {
        silence++
        if (silence > opts.toleranceFrames) close(i - silence + 1)
      }
      continue
    }
    silence = 0
    if (!open) {
      open = { start: i, midis: [f.midi], rmsSum: f.rms, peakRms: f.rms, dipped: false, driftCount: 0 }
      continue
    }
    const o: Open = open
    const center = o.midis.reduce((a, b) => a + b, 0) / o.midis.length
    // Energy re-onset: dip below 40% of the note's peak, then re-attack.
    if (f.rms < o.peakRms * 0.4) o.dipped = true
    const reAttack = o.dipped && f.rms > o.peakRms * 0.75
    if (Math.abs(f.midi - center) >= opts.splitSemitones) {
      o.driftCount++
    } else {
      o.driftCount = 0
    }
    if (o.driftCount > opts.toleranceFrames || reAttack) {
      // Split where the drift actually began (driftCount includes frame i).
      const splitAt = reAttack ? i : i - o.driftCount + 1
      close(splitAt)
      open = { start: splitAt, midis: [f.midi], rmsSum: f.rms, peakRms: f.rms, dipped: false, driftCount: 0 }
      continue
    }
    o.midis.push(f.midi)
    o.rmsSum += f.rms
    o.peakRms = Math.max(o.peakRms, f.rms)
  }
  close(frames.length)
  return notes
}

/** Map segmented notes to the motif model on the known click grid. */
export function segmentsToNotes(
  segments: SegmentedNote[],
  tempo: number,
  totalBeats: number,
): Note[] {
  const spb = 60 / tempo
  const maxAmp = segments.reduce((m, s) => Math.max(m, s.amplitude), 0)
  const out: Note[] = []
  for (const s of segments) {
    const startBeat = s.startSec / spb
    if (startBeat >= totalBeats - 1e-3) continue
    const durationBeats = Math.min(totalBeats - startBeat, s.durationSec / spb)
    const pitch = Math.max(36, Math.min(96, s.pitchMidi))
    const velocity = maxAmp > 0 ? Math.round(40 + 80 * (s.amplitude / maxAmp)) : 90
    out.push({
      pitch,
      startBeat,
      durationBeats: Math.max(0.05, durationBeats),
      velocity: Math.max(1, Math.min(127, velocity)),
      part: 0,
    })
  }
  return out
}

/** The whole VOICE pipeline: mono samples in, motif notes out. */
export function transcribeVoice(
  samples: Float32Array,
  sampleRate: number,
  cfg: { tempo: number; totalBeats: number },
): Note[] {
  const factor = decimationFactor(sampleRate)
  const ds = decimate(samples, factor)
  const sr = sampleRate / factor
  const frames = yinTrack(ds, sr)
  const smoothed = medianSmooth(
    frames.map((f) => f.midi),
    2,
  )
  const corrected = correctOctaveJumps(smoothed)
  const track: PitchFrame[] = frames.map((f, i) => ({ ...f, midi: corrected[i] }))
  const segments = segmentPitchTrack(track, {
    frameSec: YIN_DEFAULTS.hop / sr,
    ...SEGMENT_DEFAULTS,
  })
  return segmentsToNotes(segments, cfg.tempo, cfg.totalBeats)
}
