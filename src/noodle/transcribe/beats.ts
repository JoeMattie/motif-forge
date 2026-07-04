/**
 * BEATS transcription: spectral-flux onset detection plus a per-hit
 * spectral-feature heuristic (band-energy ratios, spectral centroid, ZCR)
 * that maps beatbox hits to kick 36 / snare 38 / closed hat 42. Pure DSP,
 * zero download — unit-tested on synthesized bursts
 * (tests/beatsClassify.test.ts).
 */
import type { Note } from '../../types'
import { decimate } from './voice'

export const KICK = 36
export const SNARE = 38
export const HAT = 42

/** In-place iterative radix-2 FFT (re/im length must be a power of two). */
export function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if ((n & (n - 1)) !== 0) throw new Error('fft size must be a power of two')
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Hann-windowed magnitude spectrum of samples[from..from+size). */
export function magnitudeSpectrum(
  samples: Float32Array,
  from: number,
  size: number,
): Float64Array {
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    const s = from + i < samples.length ? samples[from + i] : 0
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
    re[i] = s * w
  }
  fftRadix2(re, im)
  const mags = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) mags[i] = Math.hypot(re[i], im[i])
  return mags
}

export interface FluxOptions {
  fftSize: number
  hop: number
}

export const FLUX_DEFAULTS: FluxOptions = { fftSize: 1024, hop: 256 }

/** Positive spectral flux per frame (half-wave rectified magnitude change). */
export function spectralFlux(
  samples: Float32Array,
  opts: FluxOptions = FLUX_DEFAULTS,
): Float64Array {
  const { fftSize, hop } = opts
  const nFrames = Math.max(0, Math.floor((samples.length - fftSize) / hop) + 1)
  const flux = new Float64Array(nFrames)
  let prev: Float64Array | null = null
  for (let f = 0; f < nFrames; f++) {
    const mags = magnitudeSpectrum(samples, f * hop, fftSize)
    if (prev) {
      let sum = 0
      for (let i = 0; i < mags.length; i++) {
        const d = mags[i] - prev[i]
        if (d > 0) sum += d
      }
      flux[f] = sum
    }
    prev = mags
  }
  return flux
}

export interface OnsetOptions {
  /** Frames the local mean looks back. */
  preAvg: number
  /** Threshold above the local mean, as a fraction of the global peak. */
  delta: number
  /** Minimum frames between accepted onsets. */
  minGap: number
}

export const ONSET_DEFAULTS: OnsetOptions = { preAvg: 8, delta: 0.08, minGap: 4 }

/** Peak-pick the flux curve: local maxima over an adaptive threshold. */
export function pickOnsets(flux: Float64Array, opts: OnsetOptions = ONSET_DEFAULTS): number[] {
  const peak = flux.reduce((m, v) => Math.max(m, v), 0)
  if (peak <= 0) return []
  const onsets: number[] = []
  let last = -opts.minGap
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue
    let mean = 0
    let count = 0
    for (let j = Math.max(0, i - opts.preAvg); j < i; j++) {
      mean += flux[j]
      count++
    }
    mean = count > 0 ? mean / count : 0
    if (flux[i] > mean + opts.delta * peak && i - last >= opts.minGap) {
      onsets.push(i)
      last = i
    }
  }
  return onsets
}

export interface HitFeatures {
  /** Energy fraction below ~200 Hz. */
  lowRatio: number
  /** Energy fraction above ~4 kHz. */
  highRatio: number
  centroidHz: number
  /** Zero-crossing rate (crossings per sample, 0..1). */
  zcr: number
  /** RMS over the analysis window — velocity source. */
  rms: number
}

const LOW_HZ = 200
const HIGH_HZ = 4000

/** Spectral/time features over a short window right after the onset. */
export function hitFeatures(
  samples: Float32Array,
  sampleRate: number,
  from: number,
  fftSize = 1024,
): HitFeatures {
  const mags = magnitudeSpectrum(samples, from, fftSize)
  const binHz = sampleRate / fftSize
  let total = 0
  let low = 0
  let high = 0
  let weighted = 0
  for (let i = 1; i < mags.length; i++) {
    const e = mags[i] * mags[i]
    const hz = i * binHz
    total += e
    weighted += e * hz
    if (hz < LOW_HZ) low += e
    if (hz > HIGH_HZ) high += e
  }
  let crossings = 0
  let sumSq = 0
  const end = Math.min(samples.length, from + fftSize)
  for (let i = from; i < end; i++) {
    sumSq += samples[i] * samples[i]
    if (i > from && samples[i - 1] < 0 !== samples[i] < 0) crossings++
  }
  const n = Math.max(1, end - from)
  return {
    lowRatio: total > 0 ? low / total : 0,
    highRatio: total > 0 ? high / total : 0,
    centroidHz: total > 0 ? weighted / total : 0,
    zcr: crossings / n,
    rms: Math.sqrt(sumSq / n),
  }
}

/** kick / snare / hat from band energies, centroid, and ZCR. A kick needs a
 * LOW centroid, not just low-band energy — snares carry plenty of body. */
export function classifyHit(f: HitFeatures): typeof KICK | typeof SNARE | typeof HAT {
  if (f.centroidHz < 1200 && f.lowRatio > 0.25) return KICK
  if (f.highRatio > 0.5 || f.centroidHz > 4500 || f.zcr > 0.35) return HAT
  return SNARE
}

/** The whole BEATS pipeline: mono samples in, GM drum notes out. */
export function transcribeBeats(
  samples: Float32Array,
  sampleRate: number,
  cfg: { tempo: number; totalBeats: number },
): Note[] {
  // ~22 kHz keeps the hat band while halving the FFT work at 44.1/48 kHz.
  const factor = Math.max(1, Math.round(sampleRate / 22050))
  const ds = decimate(samples, factor)
  const sr = sampleRate / factor
  // Zero-pad the front by a full FFT window so a hit landing exactly on
  // beat 0 still produces a flux RISE from a silent baseline (flux is a
  // difference — it can't see energy already present in the very first frame).
  const pad = FLUX_DEFAULTS.fftSize
  const padded = new Float32Array(pad + ds.length)
  padded.set(ds, pad)
  const flux = spectralFlux(padded)
  const onsets = pickOnsets(flux)
  const spb = 60 / cfg.tempo
  const hits = onsets.map((frame) => {
    const at = Math.max(0, frame * FLUX_DEFAULTS.hop - pad)
    const f = hitFeatures(ds, sr, at)
    return { sec: at / sr, pitch: classifyHit(f), rms: f.rms }
  })
  const maxRms = hits.reduce((m, h) => Math.max(m, h.rms), 0)
  const notes: Note[] = []
  for (const h of hits) {
    const startBeat = h.sec / spb
    if (startBeat >= cfg.totalBeats - 1e-3) continue
    notes.push({
      pitch: h.pitch,
      startBeat,
      durationBeats: 0.25,
      velocity: Math.max(1, Math.min(127, maxRms > 0 ? Math.round(45 + 80 * (h.rms / maxRms)) : 96)),
      part: 0,
    })
  }
  return notes
}
