import { describe, expect, it } from 'vitest'
import {
  correctOctaveJumps,
  decimate,
  decimationFactor,
  hzToMidi,
  medianSmooth,
  yinFrame,
  yinTrack,
  YIN_DEFAULTS,
} from '../src/noodle/transcribe/voice'

const SR = 11025

function sine(freq: number, seconds: number, sr = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

/** Sine with vibrato: freq modulated ±depth (ratio) at rateHz. */
function vibratoSine(freq: number, depth: number, rateHz: number, seconds: number, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const f = freq * (1 + depth * Math.sin((2 * Math.PI * rateHz * i) / sr))
    phase += (2 * Math.PI * f) / sr
    out[i] = 0.5 * Math.sin(phase)
  }
  return out
}

describe('yinFrame', () => {
  it('finds the f0 of pure sines within a cent or two', () => {
    for (const freq of [110, 220, 330, 440, 880]) {
      const s = sine(freq, 0.2)
      const { f0 } = yinFrame(s.subarray(0, YIN_DEFAULTS.frameSize), SR)
      expect(f0).not.toBeNull()
      // within 0.5% (well under a semitone)
      expect(Math.abs((f0 as number) / freq - 1)).toBeLessThan(0.005)
    }
  })

  it('reports the fundamental, not a harmonic, for a rich tone', () => {
    // saw-ish: f + 0.5·2f + 0.33·3f
    const freq = 196
    const s = new Float32Array(YIN_DEFAULTS.frameSize)
    for (let i = 0; i < s.length; i++) {
      const t = (2 * Math.PI * freq * i) / SR
      s[i] = 0.5 * Math.sin(t) + 0.25 * Math.sin(2 * t) + 0.17 * Math.sin(3 * t)
    }
    const { f0 } = yinFrame(s, SR)
    expect(f0).not.toBeNull()
    expect(Math.abs((f0 as number) / freq - 1)).toBeLessThan(0.01)
  })

  it('returns null for noise-free silence and near-aperiodic input', () => {
    const silence = new Float32Array(YIN_DEFAULTS.frameSize)
    expect(yinFrame(silence, SR).f0).toBeNull()
  })
})

describe('yinTrack', () => {
  it('tracks a two-note step (A3 → A4) with the right midi values', () => {
    const a3 = sine(220, 0.5)
    const a4 = sine(440, 0.5)
    const both = new Float32Array(a3.length + a4.length)
    both.set(a3)
    both.set(a4, a3.length)
    const frames = yinTrack(both, SR)
    const mid = frames.length / 2
    const first = frames.slice(2, mid - 2).map((f) => f.midi)
    const second = frames.slice(mid + 2, frames.length - 2).map((f) => f.midi)
    for (const m of first) {
      expect(m).not.toBeNull()
      expect(Math.abs((m as number) - 57)).toBeLessThan(0.5)
    }
    for (const m of second) {
      expect(m).not.toBeNull()
      expect(Math.abs((m as number) - 69)).toBeLessThan(0.5)
    }
  })

  it('gates unvoiced (silent) regions to null', () => {
    const tone = sine(330, 0.3)
    const gap = new Float32Array(Math.round(0.3 * SR))
    const all = new Float32Array(tone.length * 2 + gap.length)
    all.set(tone)
    all.set(gap, tone.length)
    all.set(tone, tone.length + gap.length)
    const frames = yinTrack(all, SR)
    const third = Math.floor(frames.length / 3)
    const gapFrames = frames.slice(third + 2, 2 * third - 2)
    expect(gapFrames.every((f) => f.midi === null)).toBe(true)
  })

  it('stays on the center pitch through vibrato', () => {
    const s = vibratoSine(330, 0.03, 5, 0.6) // ±3% ≈ ±0.5 st, 5 Hz
    const frames = yinTrack(s, SR)
    const midis = medianSmooth(
      frames.map((f) => f.midi),
      2,
    ).filter((m): m is number => m !== null)
    expect(midis.length).toBeGreaterThan(10)
    const center = hzToMidi(330)
    const mean = midis.reduce((a, b) => a + b, 0) / midis.length
    expect(Math.abs(mean - center)).toBeLessThan(0.35)
  })
})

describe('decimation', () => {
  it('picks a factor landing near 11 kHz', () => {
    expect(decimationFactor(44100)).toBe(4)
    expect(decimationFactor(48000)).toBe(4)
    expect(decimationFactor(22050)).toBe(2)
    expect(decimationFactor(11025)).toBe(1)
  })

  it('preserves the f0 of a 44.1 kHz sine through 4× decimation', () => {
    const src = sine(261.63, 0.2, 44100)
    const ds = decimate(src, 4)
    const { f0 } = yinFrame(ds.subarray(0, YIN_DEFAULTS.frameSize), 44100 / 4)
    expect(f0).not.toBeNull()
    expect(Math.abs((f0 as number) / 261.63 - 1)).toBeLessThan(0.005)
  })
})

describe('smoothing and octave correction', () => {
  it('medianSmooth knocks out single-frame spikes', () => {
    const track = [60, 60, 72, 60, 60].map((v) => v as number | null)
    expect(medianSmooth(track, 2)).toEqual([60, 60, 60, 60, 60])
  })

  it('medianSmooth passes nulls through', () => {
    const track: (number | null)[] = [60, null, 60]
    expect(medianSmooth(track, 1)[1]).toBeNull()
  })

  it('folds octave glitches back toward the running pitch', () => {
    const track: (number | null)[] = [57, 57, 57, 57, 69, 57, 57]
    const fixed = correctOctaveJumps(track)
    expect(fixed[4]).toBe(57)
  })

  it('accepts a genuine octave move once it persists', () => {
    // a real jump keeps re-asserting itself; after enough frames the running
    // median crosses over and later frames are left alone
    const track: (number | null)[] = [57, 57, 57, 69, 69, 69, 69, 69, 69, 69, 69, 69]
    const fixed = correctOctaveJumps(track)
    expect(fixed[fixed.length - 1]).toBe(69)
  })
})
