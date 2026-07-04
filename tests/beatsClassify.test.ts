import { describe, expect, it } from 'vitest'
import {
  classifyHit,
  fftRadix2,
  HAT,
  hitFeatures,
  KICK,
  pickOnsets,
  SNARE,
  spectralFlux,
  transcribeBeats,
} from '../src/noodle/transcribe/beats'
import { mulberry32 } from '../src/generation/symbolic/prng'

const SR = 22050

/** Deterministic white noise from the app's seeded PRNG. */
function noise(rng: () => number, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1
  return out
}

/** 60 Hz decaying sine — a synthetic kick. */
function kickBurst(n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = 0.9 * Math.exp((-6 * i) / SR / 0.15) * Math.sin((2 * Math.PI * 60 * i) / SR)
  }
  return out
}

/** Broadband noise + 200 Hz body, decaying — a synthetic snare. */
function snareBurst(rng: () => number, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const env = Math.exp((-8 * i) / SR / 0.1)
    out[i] = env * (0.45 * (rng() * 2 - 1) + 0.4 * Math.sin((2 * Math.PI * 200 * i) / SR))
  }
  return out
}

/** High-passed noise (first difference), fast decay — a synthetic closed hat. */
function hatBurst(rng: () => number, n: number): Float32Array {
  const raw = noise(rng, n + 1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = 0.7 * Math.exp((-20 * i) / SR / 0.05) * (raw[i + 1] - raw[i])
  }
  return out
}

describe('fftRadix2', () => {
  it('transforms an impulse to a flat spectrum', () => {
    const re = new Float64Array(16)
    const im = new Float64Array(16)
    re[0] = 1
    fftRadix2(re, im)
    for (let i = 0; i < 16; i++) {
      expect(Math.hypot(re[i], im[i])).toBeCloseTo(1, 10)
    }
  })

  it('puts a pure sine in the right bin', () => {
    const n = 64
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 4 * i) / n) // bin 4
    fftRadix2(re, im)
    const mags = Array.from({ length: n / 2 }, (_, i) => Math.hypot(re[i], im[i]))
    expect(mags.indexOf(Math.max(...mags))).toBe(4)
  })

  it('rejects non-power-of-two sizes', () => {
    expect(() => fftRadix2(new Float64Array(12), new Float64Array(12))).toThrow()
  })
})

describe('hit classification', () => {
  const burstLen = Math.round(0.15 * SR)

  it('classifies a low decaying sine as kick', () => {
    const f = hitFeatures(kickBurst(burstLen), SR, 0)
    expect(f.lowRatio).toBeGreaterThan(0.3)
    expect(classifyHit(f)).toBe(KICK)
  })

  it('classifies broadband mid-heavy noise as snare', () => {
    const f = hitFeatures(snareBurst(mulberry32(7), burstLen), SR, 0)
    expect(classifyHit(f)).toBe(SNARE)
  })

  it('classifies high-passed noise as hat', () => {
    const f = hitFeatures(hatBurst(mulberry32(11), burstLen), SR, 0)
    expect(classifyHit(f)).toBe(HAT)
  })
})

describe('onset detection', () => {
  it('finds bursts placed on a grid and nothing in the gaps', () => {
    const rng = mulberry32(42)
    const total = new Float32Array(SR * 2) // 2 s
    const positions = [0.1, 0.6, 1.1, 1.6]
    for (const sec of positions) {
      const burst = snareBurst(rng, Math.round(0.1 * SR))
      total.set(burst, Math.round(sec * SR))
    }
    const flux = spectralFlux(total)
    const onsets = pickOnsets(flux)
    expect(onsets.length).toBe(4)
    const frameSec = 256 / SR
    onsets.forEach((frame, i) => {
      expect(Math.abs(frame * frameSec - positions[i])).toBeLessThan(0.05)
    })
  })
})

describe('transcribeBeats', () => {
  it('produces a drum pattern with the right classes on the right beats', () => {
    const rng = mulberry32(3)
    // one bar at 120 BPM: kick on 1 & 3, snare on 2 & 4 (0.5 s per beat)
    const total = new Float32Array(SR * 2)
    total.set(kickBurst(Math.round(0.12 * SR)), 0)
    total.set(snareBurst(rng, Math.round(0.1 * SR)), Math.round(0.5 * SR))
    total.set(kickBurst(Math.round(0.12 * SR)), Math.round(1.0 * SR))
    total.set(snareBurst(rng, Math.round(0.1 * SR)), Math.round(1.5 * SR))
    const notes = transcribeBeats(total, SR, { tempo: 120, totalBeats: 4 })
    expect(notes.length).toBe(4)
    expect(notes.map((n) => n.pitch)).toEqual([KICK, SNARE, KICK, SNARE])
    notes.forEach((n, i) => {
      expect(Math.abs(n.startBeat - i)).toBeLessThan(0.15)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(127)
    })
  })

  it('returns nothing for silence', () => {
    expect(transcribeBeats(new Float32Array(SR), SR, { tempo: 120, totalBeats: 4 })).toEqual([])
  })
})
