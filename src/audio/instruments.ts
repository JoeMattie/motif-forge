import * as Tone from 'tone'
import { CacheStorage, SplendidGrandPiano, Soundfont, type Storage } from 'smplr'
import type { Sound, SynthPreset } from '../types'
import { pitchToHz } from '../core/theory'

/**
 * Instrument adapter: one interface over two backends.
 * - 'synth' is a Tone.js PolySynth — pure synthesis, no network, cheap to build
 *   (created per playback, disposed on stop). Accepts an optional LLM-designed
 *   SynthPreset (oscillator + ADSR).
 * - The rest are smplr sampled instruments — fetched from a CDN on first use
 *   (cached via CacheStorage + HTTP cache), expensive to build (cached per
 *   context by the engine).
 */

export const SOUNDS: { id: Sound; label: string }[] = [
  { id: 'synth', label: 'synth' },
  { id: 'piano', label: 'piano' },
  { id: 'epiano', label: 'e-piano' },
  { id: 'marimba', label: 'marimba' },
  { id: 'strings', label: 'strings' },
]

export interface Instrument {
  /** Resolves when playable (immediately for the synth; after sample load for smplr). */
  ready: Promise<void>
  /** Schedule a note at an absolute context time (seconds). Velocity 1-127. */
  noteOn(pitch: number, velocity: number, timeSec: number, durationSec: number): void
  /** Cancel scheduled notes starting at/after timeSec; sounding notes ring out. */
  cancelAfter(timeSec: number): void
  /** Stop everything sounding and scheduled. */
  stopAll(): void
  dispose(): void
}

/**
 * A Tone voice can't un-schedule a future triggerAttackRelease, so to make
 * cancelAfter possible the Tone-backed instruments defer far-future triggers
 * through the context ticker and fire them SCHED_LOOKAHEAD before their start
 * (the exact time still goes to triggerAttackRelease, so timing is unchanged).
 * Anything already fired is committed — the engine's swap cutover must sit
 * beyond this lookahead. Offline contexts fire directly: renders never cancel.
 * smplr needs none of this — each start() returns a per-note cancel.
 */
export const SCHED_LOOKAHEAD = 0.12

function deferredTriggers(context: Tone.Context | Tone.OfflineContext) {
  const pending = new Map<number, number>() // ticker timeout id -> note start time
  return {
    schedule(timeSec: number, fire: () => void): void {
      const delay = timeSec - context.currentTime - SCHED_LOOKAHEAD
      if (context.isOffline || delay <= 0) {
        fire()
        return
      }
      const id = context.setTimeout(() => {
        pending.delete(id)
        fire()
      }, delay)
      pending.set(id, timeSec)
    },
    cancelAfter(timeSec: number): void {
      for (const [id, t] of pending) {
        if (t >= timeSec - 1e-6) {
          context.clearTimeout(id)
          pending.delete(id)
        }
      }
    },
    cancelAll(): void {
      for (const id of pending.keys()) context.clearTimeout(id)
      pending.clear()
    },
  }
}

export const DEFAULT_PRESET: SynthPreset = {
  oscillator: 'triangle',
  envelope: { attack: 0.005, decay: 0.15, sustain: 0.35, release: 0.25 },
}

/** Tone synth voices are constructed against an explicit Tone context so the
 * same code serves live playback and Tone.OfflineContext rendering. */
export function createToneSynth(
  context: Tone.Context | Tone.OfflineContext,
  dest: AudioNode,
  preset: SynthPreset = DEFAULT_PRESET,
): Instrument {
  const synth = new Tone.PolySynth({
    context,
    maxPolyphony: 32,
    voice: Tone.Synth,
    volume: -8,
    options: {
      oscillator: { type: preset.oscillator },
      envelope: { ...preset.envelope },
    },
  })
  synth.connect(dest)
  const defer = deferredTriggers(context)
  return {
    ready: Promise.resolve(),
    noteOn: (pitch, velocity, timeSec, durationSec) => {
      defer.schedule(timeSec, () => {
        synth.triggerAttackRelease(pitchToHz(pitch), durationSec, timeSec, velocity / 127)
      })
    },
    cancelAfter: (timeSec) => defer.cancelAfter(timeSec),
    stopAll: () => {
      defer.cancelAll()
      synth.releaseAll()
    },
    dispose: () => {
      defer.cancelAll()
      synth.dispose()
    },
  }
}

/**
 * GM-pitch drum kit built from Tone synth voices (kick/toms via MembraneSynth,
 * snare/clap/crash via NoiseSynth, hats/ride via MetalSynth). No samples, no
 * network, renders offline. Mono voices retriggering is drum-appropriate.
 */
export function createDrumKit(
  context: Tone.Context | Tone.OfflineContext,
  dest: AudioNode,
): Instrument {
  const kick = new Tone.MembraneSynth({
    context,
    volume: -4,
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.4 },
  })
  const tom = new Tone.MembraneSynth({
    context,
    volume: -8,
    pitchDecay: 0.06,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.25, sustain: 0.01, release: 0.3 },
  })
  const snare = new Tone.NoiseSynth({
    context,
    volume: -10,
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
  })
  const crash = new Tone.NoiseSynth({
    context,
    volume: -14,
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.9, sustain: 0 },
  })
  const hat = new Tone.MetalSynth({
    context,
    volume: -20,
    envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  })
  const hatOpen = new Tone.MetalSynth({
    context,
    volume: -22,
    envelope: { attack: 0.001, decay: 0.3, release: 0.05 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  })
  const all = [kick, tom, snare, crash, hat, hatOpen]
  for (const s of all) s.connect(dest)
  const defer = deferredTriggers(context)

  return {
    ready: Promise.resolve(),
    noteOn: (pitch, velocity, t, _dur) => {
      defer.schedule(t, () => {
        const vel = velocity / 127
        if (pitch <= 36) kick.triggerAttackRelease(45, 0.4, t, vel)
        else if (pitch === 37 || pitch === 38 || pitch === 39 || pitch === 40)
          snare.triggerAttackRelease(0.14, t, vel)
        else if (pitch === 42 || pitch === 44) hat.triggerAttackRelease(320, 0.05, t, vel)
        else if (pitch === 46) hatOpen.triggerAttackRelease(320, 0.3, t, vel)
        else if (pitch >= 41 && pitch <= 50)
          tom.triggerAttackRelease(pitchToHz(pitch - 12), 0.3, t, vel)
        else if (pitch === 49 || pitch === 57) crash.triggerAttackRelease(0.9, t, vel)
        else if (pitch === 51 || pitch === 59) hatOpen.triggerAttackRelease(480, 0.2, t, vel * 0.8)
        else hat.triggerAttackRelease(320, 0.05, t, vel) // anything else: tick
      })
    },
    cancelAfter: (timeSec) => defer.cancelAfter(timeSec),
    stopAll: () => defer.cancelAll(), // sound is handled by the per-playback gain ramp + dispose
    dispose: () => {
      defer.cancelAll()
      for (const s of all) s.dispose()
    },
  }
}

let cacheStorage: Storage | undefined
function getCacheStorage(): Storage | undefined {
  if (cacheStorage === undefined) {
    try {
      cacheStorage = new CacheStorage()
    } catch {
      cacheStorage = undefined // non-secure context; fall back to HTTP cache
    }
  }
  return cacheStorage
}

const SOUNDFONT_NAMES: Partial<Record<Sound, string>> = {
  epiano: 'electric_piano_1',
  marimba: 'marimba',
  strings: 'string_ensemble_1',
}

export function createSmplrInstrument(
  sound: Exclude<Sound, 'synth'>,
  ctx: BaseAudioContext,
  dest: AudioNode,
): Instrument {
  const options = { destination: dest, storage: getCacheStorage(), volume: 100 }
  const inst =
    sound === 'piano'
      ? SplendidGrandPiano(ctx, options)
      : Soundfont(ctx, { ...options, instrument: SOUNDFONT_NAMES[sound] })
  // smplr's stop() only silences voices that have already started; notes still
  // in its internal scheduler queue keep firing. Each start() returns a stop
  // function that also cancels the queued event — collect them per note (with
  // the start time, so cancelAfter can drop only not-yet-started notes).
  let noteStops: { t: number; stop: (time?: number) => void }[] = []
  return {
    ready: inst.ready,
    noteOn: (pitch, velocity, timeSec, durationSec) => {
      noteStops.push({
        t: timeSec,
        stop: inst.start({ note: pitch, velocity, time: timeSec, duration: durationSec }),
      })
    },
    cancelAfter: (timeSec) => {
      const keep: typeof noteStops = []
      for (const n of noteStops) {
        if (n.t >= timeSec - 1e-6) n.stop()
        else keep.push(n)
      }
      noteStops = keep
    },
    stopAll: () => {
      for (const n of noteStops) n.stop()
      noteStops = []
      inst.stop()
    },
    dispose: () => inst.stop(),
  }
}
