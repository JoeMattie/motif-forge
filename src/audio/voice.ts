import type { Motif } from '../types'
import { beatsPerBar, keyToPitchClass, pitchToHz } from '../core/theory'

/**
 * All scheduling targets BaseAudioContext so live playback (AudioContext) and
 * WAV export (OfflineAudioContext) share the exact same synth graph.
 */

function scheduleNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  pitch: number,
  velocity: number,
  t: number,
  durationSec: number,
): void {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = pitchToHz(pitch)

  const gain = ctx.createGain()
  const peak = Math.pow(velocity / 127, 1.5) * 0.35
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(peak, t + 0.005)
  gain.gain.setTargetAtTime(peak * 0.3, t + 0.005, 0.08)
  const noteEnd = t + durationSec
  gain.gain.setTargetAtTime(0, noteEnd, 0.03)

  osc.connect(gain).connect(dest)
  osc.start(t)
  osc.stop(noteEnd + 0.25)
}

/** Schedule every note of the motif from t0. Returns the end time in seconds. */
export function scheduleMotif(
  ctx: BaseAudioContext,
  dest: AudioNode,
  motif: Motif,
  tempo: number,
  t0: number,
): number {
  const spb = 60 / tempo
  for (const n of motif.notes) {
    scheduleNote(ctx, dest, n.pitch, n.velocity, t0 + n.startBeat * spb, n.durationBeats * spb)
  }
  return t0 + motif.bars * beatsPerBar(motif.timeSig) * spb
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
