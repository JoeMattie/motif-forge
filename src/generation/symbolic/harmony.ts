/**
 * Chord scaffolding for the INSTANT tier, after M6(GPT)3's harmony module
 * (arXiv 2409.12638): degree-based progressions (the mode supplies chord
 * quality — triads are stacked in-mode thirds), a seeded bass line and a
 * deterministic sustained pad that follow them, and the paper's inter-track
 * consonance score used to pick the bass take that sits best under a lead.
 * Pure and framework-free; all randomness comes from an injected Rng.
 */
import type { Mode, Note } from '../../types'
import { beatsPerBar, scalePitchClasses } from '../../core/theory'
import { EPS } from '../../core/validate'
import { pick, randInt, type Rng } from './prng'

/** Small degree-based pool (I–vi–IV–V and friends); mode supplies quality. */
export const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 3, 4],
  [0, 3, 4, 4],
  [0, 4, 5, 3],
  [0, 6, 2, 4],
  [0, 5, 3, 6],
  [0, 2, 3, 4],
]

/** Pick a progression and cycle it to one degree per bar. */
export function progressionFor(bars: number, rng: Rng): number[] {
  const base = pick(rng, PROGRESSIONS)
  const out: number[] = []
  for (let i = 0; i < bars; i++) out.push(base[i % base.length])
  return out
}

/** The chord degree governing `beat` (one chord per bar, cycled). */
export function chordAtBeat(progression: readonly number[], beat: number, bpb: number): number {
  const bar = Math.max(0, Math.floor((beat + EPS) / bpb))
  return progression[bar % progression.length]
}

/** Pitch classes of the in-mode triad on scale degree 0–6 (root, 3rd, 5th). */
export function chordPitchClasses(degree: number, key: string, mode: Mode): number[] {
  const pcs = scalePitchClasses(key, mode)
  const d = ((Math.round(degree) % 7) + 7) % 7
  return [0, 2, 4].map((step) => pcs[(d + step) % 7])
}

export interface HarmonyContext {
  bars: number
  timeSig: string
  key: string
  mode: Mode
  /** 0..1 — hotter energy plays busier and louder (default 0.5). */
  energy?: number
}

/** Bass register: E1-ish up to G3 (≥36 is validation's non-drum floor). */
const BASS_LO = 36
const BASS_HI = 55

/** Lowest in-register pitch with pitch class `pc` at or above `lo`. */
const pitchAbove = (pc: number, lo: number) => lo + ((pc - lo) % 12 + 12) % 12

const clampVel = (v: number) => Math.min(127, Math.max(1, v))

/**
 * A seeded bass line under the progression: roots on downbeats, fifth or
 * octave on the back half of each bar, register clamped to 36–55. Chord
 * tones only, so it consonates with the scaffold by construction.
 */
export function bassNotes(
  progression: readonly number[],
  ctx: HarmonyContext,
  rng: Rng,
): Note[] {
  const bpb = beatsPerBar(ctx.timeSig)
  const energy = ctx.energy ?? 0.5
  const velBase = 88 + Math.round((energy - 0.5) * 14)
  const notes: Note[] = []
  for (let bar = 0; bar < ctx.bars; bar++) {
    const degree = chordAtBeat(progression, bar * bpb, bpb)
    const [rootPc, , fifthPc] = chordPitchClasses(degree, ctx.key, ctx.mode)
    const root = pitchAbove(rootPc, BASS_LO)
    const start = bar * bpb
    const half = bpb / 2
    // Calm basses sit on whole-bar roots; hotter ones move on the back half.
    if (rng() < 0.75 * (0.4 + energy)) {
      notes.push({
        pitch: root,
        startBeat: start,
        durationBeats: half,
        velocity: clampVel(velBase + randInt(rng, -4, 4)),
      })
      const roll = rng()
      const fifth = pitchAbove(fifthPc, BASS_LO)
      const octave = root + 12 <= BASS_HI ? root + 12 : root
      const backPitch = roll < 0.4 ? fifth : roll < 0.7 ? octave : root
      notes.push({
        pitch: backPitch,
        startBeat: start + half,
        durationBeats: half,
        velocity: clampVel(velBase - 6 + randInt(rng, -4, 4)),
      })
      // Driven grooves add an 8th pickup into the next bar.
      if (energy > 0.6 && bar < ctx.bars - 1 && rng() < 0.5) {
        notes[notes.length - 1].durationBeats = half - 0.5
        notes.push({
          pitch: root,
          startBeat: start + bpb - 0.5,
          durationBeats: 0.5,
          velocity: clampVel(velBase - 12 + randInt(rng, -4, 4)),
        })
      }
    } else {
      notes.push({
        pitch: root,
        startBeat: start,
        durationBeats: bpb,
        velocity: clampVel(velBase + randInt(rng, -4, 4)),
      })
    }
  }
  return notes
}

/** Pad register: G3 up to D5. */
const PAD_LO = 55
const PAD_HI = 74
const PAD_CENTER = 64

/** In-register pitch with pitch class `pc` nearest to `target`. */
function nearestPitch(pc: number, target: number, lo: number, hi: number): number {
  let best = pitchAbove(pc, lo)
  for (let p = best; p <= hi; p += 12) {
    if (Math.abs(p - target) < Math.abs(best - target)) best = p
  }
  return Math.min(best, hi)
}

const PERMS3: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

/**
 * One sustained 3-voice triad per bar with nearest-inversion voice leading:
 * each chord's voicing minimizes total movement from the previous bar's.
 * Deterministic — no RNG.
 */
export function padNotes(progression: readonly number[], ctx: HarmonyContext): Note[] {
  const bpb = beatsPerBar(ctx.timeSig)
  const notes: Note[] = []
  let prev: number[] | null = null
  for (let bar = 0; bar < ctx.bars; bar++) {
    const degree = chordAtBeat(progression, bar * bpb, bpb)
    const pcs = chordPitchClasses(degree, ctx.key, ctx.mode)
    let voicing: number[]
    if (prev === null) {
      voicing = pcs.map((pc) => nearestPitch(pc, PAD_CENTER, PAD_LO, PAD_HI))
    } else {
      const targets = prev
      let best: number[] | null = null
      let bestCost = Infinity
      for (const perm of PERMS3) {
        const cand = perm.map((vi, pi) => nearestPitch(pcs[pi], targets[vi], PAD_LO, PAD_HI))
        const cost = cand.reduce((s, p, pi) => s + Math.abs(p - targets[perm[pi]]), 0)
        if (cost < bestCost) {
          bestCost = cost
          best = cand
        }
      }
      voicing = best!
    }
    prev = voicing
    for (const pitch of [...voicing].sort((a, b) => a - b)) {
      notes.push({ pitch, startBeat: bar * bpb, durationBeats: bpb, velocity: 55 })
    }
  }
  return notes
}

const GRID = 0.25 // beats per 16th

/** Interval-class score (mod 12): perfect > consonant > dissonant > tritone. */
const INTERVAL_SCORE: readonly number[] = [
  8, // 0 unison/octave
  -20, // 1
  -20, // 2
  8, // 3
  8, // 4
  15, // 5 P4
  -30, // 6 tritone
  15, // 7 P5
  8, // 8
  8, // 9
  -20, // 10
  -20, // 11
]

const REST_SCORE = 10

/**
 * The paper's inter-track dissonance measure: sample both parts on the 16th
 * grid, score every sounding pitch pair by interval class (rest in either
 * part scores +10), and squash the mean through tanh(mean/10) into (−1, 1).
 */
export function crossPartScore(a: Note[], b: Note[], totalBeats: number): number {
  const slots = Math.max(1, Math.round(totalBeats / GRID))
  const soundingAt = (notes: Note[], t: number) =>
    notes.filter((n) => n.startBeat <= t + EPS && n.startBeat + n.durationBeats > t + EPS)
  let sum = 0
  for (let s = 0; s < slots; s++) {
    const t = s * GRID
    const va = soundingAt(a, t)
    const vb = soundingAt(b, t)
    if (va.length === 0 || vb.length === 0) {
      sum += REST_SCORE
      continue
    }
    let pairSum = 0
    for (const na of va) {
      for (const nb of vb) {
        pairSum += INTERVAL_SCORE[((na.pitch - nb.pitch) % 12 + 12) % 12]
      }
    }
    sum += pairSum / (va.length * vb.length)
  }
  return Math.tanh(sum / slots / 10)
}
