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
  /** Stop everything sounding and scheduled. */
  stopAll(): void
  dispose(): void
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
  return {
    ready: Promise.resolve(),
    noteOn: (pitch, velocity, timeSec, durationSec) => {
      synth.triggerAttackRelease(pitchToHz(pitch), durationSec, timeSec, velocity / 127)
    },
    stopAll: () => synth.releaseAll(),
    dispose: () => synth.dispose(),
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

  return {
    ready: Promise.resolve(),
    noteOn: (pitch, velocity, t, _dur) => {
      const vel = velocity / 127
      if (pitch <= 36) kick.triggerAttackRelease(45, 0.4, t, vel)
      else if (pitch === 37 || pitch === 38 || pitch === 39 || pitch === 40)
        snare.triggerAttackRelease(0.14, t, vel)
      else if (pitch === 42 || pitch === 44) hat.triggerAttackRelease(320, 0.05, t, vel)
      else if (pitch === 46) hatOpen.triggerAttackRelease(320, 0.3, t, vel)
      else if (pitch >= 41 && pitch <= 50) tom.triggerAttackRelease(pitchToHz(pitch - 12), 0.3, t, vel)
      else if (pitch === 49 || pitch === 57) crash.triggerAttackRelease(0.9, t, vel)
      else if (pitch === 51 || pitch === 59) hatOpen.triggerAttackRelease(480, 0.2, t, vel * 0.8)
      else hat.triggerAttackRelease(320, 0.05, t, vel) // anything else: tick
    },
    stopAll: () => {}, // stop is handled by the per-playback gain ramp + dispose
    dispose: () => all.forEach((s) => s.dispose()),
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
  return {
    ready: inst.ready,
    noteOn: (pitch, velocity, timeSec, durationSec) => {
      inst.start({ note: pitch, velocity, time: timeSec, duration: durationSec })
    },
    stopAll: () => inst.stop(),
    dispose: () => inst.stop(),
  }
}
