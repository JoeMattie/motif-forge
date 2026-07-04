/**
 * Seeded probabilistic drum generator for the INSTANT tier, after M6(GPT)3's
 * percussion module: per-time-signature kick/snare probability tables on an
 * 8th-note step grid, hi-hat density shaped by the melody's busyness, open-hat
 * accents at bar ends, and a small Markov tom fill closing the last bar.
 * Pure and deterministic given the Rng — GM pitches, ready for the Tone drum
 * kit / MIDI channel 9 path that drum parts already ride.
 */
import type { Note } from '../../types'
import { beatsPerBar } from '../../core/theory'
import { EPS } from '../../core/validate'
import { pickWeighted, randInt, type Rng } from './prng'

export type DrumDensity = 'sparse' | 'medium' | 'busy'

export interface DrumParams {
  bars: number
  timeSig: string
  density: DrumDensity
  /** Tom run closing the last bar (default on when bars ≥ 2). */
  fill?: boolean
  /** Crash on the very first downbeat (default on). */
  crash?: boolean
}

// GM drum map (all ≥ 35, validation's drum floor).
const KICK = 36
const SNARE = 38
const CLOSED_HAT = 42
const OPEN_HAT = 46
const TOM_LO = 45
const TOM_MID = 47
const TOM_HI = 50
const CRASH = 49

/** Per-step hit probabilities; one entry per 8th-note step of a bar. */
interface KitTable {
  kick: number[]
  snare: number[]
}

/** Hand-tuned grooves for the signatures the app deals in. */
const TABLES: Record<string, KitTable> = {
  '4/4': {
    kick: [1.0, 0.08, 0.22, 0.1, 0.75, 0.1, 0.28, 0.14],
    snare: [0.02, 0.04, 0.92, 0.06, 0.04, 0.05, 0.92, 0.1],
  },
  '3/4': {
    kick: [1.0, 0.08, 0.2, 0.1, 0.22, 0.1],
    snare: [0.02, 0.04, 0.85, 0.06, 0.3, 0.08],
  },
  '6/8': {
    kick: [1.0, 0.05, 0.12, 0.2, 0.05, 0.15],
    snare: [0.02, 0.05, 0.1, 0.9, 0.05, 0.12],
  },
}

/** Downbeat kick + midpoint backbeat for signatures without a hand table. */
function fallbackTable(steps: number): KitTable {
  const kick = new Array<number>(steps).fill(0.08)
  const snare = new Array<number>(steps).fill(0.05)
  kick[0] = 1.0
  snare[Math.floor(steps / 2)] = 0.9
  return { kick, snare }
}

/** Markov next-drum weights for the closing fill (descending-tom bias). */
const FILL_STEPS: Record<number, readonly (readonly [number, number])[]> = {
  [TOM_HI]: [
    [TOM_MID, 5],
    [TOM_HI, 2],
    [SNARE, 2],
    [TOM_LO, 1],
  ],
  [TOM_MID]: [
    [TOM_LO, 5],
    [TOM_MID, 2],
    [SNARE, 2],
  ],
  [TOM_LO]: [
    [TOM_LO, 3],
    [SNARE, 3],
    [TOM_MID, 1],
  ],
  [SNARE]: [
    [TOM_HI, 4],
    [TOM_MID, 3],
    [SNARE, 3],
  ],
}

const vel = (rng: Rng, base: number, spread: number) =>
  Math.min(127, Math.max(1, base + randInt(rng, -spread, spread)))

/**
 * Map a melodic line's busyness to a groove density (deterministic, so the
 * drum layer is reproducible from the melody + seed even for evolved children
 * that carry no rhythm-archetype label).
 */
export function densityOf(melody: Note[], bars: number, timeSig: string): DrumDensity {
  const onsetsPerBeat = melody.length / (bars * beatsPerBar(timeSig))
  return onsetsPerBeat < 0.8 ? 'sparse' : onsetsPerBeat < 1.6 ? 'medium' : 'busy'
}

/**
 * One seeded drum take. Notes come back partless (no `part` index) — the
 * caller stamps them onto its drums part. In /8 signatures the app counts the
 * 8th as the beat (beatsPerBar reads the numerator), so the step IS the beat.
 */
export function drumNotes(params: DrumParams, rng: Rng): Note[] {
  const { bars, timeSig, density } = params
  const fill = (params.fill ?? true) && bars >= 2
  const crash = params.crash ?? true
  const bpb = beatsPerBar(timeSig)
  const denom = parseInt(timeSig.split('/')[1] ?? '4', 10)
  const stepBeats = denom === 8 ? 1 : 0.5
  const stepsPerBar = Math.round(bpb / stepBeats)
  const totalBeats = bars * bpb
  const table = TABLES[timeSig] ?? fallbackTable(stepsPerBar)
  // Pulse for hats: quarters in /4 bars, dotted-quarter groups in /8.
  const pulseSteps = denom === 8 ? 3 : 2
  const grid16 = stepBeats / 2
  // The fill owns the tail of the last bar: 2 steps (4 when busy).
  const fillSteps = density === 'busy' ? 4 : 2
  const fillStart = fill ? totalBeats - Math.min(fillSteps, stepsPerBar) * stepBeats : Infinity

  const notes: Note[] = []
  const hit = (pitch: number, startBeat: number, velocity: number) =>
    notes.push({
      pitch,
      startBeat,
      durationBeats: Math.min(0.25, totalBeats - startBeat),
      velocity,
    })

  if (crash) hit(CRASH, 0, vel(rng, 105, 4))

  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < stepsPerBar; step++) {
      const beat = bar * bpb + step * stepBeats
      if (beat >= fillStart) continue
      const onPulse = step % pulseSteps === 0
      const lastStep = step === stepsPerBar - 1

      if (rng() < table.kick[step]) hit(KICK, beat, vel(rng, 100, 6))
      const backbeat = rng() < table.snare[step]
      if (backbeat) hit(SNARE, beat, vel(rng, 106, 6))
      // Ghost snares add hand feel off the main hits (never on the downbeat).
      else if (step > 0 && density !== 'sparse' && rng() < 0.06) hit(SNARE, beat, vel(rng, 42, 8))

      // Hi-hats: density picks the lattice; bar ends breathe with an open hat.
      const wantHat = density === 'sparse' ? onPulse : true
      if (wantHat) {
        const open =
          (lastStep && rng() < 0.35) || (density === 'busy' && !onPulse && rng() < 0.3)
        hit(
          open ? OPEN_HAT : CLOSED_HAT,
          beat,
          vel(rng, open ? 84 : onPulse ? 84 : 72, 8),
        )
      }
      // Busy grooves sprinkle 16th ghost pickups between steps.
      if (density === 'busy' && rng() < 0.22 && beat + grid16 < fillStart) {
        hit(CLOSED_HAT, beat + grid16, vel(rng, 48, 8))
      }
    }
  }

  if (fill) {
    const slots: number[] = []
    for (let b = fillStart; b < totalBeats - EPS; b += grid16) slots.push(b)
    const count = Math.min(slots.length, randInt(rng, 3, 5))
    // Always land the last slot; scatter the rest earlier in the window.
    const chosen = new Set<number>([slots.length - 1])
    while (chosen.size < count) chosen.add(randInt(rng, 0, slots.length - 2))
    let drum = rng() < 0.5 ? SNARE : TOM_HI
    const ordered = [...chosen].sort((a, b) => a - b)
    for (let i = 0; i < ordered.length; i++) {
      const last = i === ordered.length - 1
      if (last) drum = rng() < 0.5 ? TOM_LO : SNARE
      hit(drum, slots[ordered[i]], vel(rng, 96, 10))
      if (!last) drum = pickWeighted(rng, FILL_STEPS[drum])
    }
  }

  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}
