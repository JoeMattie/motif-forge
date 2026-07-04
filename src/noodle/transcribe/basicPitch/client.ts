/**
 * Main-thread controller for the Basic Pitch INST transcriber — the same
 * shape as the neural tier's client: singleton snapshot via
 * subscribe/getSnapshot, explicit opt-in download with streamed progress and
 * a full sha256 verify, OPFS cache with remove control, and a module worker
 * owning the ORT session (WASM EP — the model is tiny, no WebGPU gate).
 *
 * The last transcription's posteriograms are cached here so the NeuralNote-
 * style knobs (note sensitivity / split sensitivity / min length) re-run the
 * post-processing instantly without re-running inference.
 */
import type { Note } from '../../../types'
import { BASIC_PITCH_BASE_URL, BASIC_PITCH_FILE } from './manifest'
import {
  BP_AUDIO_SAMPLE_RATE,
  noteFramesToTime,
  outputToNotesPoly,
  type OutputToNotesOptions,
} from './postprocess'
import type { BpFromWorker, BpToWorker } from './protocol'

export type BasicPitchState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error'

export interface BasicPitchSnapshot {
  state: BasicPitchState
  progress: number // 0..1 while downloading
  error: string | null
  totalBytes: number
}

let snapshot: BasicPitchSnapshot = {
  state: 'idle',
  progress: 0,
  error: null,
  totalBytes: BASIC_PITCH_FILE.bytes,
}
const listeners = new Set<() => void>()

function set(patch: Partial<BasicPitchSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

export function subscribeBasicPitch(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getBasicPitchSnapshot(): BasicPitchSnapshot {
  return snapshot
}

/** Posteriograms from the last transcription (knob re-runs read these). */
export interface Posteriograms {
  nFrames: number
  frames: Float32Array // row-major [nFrames × 88]
  onsets: Float32Array
}

let lastPosteriograms: Posteriograms | null = null

export function getLastPosteriograms(): Posteriograms | null {
  return lastPosteriograms
}

let worker: Worker | null = null
let initPromise: Promise<boolean> | null = null

interface PendingRequest {
  resolve: (p: Posteriograms) => void
  reject: (e: Error) => void
}
const pending = new Map<string, PendingRequest>()

function handleMessage(msg: BpFromWorker): void {
  if (msg.type === 'ready' || msg.type === 'unavailable' || msg.type === 'progress') return
  const req = pending.get(msg.requestId)
  if (!req) return
  pending.delete(msg.requestId)
  if (msg.type === 'posteriograms') {
    const p: Posteriograms = { nFrames: msg.nFrames, frames: msg.frames, onsets: msg.onsets }
    lastPosteriograms = p
    req.resolve(p)
  } else {
    req.reject(new Error(msg.message))
  }
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function opfsHas(): Promise<boolean> {
  try {
    const root = await opfsRoot()
    const handle = await root.getFileHandle(BASIC_PITCH_FILE.name)
    return (await handle.getFile()).size === BASIC_PITCH_FILE.bytes
  } catch {
    return false
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function downloadToOpfs(onBytes: (n: number) => void): Promise<void> {
  const res = await fetch(`${BASIC_PITCH_BASE_URL}${BASIC_PITCH_FILE.name}`)
  if (!res.ok || res.body === null) {
    throw new Error(`download failed: HTTP ${res.status} for ${BASIC_PITCH_FILE.name}`)
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onBytes(value.length)
  }
  const buf = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buf.set(chunk, offset)
    offset += chunk.length
  }
  const hash = await sha256Hex(buf.buffer)
  if (hash !== BASIC_PITCH_FILE.sha256) {
    throw new Error(`hash mismatch for ${BASIC_PITCH_FILE.name} — hosted artifact is stale or corrupt`)
  }
  const root = await opfsRoot()
  const handle = await root.getFileHandle(BASIC_PITCH_FILE.name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(buf)
    await writable.close()
  } catch (e) {
    await writable.abort().catch(() => undefined)
    throw e
  }
}

function initWorker(): Promise<boolean> {
  if (initPromise) return initPromise
  initPromise = new Promise<boolean>((resolve) => {
    set({ state: 'loading', error: null })
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<BpFromWorker>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        set({ state: 'ready' })
        resolve(true)
      } else if (msg.type === 'unavailable') {
        set({ state: 'error', error: msg.reason })
        worker?.terminate()
        worker = null
        initPromise = null
        resolve(false)
      } else {
        handleMessage(msg)
      }
    })
    const msg: BpToWorker = { type: 'init', file: BASIC_PITCH_FILE.name }
    worker.postMessage(msg)
  })
  return initPromise
}

/** Probe when INST is first selected: auto-load if already cached. */
export async function initBasicPitch(): Promise<void> {
  if (snapshot.state !== 'idle') return
  if (await opfsHas()) void initWorker()
}

/** Explicit opt-in: download (with progress), verify, cache, load. */
export async function enableBasicPitch(): Promise<void> {
  if (
    snapshot.state === 'downloading' ||
    snapshot.state === 'loading' ||
    snapshot.state === 'ready'
  ) {
    return
  }
  set({ state: 'downloading', progress: 0, error: null })
  let done = 0
  try {
    if (!(await opfsHas())) {
      await downloadToOpfs((n) => {
        done += n
        set({ progress: done / BASIC_PITCH_FILE.bytes })
      })
    }
    await initWorker()
  } catch (e) {
    set({ state: 'error', error: String(e).slice(0, 200) })
  }
}

/** Delete the cached model and drop back to idle. */
export async function removeBasicPitchModel(): Promise<void> {
  worker?.terminate()
  worker = null
  initPromise = null
  pending.clear()
  lastPosteriograms = null
  try {
    const root = await opfsRoot()
    await root.removeEntry(BASIC_PITCH_FILE.name).catch(() => undefined)
  } finally {
    set({ state: 'idle', progress: 0, error: null })
  }
}

/** Resample mono to the model's 22050 Hz via OfflineAudioContext. */
export async function resampleTo22050(
  samples: Float32Array,
  sampleRate: number,
): Promise<Float32Array> {
  if (sampleRate === BP_AUDIO_SAMPLE_RATE) return samples
  const length = Math.ceil((samples.length * BP_AUDIO_SAMPLE_RATE) / sampleRate)
  const offline = new OfflineAudioContext(1, length, BP_AUDIO_SAMPLE_RATE)
  const buffer = offline.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(new Float32Array(samples), 0)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/** Run inference (resampling included); posteriograms are cached for knobs. */
export async function transcribeBasicPitch(
  samples: Float32Array,
  sampleRate: number,
): Promise<Posteriograms> {
  if (snapshot.state !== 'ready' || worker === null) {
    throw new Error('Basic Pitch model not ready — enable it in the Noodle panel')
  }
  const resampled = await resampleTo22050(samples, sampleRate)
  const requestId = crypto.randomUUID()
  return new Promise<Posteriograms>((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    const msg: BpToWorker = { type: 'transcribe', requestId, samples: resampled }
    worker!.postMessage(msg, [resampled.buffer])
  })
}

/** Posteriograms → motif notes with the NeuralNote-style knob settings. */
export function posteriogramsToNotes(
  p: Posteriograms,
  knobs: Partial<OutputToNotesOptions>,
  cfg: { tempo: number; totalBeats: number },
): Note[] {
  const toRows = (flat: Float32Array): number[][] => {
    const rows: number[][] = []
    for (let r = 0; r < p.nFrames; r++) {
      rows.push(Array.from(flat.subarray(r * 88, (r + 1) * 88)))
    }
    return rows
  }
  // outputToNotesPoly mutates its inputs — always hand it fresh copies.
  const events = noteFramesToTime(outputToNotesPoly(toRows(p.frames), toRows(p.onsets), knobs))
  const spb = 60 / cfg.tempo
  const notes: Note[] = []
  for (const e of events) {
    const startBeat = e.startTimeSeconds / spb
    if (startBeat < -1e-3 || startBeat >= cfg.totalBeats - 1e-3) continue
    const pitch = Math.max(36, Math.min(96, e.pitchMidi))
    notes.push({
      pitch,
      startBeat: Math.max(0, startBeat),
      durationBeats: Math.max(0.05, Math.min(cfg.totalBeats - startBeat, e.durationSeconds / spb)),
      velocity: Math.max(1, Math.min(127, Math.round(e.amplitude * 127))),
      part: 0,
    })
  }
  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}
