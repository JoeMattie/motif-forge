import * as Tone from 'tone'
import type { Motif, Part, Sound } from '../types'
import { beatsPerBar } from '../core/theory'
import { createMasterChain, scheduleDrone, scheduleMetronome, scheduleMotif } from './voice'
import {
  createDrumKit,
  createSmplrInstrument,
  createToneSynth,
  SCHED_LOOKAHEAD,
  type Instrument,
} from './instruments'

export interface PlayOptions {
  tempo: number
  metronome: boolean
  drone: boolean
  sound: Sound // used for motifs without parts
  forceSound: boolean // ignore parts and play everything through `sound`
  loop?: boolean // restart from beat 0 when the motif ends (A/B audition)
}

// swap() cutover distance: must sit beyond the instruments' trigger lookahead
// so every note it cancels is still cancellable (anything closer is committed).
const SWAP_CUTOVER = SCHED_LOOKAHEAD + 0.05

interface EngineSnapshot {
  playingMotifId: string | null
  loading: boolean // waiting for instrument samples before sound starts
}

interface ActiveInstrument {
  inst: Instrument
  transient: boolean // per-playback (Tone synth) — dispose on stop
  gain?: GainNode // cached smplr output — hard-muted on stop to cut release tails
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
  private smplrCache = new Map<Sound, { inst: Instrument; gain: GainNode }>()

  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot = { playingMotifId: null, loading: false }

  private playToken = 0
  private active: ActiveInstrument[] = []
  private playGain: GainNode | null = null
  private startTime = 0
  private startBeat = 0
  private secondsPerBeat = 0.5
  private totalBeats = 0
  private looping = false
  private endTimer: number | null = null
  // Loop state lives on the instance (not in play()'s closure) so swap() can
  // redirect future iterations to a new motif mid-flight.
  private loopMotif: Motif | null = null
  private loopOpts: PlayOptions | null = null
  private loopScheduledUntil = 0 // context time covered by committed iterations

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
    // life of the context. Each gets its own gain into the master chain so
    // stop can mute it instantly (release tails decay silently); the gain is
    // restored just before the next playback that uses it.
    let entry = this.smplrCache.get(part.instrument)
    if (!entry) {
      const gain = this.ctx!.createGain()
      gain.connect(this.masterInput!)
      entry = { inst: createSmplrInstrument(part.instrument, this.ctx!, gain), gain }
      this.smplrCache.set(part.instrument, entry)
    }
    return { inst: entry.inst, transient: false, gain: entry.gain }
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
      this.startBeat = 0
      // Un-mute cached instruments right before their first note; anything
      // still decaying from a previous stop stays silent until then.
      for (const a of active) {
        if (a.gain) {
          a.gain.gain.cancelScheduledValues(0)
          a.gain.gain.setValueAtTime(1, Math.max(ctx.currentTime, t0 - 0.02))
        }
      }
      const endTime = scheduleMotif(
        active.map((a) => a.inst),
        motif,
        opts.tempo,
        t0,
        0,
      )
      if (opts.metronome) scheduleMetronome(ctx, playGain, this.totalBeats, bpb, opts.tempo, t0)
      if (opts.drone) scheduleDrone(ctx, playGain, motif.key, endTime - t0, t0)

      this.looping = !!opts.loop
      this.loopMotif = motif
      this.loopOpts = opts
      this.loopScheduledUntil = endTime
      if (opts.loop) {
        // Gapless loop: keep the instruments alive and schedule each next
        // iteration ~300ms before the boundary, at the exact WebAudio end
        // timestamp — no teardown/rebuild, no setTimeout jitter in the audio.
        // getPositionBeats wraps by modulo, so the playhead follows for free.
        // Each iteration re-reads loopMotif/loopOpts so swap() takes effect.
        const scheduleNext = (iterStart: number) => {
          if (token !== this.playToken) return
          const m = this.loopMotif!
          const o = this.loopOpts!
          const iterEnd = scheduleMotif(
            active.map((a) => a.inst),
            m,
            o.tempo,
            iterStart,
            0,
          )
          if (o.metronome)
            scheduleMetronome(ctx, playGain, this.totalBeats, bpb, o.tempo, iterStart)
          if (o.drone) scheduleDrone(ctx, playGain, m.key, iterEnd - iterStart, iterStart)
          this.loopScheduledUntil = iterEnd
          this.endTimer = window.setTimeout(
            () => scheduleNext(iterEnd),
            Math.max(0, (iterEnd - ctx.currentTime - 0.3) * 1000),
          )
        }
        this.endTimer = window.setTimeout(
          () => scheduleNext(endTime),
          Math.max(0, (endTime - ctx.currentTime - 0.3) * 1000),
        )
      } else {
        this.endTimer = window.setTimeout(
          () => {
            if (this.snapshot.playingMotifId !== motif.id) return
            this.stop()
          },
          (endTime - ctx.currentTime + 0.5) * 1000,
        )
      }

      this.snapshot = { playingMotifId: motif.id, loading: false }
      this.emit()
    })
  }

  /**
   * Replace the looping motif's notes mid-flight (the bay mix when a take
   * selection changes): notes scheduled at/after the cutover (~SWAP_CUTOVER s
   * out) are cancelled, whatever is already sounding rings out naturally, and
   * the new motif's notes take over on the same beat grid — startTime/startBeat
   * are untouched, so the playhead never jumps. Falls back to a fresh play()
   * when nothing compatible (same id, length, tempo, part count) is looping.
   */
  swap(motif: Motif, opts: PlayOptions): void {
    const ctx = this.ctx
    const spb = 60 / opts.tempo
    const partCount =
      !opts.forceSound && motif.parts && motif.parts.length > 0 ? motif.parts.length : 1
    if (
      !ctx ||
      !this.looping ||
      this.snapshot.loading ||
      this.snapshot.playingMotifId !== motif.id ||
      motif.bars * beatsPerBar(motif.timeSig) !== this.totalBeats ||
      Math.abs(spb - this.secondsPerBeat) > 1e-9 ||
      partCount !== this.active.length
    ) {
      this.play(motif, opts)
      return
    }

    this.loopMotif = motif
    this.loopOpts = opts

    const insts = this.active.map((a) => a.inst)
    const tc = ctx.currentTime + SWAP_CUTOVER
    for (const inst of insts) inst.cancelAfter(tc)

    // Beat position at the cutover, on the unchanged grid.
    const raw = this.startBeat + (tc - this.startTime) / spb
    const pos = ((raw % this.totalBeats) + this.totalBeats) % this.totalBeats
    // Rest of the sounding iteration. Its metronome/drone are already
    // committed raw WebAudio (uncancellable) and grid-identical — notes only.
    const iterEnd = scheduleMotif(insts, motif, opts.tempo, tc, pos)
    // The loop chain schedules ~300ms ahead, so the next iteration may already
    // be committed; its old notes were cancelled above — re-lay the new ones.
    // Later iterations pick up loopMotif via the pending scheduleNext.
    if (this.loopScheduledUntil > iterEnd + 1e-3) {
      scheduleMotif(insts, motif, opts.tempo, iterEnd, 0)
    }
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
    this.looping = false
    this.loopMotif = null
    this.loopOpts = null
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    for (const { inst, transient, gain } of this.active) {
      inst.stopAll()
      if (gain && this.ctx) {
        const t = this.ctx.currentTime
        gain.gain.cancelScheduledValues(0)
        gain.gain.setValueAtTime(gain.gain.value, t)
        gain.gain.linearRampToValueAtTime(0, t + 0.015)
      }
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

  /** Current position in beats of the playing motif, or null. Wraps while looping. */
  getPositionBeats(): number | null {
    if (!this.ctx || this.snapshot.playingMotifId === null || this.snapshot.loading) return null
    const beats = this.startBeat + (this.ctx.currentTime - this.startTime) / this.secondsPerBeat
    if (this.looping && this.totalBeats > 0) {
      return ((beats % this.totalBeats) + this.totalBeats) % this.totalBeats
    }
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
