import * as Tone from 'tone'
import type { Motif, Part, Sound } from '../types'
import { beatsPerBar } from '../core/theory'
import { createMasterChain, scheduleDrone, scheduleMetronome, scheduleMotif } from './voice'
import {
  createDrumKit,
  createSmplrInstrument,
  createToneSynth,
  type Instrument,
} from './instruments'

export interface PlayOptions {
  tempo: number
  metronome: boolean
  drone: boolean
  sound: Sound // used for motifs without parts
  forceSound: boolean // ignore parts and play everything through `sound`
}

interface EngineSnapshot {
  playingMotifId: string | null
  loading: boolean // waiting for instrument samples before sound starts
}

interface ActiveInstrument {
  inst: Instrument
  transient: boolean // per-playback (Tone synth) — dispose on stop
}

/**
 * Singleton playback engine. Playback state lives here, outside React;
 * components subscribe via useSyncExternalStore. Position is derived from
 * the AudioContext clock, never accumulated.
 */
class AudioEngine {
  private ctx: AudioContext | null = null
  private toneCtx: Tone.Context | null = null
  private masterInput: GainNode | null = null
  private smplrCache = new Map<Sound, Instrument>()

  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot = { playingMotifId: null, loading: false }

  private playToken = 0
  private active: ActiveInstrument[] = []
  private playGain: GainNode | null = null
  private startTime = 0
  private secondsPerBeat = 0.5
  private totalBeats = 0
  private endTimer: number | null = null

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.toneCtx = new Tone.Context(this.ctx)
      this.masterInput = createMasterChain(this.ctx).input
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private instrumentForPart(part: Part, playGain: GainNode): ActiveInstrument {
    if (part.instrument === 'synth') {
      // Cheap to build and preset-specific: one per playback, disposed on stop.
      return { inst: createToneSynth(this.toneCtx!, playGain, part.preset), transient: true }
    }
    if (part.instrument === 'drums') {
      return { inst: createDrumKit(this.toneCtx!, playGain), transient: true }
    }
    // Sampled instruments are expensive (network + decode): cache for the
    // life of the context, connected straight to the master chain.
    let inst = this.smplrCache.get(part.instrument)
    if (!inst) {
      inst = createSmplrInstrument(part.instrument, this.ctx!, this.masterInput!)
      this.smplrCache.set(part.instrument, inst)
    }
    return { inst, transient: false }
  }

  play(motif: Motif, opts: PlayOptions): void {
    const ctx = this.ensureCtx()
    this.stopInternal()

    const token = ++this.playToken
    const playGain = ctx.createGain()
    playGain.connect(this.masterInput!)
    this.playGain = playGain

    const parts: Part[] =
      !opts.forceSound && motif.parts && motif.parts.length > 0
        ? motif.parts
        : [{ name: 'all', instrument: opts.sound }]
    const active = parts.map((p) => this.instrumentForPart(p, playGain))
    this.active = active

    const bpb = beatsPerBar(motif.timeSig)
    this.totalBeats = motif.bars * bpb
    this.secondsPerBeat = 60 / opts.tempo

    this.snapshot = { playingMotifId: motif.id, loading: true }
    this.emit()

    void Promise.all(active.map((a) => a.inst.ready)).then(() => {
      if (token !== this.playToken) return // superseded by another play/stop

      const t0 = ctx.currentTime + 0.08
      this.startTime = t0
      const endTime = scheduleMotif(
        active.map((a) => a.inst),
        motif,
        opts.tempo,
        t0,
      )
      if (opts.metronome) scheduleMetronome(ctx, playGain, this.totalBeats, bpb, opts.tempo, t0)
      if (opts.drone) scheduleDrone(ctx, playGain, motif.key, endTime - t0, t0)

      this.endTimer = window.setTimeout(
        () => {
          if (this.snapshot.playingMotifId === motif.id) this.stop()
        },
        (endTime - ctx.currentTime + 0.5) * 1000,
      )

      this.snapshot = { playingMotifId: motif.id, loading: false }
      this.emit()
    })
  }

  stop(): void {
    this.stopInternal()
    if (this.snapshot.playingMotifId !== null) {
      this.snapshot = { playingMotifId: null, loading: false }
      this.emit()
    }
  }

  toggle(motif: Motif, opts: PlayOptions): void {
    if (this.snapshot.playingMotifId === motif.id) this.stop()
    else this.play(motif, opts)
  }

  private stopInternal(): void {
    this.playToken++
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    for (const { inst, transient } of this.active) {
      inst.stopAll()
      if (transient) window.setTimeout(() => inst.dispose(), 150)
    }
    this.active = []
    if (this.playGain && this.ctx) {
      const g = this.playGain
      const t = this.ctx.currentTime
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0, t + 0.02)
      window.setTimeout(() => g.disconnect(), 150)
      this.playGain = null
    }
  }

  /** Current position in beats of the playing motif, or null. */
  getPositionBeats(): number | null {
    if (!this.ctx || this.snapshot.playingMotifId === null || this.snapshot.loading) return null
    const beats = (this.ctx.currentTime - this.startTime) / this.secondsPerBeat
    return Math.max(0, Math.min(beats, this.totalBeats))
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

export const engine = new AudioEngine()
