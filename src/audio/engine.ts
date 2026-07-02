import type { Motif } from '../types'
import { beatsPerBar } from '../core/theory'
import {
  createMasterChain,
  scheduleDrone,
  scheduleMetronome,
  scheduleMotif,
} from './voice'

export interface PlayOptions {
  tempo: number
  metronome: boolean
  drone: boolean
}

interface EngineSnapshot {
  playingMotifId: string | null
}

/**
 * Singleton playback engine. Playback state lives here, outside React;
 * components subscribe via useSyncExternalStore. Position is derived from
 * the AudioContext clock, never accumulated.
 */
class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot = { playingMotifId: null }
  private startTime = 0
  private secondsPerBeat = 0.5
  private totalBeats = 0
  private endTime = 0
  private endTimer: number | null = null

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  play(motif: Motif, opts: PlayOptions): void {
    const ctx = this.ensureCtx()
    this.stopInternal()

    const { input, master } = createMasterChain(ctx)
    this.master = master

    const t0 = ctx.currentTime + 0.06
    const bpb = beatsPerBar(motif.timeSig)
    this.totalBeats = motif.bars * bpb
    this.secondsPerBeat = 60 / opts.tempo
    this.startTime = t0

    this.endTime = scheduleMotif(ctx, input, motif, opts.tempo, t0)
    if (opts.metronome) scheduleMetronome(ctx, input, this.totalBeats, bpb, opts.tempo, t0)
    if (opts.drone) scheduleDrone(ctx, input, motif.key, this.endTime - t0, t0)

    // Auto-stop shortly after the last note's release tail
    this.endTimer = window.setTimeout(
      () => {
        if (this.snapshot.playingMotifId === motif.id) this.stop()
      },
      (this.endTime - ctx.currentTime + 0.4) * 1000,
    )

    this.snapshot = { playingMotifId: motif.id }
    this.emit()
  }

  stop(): void {
    this.stopInternal()
    if (this.snapshot.playingMotifId !== null) {
      this.snapshot = { playingMotifId: null }
      this.emit()
    }
  }

  toggle(motif: Motif, opts: PlayOptions): void {
    if (this.snapshot.playingMotifId === motif.id) this.stop()
    else this.play(motif, opts)
  }

  private stopInternal(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    if (this.master && this.ctx) {
      const m = this.master
      const t = this.ctx.currentTime
      m.gain.setValueAtTime(m.gain.value, t)
      m.gain.linearRampToValueAtTime(0, t + 0.015)
      window.setTimeout(() => m.disconnect(), 60)
      this.master = null
    }
  }

  /** Current position in beats of the playing motif, or null. */
  getPositionBeats(): number | null {
    if (!this.ctx || this.snapshot.playingMotifId === null) return null
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
