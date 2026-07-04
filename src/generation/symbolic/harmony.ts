/**
 * Diatonic functional harmony for the offline engines (the CHORDS / BOTH
 * voicing modes). Modeled on drums.ts: pure, returns partless Note[] (the
 * caller stamps part indices), all randomness through an injected mulberry32
 * Rng — never Math.random — so a stored seed reproduces every take.
 *
 * Vocabulary: root-position diatonic triads with occasional seeded 7ths, no
 * inversions/sus. Progressions walk tonic → subdominant → dominant function
 * pools with an authentic-ish D→I cadence at the end. The functional labels
 * loosen in non-ionian modes (a phrygian "V" isn't a dominant in the CP-theory
 * sense) — accepted; degree stacking keeps everything diatonic regardless.
 */
import type { Mode, Note } from '../../types'
import {
  beatsPerBar,
  diatonicStack,
  keyToPitchClass,
  MODE_INTERVALS,
  pitchToDegree,
  scalePitchClasses,
} from '../../core/theory'
import { EPS } from '../../core/validate'
import { pick, pickWeighted, randInt, type Rng } from './prng'

/** Function pools as 0-based scale-degree roots. */
export const TONIC_DEGREES: readonly number[] = [0, 5] // I, vi
export const SUBDOMINANT_DEGREES: readonly number[] = [3, 1] // IV, ii
export const DOMINANT_DEGREES: readonly number[] = [4, 6] // V, vii°

type HarmonicFunction = 'T' | 'S' | 'D'

const POOLS: Record<HarmonicFunction, readonly number[]> = {
  T: TONIC_DEGREES,
  S: SUBDOMINANT_DEGREES,
  D: DOMINANT_DEGREES,
}

/** One chord's slot in a progression. */
export interface ChordSegment {
  rootDegree: number // 0-6
  seventh: boolean
  startBeat: number
  durationBeats: number
}

export interface HarmonyParams {
  key: string
  mode: Mode
  bars: number
  timeSig: string
  /** 3 = triads only (the BOTH+rhythm voice-cap mitigation), default 4 (7ths allowed). */
  maxVoices?: 3 | 4
}

export interface HarmonyResult {
  notes: Note[]
  segments: ChordSegment[]
}

const SEVENTH_CHANCE = 0.15
const SEVENTH_CHANCE_V = 0.35

const seventhRoll = (rng: Rng, rootDegree: number): boolean =>
  rng() < (rootDegree === 4 ? SEVENTH_CHANCE_V : SEVENTH_CHANCE)

/** Chance a 4+-bar progression moves per half-bar instead of per bar. */
const HALF_BAR_CHANCE = 0.35

export interface ProgressionOptions {
  /** Allow the seeded per-half-bar harmonic rhythm on 4+-bar phrases (default on). */
  allowHalfBar?: boolean
}

/** Seeded harmonic-rhythm grid: per-bar segments, or per-half-bar on longer phrases. */
function segmentGrid(
  bars: number,
  timeSig: string,
  rng: Rng,
  allowHalfBar: boolean,
): { startBeat: number; durationBeats: number }[] {
  const bpb = beatsPerBar(timeSig)
  const halfBar = allowHalfBar && bars >= 4 && rng() < HALF_BAR_CHANCE
  const segDur = halfBar ? bpb / 2 : bpb
  const count = Math.max(1, Math.round((bars * bpb) / segDur))
  const out: { startBeat: number; durationBeats: number }[] = []
  for (let i = 0; i < count; i++) out.push({ startBeat: i * segDur, durationBeats: segDur })
  return out
}

/**
 * Seeded functional progression: starts tonic (I-weighted), walks T→S→D cycles
 * with no immediately repeated root, and forces the final two segments into an
 * authentic-ish D→I cadence. Sevenths are seeded (~15%, ~35% on V).
 */
export function progression(
  bars: number,
  timeSig: string,
  rng: Rng,
  opts: ProgressionOptions = {},
): ChordSegment[] {
  const grid = segmentGrid(bars, timeSig, rng, opts.allowHalfBar ?? true)
  const count = grid.length
  const roots: number[] = []
  let fn: HarmonicFunction = 'T'
  for (let i = 0; i < count; i++) {
    let root: number
    if (count >= 2 && i === count - 1) {
      root = 0 // cadence target: I
    } else if (count >= 2 && i === count - 2) {
      root = pickWeighted(rng, [
        [4, 4],
        [6, 1],
      ] as const) // dominant approach, V-heavy
    } else if (i === 0) {
      root = pickWeighted(rng, [
        [0, 4],
        [5, 1],
      ] as const) // tonic opening, I-weighted
    } else {
      fn = fn === 'T' ? (rng() < 0.7 ? 'S' : 'D') : fn === 'S' ? (rng() < 0.8 ? 'D' : 'T') : 'T'
      const pool = POOLS[fn].filter((d) => d !== roots[i - 1])
      root = pool.length > 0 ? pick(rng, pool) : POOLS[fn][0]
    }
    roots.push(root)
  }
  return grid.map((g, i) => ({ ...g, rootDegree: roots[i], seventh: seventhRoll(rng, roots[i]) }))
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** Roman numeral with mode-derived quality: lowercase minor, ° diminished, 7 suffix. */
export function romanNumeral(
  rootDegree: number,
  seventh: boolean,
  key: string,
  mode: Mode,
): string {
  const [root, third, fifth] = diatonicStack(rootDegree, 3, key, mode)
  const minor = third - root === 3
  const dim = fifth - root === 6
  const base = NUMERALS[rootDegree]
  return `${minor || dim ? base.toLowerCase() : base}${dim ? '°' : ''}${seventh ? '7' : ''}`
}

/** "I–vi–IV–V7"-style label for a progression (the recipe/rationale string). */
export function progressionLabel(segments: ChordSegment[], key: string, mode: Mode): string {
  return segments.map((s) => romanNumeral(s.rootDegree, s.seventh, key, mode)).join('–')
}

export interface VoicingOptions {
  /** Highest allowed chord tone; the whole stack drops an octave to duck under it. */
  ceiling?: number
  /** 3 = triad only; 4 admits the rolled 7th. */
  maxVoices: 3 | 4
  /** Root placement window in MIDI (default 48–60, above low-register mud). */
  rootWindow?: readonly [number, number]
}

/**
 * Root-position voicing of a diatonic triad/7th: the root lands inside
 * `rootWindow`, the whole stack drops an octave if it breaches `ceiling`
 * (never below the app's pitch floor), and every tone clamps into 36–96.
 */
export function chordVoicing(
  rootDegree: number,
  seventh: boolean,
  key: string,
  mode: Mode,
  opts: VoicingOptions,
): number[] {
  const [lo, hi] = opts.rootWindow ?? [48, 60]
  const rootRel = keyToPitchClass(key) + MODE_INTERVALS[mode][rootDegree]
  let octave = Math.ceil((lo - rootRel) / 12) // smallest octave placing the root >= lo
  if (rootRel + octave * 12 > hi) octave -= 1 // window narrower than an octave: bias low
  const size: 3 | 4 = seventh && opts.maxVoices >= 4 ? 4 : 3
  let tones = diatonicStack(octave * 7 + rootDegree, size, key, mode)
  if (opts.ceiling !== undefined && tones[tones.length - 1] > opts.ceiling && tones[0] - 12 >= 36) {
    tones = tones.map((p) => p - 12)
  }
  return tones.map((p) => Math.min(96, Math.max(36, p)))
}

/** Restrike patterns so a progression isn't all whole-note pads. */
type RestrikePattern = 'sustain' | 'rehit' | 'offbeat'

const CHORD_RESTRIKES: readonly (readonly [RestrikePattern, number])[] = [
  ['sustain', 3],
  ['rehit', 4],
  ['offbeat', 3],
]

/** Accompaniment leans sustained so it stays under the melody. */
const BACKING_RESTRIKES: readonly (readonly [RestrikePattern, number])[] = [
  ['sustain', 5],
  ['rehit', 2],
  ['offbeat', 3],
]

/** Onset offsets (relative to segment start) + durations for one segment. */
function strikes(pattern: RestrikePattern, segDur: number): { at: number; dur: number }[] {
  switch (pattern) {
    case 'sustain':
      return [{ at: 0, dur: segDur }]
    case 'rehit': {
      const out: { at: number; dur: number }[] = []
      for (let t = 0; t < segDur - EPS; t += 1) out.push({ at: t, dur: Math.min(1, segDur - t) * 0.95 })
      return out
    }
    case 'offbeat': {
      const out = [{ at: 0, dur: Math.min(1, segDur) }]
      for (let t = 1.5; t < segDur - EPS; t += 1) out.push({ at: t, dur: Math.min(0.5, segDur - t) })
      return out
    }
  }
}

const clampVel = (v: number) => Math.min(127, Math.max(1, v))

interface EmitOptions {
  velAccent: number
  velBase: number
  restrikes: readonly (readonly [RestrikePattern, number])[]
  /** Per-segment ceiling (BOTH mode: below the melody). */
  ceilings?: (number | undefined)[]
}

/** Voice and strike every segment; one velocity draw per strike (chord tones move together). */
function emitSegments(
  segments: ChordSegment[],
  params: HarmonyParams,
  rng: Rng,
  opts: EmitOptions,
): Note[] {
  const maxVoices = params.maxVoices ?? 4
  const pattern = pickWeighted(rng, opts.restrikes)
  const notes: Note[] = []
  segments.forEach((seg, i) => {
    const tones = chordVoicing(seg.rootDegree, seg.seventh, params.key, params.mode, {
      maxVoices,
      ceiling: opts.ceilings?.[i],
    })
    for (const s of strikes(pattern, seg.durationBeats)) {
      const velocity = clampVel((s.at === 0 ? opts.velAccent : opts.velBase) + randInt(rng, -3, 3))
      for (const pitch of tones) {
        notes.push({ pitch, startBeat: seg.startBeat + s.at, durationBeats: s.dur, velocity })
      }
    }
  })
  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

/** Reconcile the rolled 7th flags with the voice budget so labels match the sound. */
const fitSevenths = (segments: ChordSegment[], maxVoices: 3 | 4): ChordSegment[] =>
  maxVoices >= 4 ? segments : segments.map((s) => (s.seventh ? { ...s, seventh: false } : s))

/**
 * CHORDS mode: the motif IS a seeded chord progression — voiced segments with
 * a restrike pattern (sustain / re-hit / off-beat stabs), downbeat accents.
 */
export function chordProgressionNotes(params: HarmonyParams, rng: Rng): HarmonyResult {
  const segments = fitSevenths(
    progression(params.bars, params.timeSig, rng),
    params.maxVoices ?? 4,
  )
  const notes = emitSegments(segments, params, rng, {
    velAccent: 92,
    velBase: 82,
    restrikes: CHORD_RESTRIKES,
  })
  return { notes, segments }
}

/**
 * BOTH mode: harmonize a melodic line. Same seeded segmentation as a
 * standalone progression; per segment the candidate roots come from the
 * active function pool (+ I always) and the winner is the chord whose tones
 * cover the most melody (duration-weighted), seeded tie-break, cadence
 * override at the end. Voicings duck below the segment's lowest melody pitch
 * and velocities sit well under a lead line's.
 */
export function harmonizeLine(melody: Note[], params: HarmonyParams, rng: Rng): HarmonyResult {
  const grid = segmentGrid(params.bars, params.timeSig, rng, true)
  const count = grid.length

  const overlapWith = (n: Note, seg: { startBeat: number; durationBeats: number }) =>
    Math.min(n.startBeat + n.durationBeats, seg.startBeat + seg.durationBeats) -
    Math.max(n.startBeat, seg.startBeat)

  /** Duration-weighted chord-tone coverage of the melody inside a segment. */
  const coverage = (root: number, seg: { startBeat: number; durationBeats: number }): number => {
    const chordDegrees = new Set([root, (root + 2) % 7, (root + 4) % 7])
    let sum = 0
    for (const n of melody) {
      const overlap = overlapWith(n, seg)
      if (overlap <= EPS) continue
      const pos = pitchToDegree(n.pitch, params.key, params.mode)
      if (pos.chromaticOffset === 0 && chordDegrees.has(pos.degree)) sum += overlap
    }
    return sum
  }

  let fn: HarmonicFunction = 'T'
  const roots: number[] = []
  for (let i = 0; i < count; i++) {
    let candidates: number[]
    if (count >= 2 && i === count - 1) {
      candidates = [0] // cadence target: I
    } else if (count >= 2 && i === count - 2) {
      candidates = [...DOMINANT_DEGREES] // cadence approach
    } else {
      if (i > 0) {
        fn = fn === 'T' ? (rng() < 0.7 ? 'S' : 'D') : fn === 'S' ? (rng() < 0.8 ? 'D' : 'T') : 'T'
      }
      candidates = [...new Set([...POOLS[fn], 0])]
    }
    const scored = candidates.map((root) => ({ root, cover: coverage(root, grid[i]) }))
    const best = Math.max(...scored.map((s) => s.cover))
    const ties = scored.filter((s) => s.cover >= best - EPS).map((s) => s.root)
    roots.push(pick(rng, ties))
  }

  const segments = fitSevenths(
    grid.map((g, i) => ({ ...g, rootDegree: roots[i], seventh: seventhRoll(rng, roots[i]) })),
    params.maxVoices ?? 4,
  )

  const globalMin = melody.length > 0 ? Math.min(...melody.map((n) => n.pitch)) : undefined
  const ceilings = grid.map((g) => {
    const sounding = melody.filter((n) => overlapWith(n, g) > EPS)
    const lowest = sounding.length > 0 ? Math.min(...sounding.map((n) => n.pitch)) : globalMin
    return lowest !== undefined ? lowest - 1 : undefined
  })

  const notes = emitSegments(segments, params, rng, {
    velAccent: 74,
    velBase: 66,
    restrikes: BACKING_RESTRIKES,
    ceilings,
  })
  return { notes, segments }
}

/* ------------------------------------------------------------------------
 * Chord scaffolding for the INSTANT tier, after M6(GPT)3's harmony module
 * (arXiv 2409.12638): degree-based progressions (the mode supplies chord
 * quality), a seeded bass line and a deterministic sustained pad that follow
 * them, and the paper's inter-track consonance score used to pick the bass
 * take that sits best under a lead. Same rules as above: pure, injected Rng.
 * ---------------------------------------------------------------------- */

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
