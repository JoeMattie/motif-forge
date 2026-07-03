import type { Motif } from '../types'
import { beatsPerBar, keyToPitchClass, pitchToHz } from '../core/theory'
import type { Instrument } from './instruments'

/**
 * Motif notes play through an Instrument (Tone synth or smplr samples — see
 * instruments.ts). The master chain, metronome, and drone stay hand-rolled
 * raw WebAudio against BaseAudioContext so they work identically in live
 * playback and offline WAV rendering.
 */

/**
 * Schedule every note of the motif from t0, routing each note to its part's
 * instrument (instruments[note.part], clamped). Returns the end time in seconds.
 * fromBeat starts playback mid-motif (notes that already began are skipped) —
 * used by the A/B audition's swap-on-bar.
 */
export function scheduleMotif(
  instruments: Instrument[],
  motif: Motif,
  tempo: number,
  t0: number,
  fromBeat = 0,
): number {
  const spb = 60 / tempo
  for (const n of motif.notes) {
    if (n.startBeat < fromBeat - 1e-6) continue
    const inst = instruments[Math.min(n.part ?? 0, instruments.length - 1)]
    inst.noteOn(n.pitch, n.velocity, t0 + (n.startBeat - fromBeat) * spb, n.durationBeats * spb)
  }
  return t0 + (motif.bars * beatsPerBar(motif.timeSig) - fromBeat) * spb
}

export function scheduleMetronome(
  ctx: BaseAudioContext,
  dest: AudioNode,
  totalBeats: number,
  bpb: number,
  tempo: number,
  t0: number,
): void {
  const spb = 60 / tempo
  for (let beat = 0; beat < totalBeats; beat++) {
    const t = t0 + beat * spb
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = beat % bpb === 0 ? 1500 : 1000
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.12, t + 0.002)
    gain.gain.setTargetAtTime(0, t + 0.015, 0.01)
    osc.connect(gain).connect(dest)
    osc.start(t)
    osc.stop(t + 0.1)
  }
}

export function scheduleDrone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  key: string,
  durationSec: number,
  t0: number,
): void {
  const rootPitch = 36 + keyToPitchClass(key) // octave 2
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = pitchToHz(rootPitch)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.06, t0 + 0.1)
  gain.gain.setTargetAtTime(0, t0 + durationSec, 0.1)
  osc.connect(gain).connect(dest)
  osc.start(t0)
  osc.stop(t0 + durationSec + 0.5)
}

/** Master chain shared by live + offline paths: gain -> compressor -> destination. */
export function createMasterChain(ctx: BaseAudioContext): { input: GainNode; master: GainNode } {
  const master = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -12
  comp.ratio.value = 6
  master.connect(comp).connect(ctx.destination)
  return { input: master, master }
}
