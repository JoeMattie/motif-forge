/**
 * Loop-overdub recorder for MIDI / musical-typing capture — a singleton state
 * machine outside React (idle → armed → recording), subscribed via
 * useSyncExternalStore like the audio engine.
 *
 * Armed = live monitoring through a Tone synth on the SHARED context with the
 * click running on a continuous bar grid. Recording starts at the bar
 * boundary of the first note-on and loops N bars; every pass overdubs into
 * the take store. Beat positions are derived from ctx.currentTime against the
 * anchor (never accumulated), so they're exact by construction. LOCK snaps
 * pitches on capture, SNAP quantizes startBeat on capture.
 */
import * as Tone from 'tone'
import { engine } from '../audio/engine'
import { beatsPerBar, pitchToHz } from '../core/theory'
import { scheduleMetronome } from '../audio/voice'
import { addNote, getTake, pushUndo, takeTotalBeats } from './takeStore'
import { clampPitch, quantizeRound, snapPitchToScale } from './quantize'
import { onMidiNote, type NoodleNoteEvent } from './midiInput'
import { armTyping } from './musicalTyping'

export type RecorderState = 'idle' | 'armed' | 'recording'

export interface RecorderSnapshot {
  state: RecorderState
  input: 'midi' | 'keys' | null
}

/** Capture-time toggles, read live per note so panel flips apply mid-take. */
export interface CapturePrefs {
  lock: boolean
  snap: boolean
  grid: number // beats
}

export interface ArmOptions {
  input: 'midi' | 'keys'
  prefs: () => CapturePrefs
  /** Musical-typing octave plumbing (KEYS input only). */
  getOctave?: () => number
  onOctaveShift?: (delta: number) => void
}

let snapshot: RecorderSnapshot = { state: 'idle', input: null }
const listeners = new Set<() => void>()

function set(patch: Partial<RecorderSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

export function subscribeRecorder(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getRecorderSnapshot(): RecorderSnapshot {
  return snapshot
}

interface Session {
  ctx: AudioContext
  monitor: Tone.PolySynth
  monitorGain: GainNode
  clickGain: GainNode
  clickTimer: number | null
  clickStart: number // context time of the click grid origin
  anchor: number | null // context time of the take's beat 0 (first note's bar)
  spb: number
  totalBeats: number
  bpb: number
  prefs: () => CapturePrefs
  active: Map<number, { startCtx: number; velocity: number; pitch: number }>
  unsubscribe: () => void
  undoPushed: boolean
}

let session: Session | null = null

function handleNote(e: NoodleNoteEvent): void {
  const s = session
  if (!s) return
  if (e.type === 'on') {
    const { lock } = s.prefs()
    const take = getTake()
    const pitch = clampPitch(
      lock && !take.drums ? snapPitchToScale(e.pitch, take.key, take.mode) : e.pitch,
    )
    const now = s.ctx.currentTime
    s.monitor.triggerAttack(pitchToHz(pitch), now, Math.max(0.05, e.velocity / 127))
    if (snapshot.state === 'armed') {
      // First note-on: recording anchors to the bar boundary it fell in.
      const barSec = s.bpb * s.spb
      s.anchor = s.clickStart + Math.floor((now - s.clickStart) / barSec) * barSec
      set({ state: 'recording' })
    }
    if (snapshot.state === 'recording') {
      // Keyed on the RAW pitch so the matching note-off finds it.
      s.active.set(e.pitch, { startCtx: now, velocity: e.velocity, pitch })
    }
  } else {
    const held = s.active.get(e.pitch)
    // Release whatever the on-event actually sounded (post-lock pitch).
    const soundedHz = pitchToHz(held ? held.pitch : e.pitch)
    s.monitor.triggerRelease(soundedHz, s.ctx.currentTime)
    if (!held || snapshot.state !== 'recording' || s.anchor === null) return
    s.active.delete(e.pitch)
    const now = s.ctx.currentTime
    const { snap, grid } = s.prefs()
    const rawStart = (held.startCtx - s.anchor) / s.spb
    let startBeat = ((rawStart % s.totalBeats) + s.totalBeats) % s.totalBeats
    if (snap) {
      startBeat = quantizeRound(startBeat, grid)
      startBeat = ((startBeat % s.totalBeats) + s.totalBeats) % s.totalBeats
    }
    const durationBeats = Math.max(
      0.1,
      Math.min(s.totalBeats - startBeat, (now - held.startCtx) / s.spb),
    )
    if (!s.undoPushed) {
      pushUndo()
      s.undoPushed = true
    }
    addNote(
      {
        pitch: held.pitch,
        startBeat,
        durationBeats,
        velocity: Math.max(1, Math.min(127, held.velocity)),
        part: 0,
      },
      false, // one undo snapshot per recording session, pushed above
    )
  }
}

/** Gapless click: one pass of the loop, rescheduled ~300ms before its end. */
function scheduleClickChain(s: Session, t0: number): void {
  scheduleMetronome(s.ctx, s.clickGain, s.totalBeats, s.bpb, 60 / s.spb, t0)
  const end = t0 + s.totalBeats * s.spb
  s.clickTimer = window.setTimeout(
    () => {
      if (session === s) scheduleClickChain(s, end)
    },
    Math.max(0, (end - s.ctx.currentTime - 0.3) * 1000),
  )
}

/** Arm capture: monitoring + click start now; recording waits for a note. */
export function armRecorder(opts: ArmOptions): void {
  stopRecorder()
  engine.stop() // the click grid replaces any loop audition
  const { ctx, toneCtx, masterInput } = engine.acquire()

  const take = getTake()
  const monitorGain = ctx.createGain()
  monitorGain.connect(masterInput)
  const clickGain = ctx.createGain()
  clickGain.gain.value = 0.9
  clickGain.connect(masterInput)
  const monitor = new Tone.PolySynth({
    context: toneCtx,
    maxPolyphony: 16,
    voice: Tone.Synth,
    volume: -8,
  })
  monitor.connect(monitorGain)

  const s: Session = {
    ctx,
    monitor,
    monitorGain,
    clickGain,
    clickTimer: null,
    clickStart: ctx.currentTime + 0.15,
    anchor: null,
    spb: 60 / take.tempo,
    totalBeats: takeTotalBeats(take),
    bpb: beatsPerBar(take.timeSig),
    prefs: opts.prefs,
    active: new Map(),
    unsubscribe: () => {},
    undoPushed: false,
  }
  session = s
  scheduleClickChain(s, s.clickStart)

  s.unsubscribe =
    opts.input === 'midi'
      ? onMidiNote(handleNote)
      : armTyping({
          getOctave: opts.getOctave ?? (() => 4),
          onOctaveShift: opts.onOctaveShift ?? (() => {}),
          onNote: handleNote,
        })

  set({ state: 'armed', input: opts.input })
}

/** Disarm/stop: close held notes, kill the click, release the monitor. */
export function stopRecorder(): void {
  const s = session
  if (!s) return
  // Land any still-held notes before tearing down (their offs won't arrive).
  for (const raw of [...s.active.keys()]) {
    handleNote({ type: 'off', pitch: raw, velocity: 0 })
  }
  session = null
  s.unsubscribe()
  if (s.clickTimer !== null) clearTimeout(s.clickTimer)
  s.monitor.releaseAll()
  const t = s.ctx.currentTime
  for (const g of [s.monitorGain, s.clickGain]) {
    g.gain.setValueAtTime(g.gain.value, t)
    g.gain.linearRampToValueAtTime(0, t + 0.05)
  }
  window.setTimeout(() => {
    s.monitor.dispose()
    s.monitorGain.disconnect()
    s.clickGain.disconnect()
  }, 400)
  set({ state: 'idle', input: null })
}

/**
 * Position of the capture playhead in beats: the recording pass position, or
 * the click-grid position while armed (so the sweep shows the grid you'd be
 * recording into). Null when idle.
 */
export function getRecorderPositionBeats(): number | null {
  const s = session
  if (!s) return null
  const origin = s.anchor ?? s.clickStart
  const beats = (s.ctx.currentTime - origin) / s.spb
  if (beats < 0) return 0
  return ((beats % s.totalBeats) + s.totalBeats) % s.totalBeats
}
