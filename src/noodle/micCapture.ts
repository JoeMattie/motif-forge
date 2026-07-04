/**
 * Click-synced mic capture: getUserMedia → AudioWorklet → Float32 chunks on
 * the SHARED audio context. A count-in bar (or two) of metronome precedes a
 * window of exactly bars × beatsPerBar × secondsPerBeat samples — beat
 * positions are exact by construction, so the transcribers never estimate
 * tempo. A fixed latency-compensation offset (input + output chain) shifts
 * the collection window so what Joe sang ON the click lands ON the beat.
 *
 * Singleton snapshot (idle/counting/recording/processing) so the panel status
 * line and the roll playhead can follow along.
 */
import { engine } from '../audio/engine'
import { beatsPerBar } from '../core/theory'
import { scheduleMetronome } from '../audio/voice'

export type MicState = 'idle' | 'counting' | 'recording' | 'processing'

export interface MicSnapshot {
  state: MicState
  /** Human-readable status for the panel LCD strip. */
  status: string
}

let snapshot: MicSnapshot = { state: 'idle', status: '' }
const listeners = new Set<() => void>()

function set(patch: Partial<MicSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

export function subscribeMic(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getMicSnapshot(): MicSnapshot {
  return snapshot
}

/** Inline AudioWorklet processor: posts each render quantum's mono input with
 * its context timestamp. A Blob module keeps the worklet self-contained (no
 * asset plumbing); the processor code is plain JS by construction. */
const WORKLET_SOURCE = `
class NoodleCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length > 0) {
      const copy = new Float32Array(ch)
      this.port.postMessage({ t: currentTime, samples: copy }, [copy.buffer])
    }
    return true
  }
}
registerProcessor('noodle-capture', NoodleCaptureProcessor)
`

const workletReady = new WeakSet<AudioContext>()

async function ensureWorklet(ctx: AudioContext): Promise<void> {
  if (workletReady.has(ctx)) return
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
    workletReady.add(ctx)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface MicCaptureConfig {
  tempo: number
  bars: number
  timeSig: string
  countInBars: number
  /** Round-trip latency compensation in ms (output click + input chain). */
  latencyMs: number
}

export interface MicCaptureResult {
  samples: Float32Array
  sampleRate: number
}

interface ActiveCapture {
  ctx: AudioContext
  stream: MediaStream
  node: AudioWorkletNode
  source: MediaStreamAudioSourceNode
  sink: GainNode
  clickGain: GainNode
  timers: number[]
  cancelled: boolean
  reject: (e: Error) => void
}

let active: ActiveCapture | null = null

/** Mic-record playhead in beats (recording window only), or null. */
let positionFn: (() => number | null) | null = null
export function getMicPositionBeats(): number | null {
  return positionFn ? positionFn() : null
}

function teardown(a: ActiveCapture): void {
  for (const t of a.timers) clearTimeout(t)
  a.node.port.onmessage = null
  a.node.disconnect()
  a.source.disconnect()
  a.sink.disconnect()
  const t = a.ctx.currentTime
  a.clickGain.gain.cancelScheduledValues(0)
  a.clickGain.gain.setValueAtTime(a.clickGain.gain.value, t)
  a.clickGain.gain.linearRampToValueAtTime(0, t + 0.03)
  window.setTimeout(() => a.clickGain.disconnect(), 200)
  for (const track of a.stream.getTracks()) track.stop()
  positionFn = null
  if (active === a) active = null
}

export function cancelMicCapture(): void {
  const a = active
  if (!a) return
  a.cancelled = true
  teardown(a)
  set({ state: 'idle', status: '' })
  a.reject(new Error('cancelled'))
}

/**
 * Run one capture: count-in clicks, then exactly N bars (+ a small tail that
 * is trimmed off). Resolves with mono samples at the context's sample rate;
 * the caller picks the transcriber. Rejects on mic denial or cancel.
 */
export function captureMic(cfg: MicCaptureConfig): Promise<MicCaptureResult> {
  return new Promise<MicCaptureResult>((resolve, reject) => {
    void (async () => {
      if (active) cancelMicCapture()
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
      } catch {
        reject(new Error('microphone access denied'))
        return
      }
      const { ctx, masterInput } = engine.acquire()
      try {
        await ensureWorklet(ctx)
      } catch (e) {
        for (const track of stream.getTracks()) track.stop()
        reject(new Error(`audio worklet unavailable: ${String(e).slice(0, 80)}`))
        return
      }

      const sr = ctx.sampleRate
      const bpb = beatsPerBar(cfg.timeSig)
      const spb = 60 / cfg.tempo
      const barSec = bpb * spb
      const t0 = ctx.currentTime + 0.2
      const tRec = t0 + cfg.countInBars * barSec
      const recSec = cfg.bars * barSec
      const tEnd = tRec + recSec
      const latency = Math.max(0, cfg.latencyMs) / 1000
      // The singer tracks the HEARD click (output latency) and the mic path
      // adds input latency — samples for beat b arrive at tRec + b·spb + lat.
      const winStart = tRec + latency
      const winEnd = tEnd + latency
      const totalSamples = Math.round(recSec * sr)
      const buffer = new Float32Array(totalSamples)

      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'noodle-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      })
      // Some engines only pump worklets connected toward the destination —
      // route through a muted sink.
      const sink = ctx.createGain()
      sink.gain.value = 0
      source.connect(node)
      node.connect(sink)
      sink.connect(ctx.destination)

      const clickGain = ctx.createGain()
      clickGain.gain.value = 1
      clickGain.connect(masterInput)
      // One continuous click from the count-in through the whole window.
      scheduleMetronome(clickGain.context, clickGain, (cfg.countInBars + cfg.bars) * bpb, bpb, cfg.tempo, t0)

      const a: ActiveCapture = {
        ctx,
        stream,
        node,
        source,
        sink,
        clickGain,
        timers: [],
        cancelled: false,
        reject,
      }
      active = a

      positionFn = () => {
        const now = ctx.currentTime
        if (now < tRec || now > tEnd) return null
        return (now - tRec) / spb
      }

      node.port.onmessage = (e: MessageEvent<{ t: number; samples: Float32Array }>) => {
        const { t, samples } = e.data
        const chunkEnd = t + samples.length / sr
        if (chunkEnd <= winStart || t >= winEnd) return
        const srcFrom = Math.max(0, Math.round((winStart - t) * sr))
        const dstFrom = Math.max(0, Math.round((t - winStart) * sr))
        const count = Math.min(samples.length - srcFrom, totalSamples - dstFrom)
        if (count > 0) buffer.set(samples.subarray(srcFrom, srcFrom + count), dstFrom)
      }

      set({ state: 'counting', status: `COUNT-IN — ${cfg.countInBars} bar${cfg.countInBars === 1 ? '' : 's'}` })
      a.timers.push(
        window.setTimeout(
          () => {
            if (!a.cancelled) set({ state: 'recording', status: `RECORDING — ${cfg.bars} bars` })
          },
          Math.max(0, (tRec - ctx.currentTime) * 1000),
        ),
      )
      a.timers.push(
        window.setTimeout(
          () => {
            if (a.cancelled) return
            set({ state: 'processing', status: 'TRANSCRIBING…' })
            teardown(a)
            resolve({ samples: buffer, sampleRate: sr })
          },
          // small tail so the last latency-shifted chunks land before teardown
          Math.max(0, (winEnd + 0.15 - ctx.currentTime) * 1000),
        ),
      )
    })()
  })
}

/** The caller finished transcription (or failed) — back to idle. */
export function micDone(): void {
  set({ state: 'idle', status: '' })
}
