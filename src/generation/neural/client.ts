/**
 * Main-thread controller for the neural tier (Phase 5): WebGPU feature gate,
 * explicit opt-in download with progress + sha256 verification, OPFS model
 * cache, worker lifecycle, and batch orchestration that streams each decoded
 * candidate to the UI as it lands.
 *
 * Like the audio engine, this is a singleton outside React; components
 * subscribe via useSyncExternalStore(subscribeNeural, getNeuralSnapshot).
 */
import type { GenerationBrief, Motif } from '../../types'
import { beatsPerBar } from '../../core/theory'
import { childSeed, mulberry32, pick } from '../symbolic/prng'
import { MidiTokenizerV2 } from './tokenizer'
import { buildPromptRows, motifToEvents, type RawMotif } from './adapters'
import { MODEL_BASE_URL, MODEL_FILES, MODEL_TOTAL_BYTES, type ModelFile } from './manifest'
import type { FromWorker, NeuralJob, ToWorker } from './protocol'

export type NeuralState =
  | 'unsupported' // no WebGPU
  | 'idle' // available, model not downloaded
  | 'downloading'
  | 'loading' // bytes present, worker creating sessions
  | 'ready'
  | 'error'

export interface NeuralSnapshot {
  state: NeuralState
  /** 0..1 while downloading. */
  progress: number
  error: string | null
  totalBytes: number
}

/** Share of a neural batch primed with a kept motif (neural analog of the GA). */
export const NEURAL_CONTINUATION_RATIO = 0.4

const SAMPLING = { temperature: 1.0, topP: 0.94, topK: 20 }

let snapshot: NeuralSnapshot = {
  state: 'idle',
  progress: 0,
  error: null,
  totalBytes: MODEL_TOTAL_BYTES,
}
const listeners = new Set<() => void>()

function set(patch: Partial<NeuralSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

export function subscribeNeural(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getNeuralSnapshot(): NeuralSnapshot {
  return snapshot
}

const tok = new MidiTokenizerV2()
let worker: Worker | null = null
let initPromise: Promise<boolean> | null = null

interface PendingRequest {
  onMotif: (raw: RawMotif, seed: number, parentId?: string) => void
  onDone: (generated: number) => void
  onError: (message: string) => void
  onProgress?: (done: number, total: number, eventsPerSec: number) => void
}
const pending = new Map<string, PendingRequest>()

function handleMessage(msg: FromWorker): void {
  if (msg.type === 'ready' || msg.type === 'unavailable') return // handled by init()
  const req = pending.get(msg.requestId)
  if (!req) return
  if (msg.type === 'motif') req.onMotif(msg.raw, msg.seed, msg.parentId)
  else if (msg.type === 'progress') req.onProgress?.(msg.done, msg.total, msg.eventsPerSec)
  else if (msg.type === 'done') {
    pending.delete(msg.requestId)
    req.onDone(msg.generated)
  } else if (msg.type === 'error') {
    pending.delete(msg.requestId)
    req.onError(msg.message)
  }
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function opfsHas(file: ModelFile): Promise<boolean> {
  try {
    const root = await opfsRoot()
    const handle = await root.getFileHandle(file.name)
    return (await handle.getFile()).size === file.bytes
  } catch {
    return false
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function downloadToOpfs(file: ModelFile, onBytes: (n: number) => void): Promise<void> {
  const res = await fetch(`${MODEL_BASE_URL}${file.name}`)
  if (!res.ok || res.body === null) {
    throw new Error(`download failed: HTTP ${res.status} for ${file.name}`)
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
  if (hash !== file.sha256) {
    throw new Error(`hash mismatch for ${file.name} — hosting artifact is stale or corrupt`)
  }
  const root = await opfsRoot()
  const handle = await root.getFileHandle(file.name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(buf)
    await writable.close()
  } catch (e) {
    await writable.abort().catch(() => undefined)
    throw e
  }
}

function webGpuPresent(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/** Spawn the worker and create sessions from OPFS bytes. Resolves ready?. */
function initWorker(): Promise<boolean> {
  if (initPromise) return initPromise
  initPromise = new Promise<boolean>((resolve) => {
    set({ state: 'loading', error: null })
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
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
    const msg: ToWorker = {
      type: 'init',
      files: { base: MODEL_FILES.base.name, token: MODEL_FILES.token.name },
    }
    worker.postMessage(msg)
  })
  return initPromise
}

/** Probe on app start: unsupported / idle / (auto-load when already cached). */
export async function initNeural(): Promise<void> {
  if (!webGpuPresent()) {
    set({ state: 'unsupported' })
    return
  }
  const cached = (await opfsHas(MODEL_FILES.base)) && (await opfsHas(MODEL_FILES.token))
  if (cached) void initWorker()
  else set({ state: 'idle' })
}

/** Explicit opt-in: download (with progress), verify, cache, load. */
export async function enableNeural(): Promise<void> {
  if (snapshot.state === 'downloading' || snapshot.state === 'loading' || snapshot.state === 'ready') {
    return
  }
  set({ state: 'downloading', progress: 0, error: null })
  let done = 0
  try {
    for (const file of [MODEL_FILES.base, MODEL_FILES.token]) {
      if (!(await opfsHas(file))) {
        await downloadToOpfs(file, (n) => {
          done += n
          set({ progress: done / MODEL_TOTAL_BYTES })
        })
      } else {
        done += file.bytes
        set({ progress: done / MODEL_TOTAL_BYTES })
      }
    }
    await initWorker()
  } catch (e) {
    const message =
      e instanceof DOMException && e.name === 'QuotaExceededError'
        ? 'not enough storage for the model (~226 MB) — free some space and retry'
        : String(e).slice(0, 200)
    set({ state: 'error', error: message })
  }
}

/** Settings control: delete the cached model and drop back to idle. */
export async function removeNeuralModel(): Promise<void> {
  worker?.terminate()
  worker = null
  initPromise = null
  pending.clear()
  try {
    const root = await opfsRoot()
    await root.removeEntry(MODEL_FILES.base.name).catch(() => undefined)
    await root.removeEntry(MODEL_FILES.token.name).catch(() => undefined)
  } finally {
    set({ state: webGpuPresent() ? 'idle' : 'unsupported', progress: 0, error: null })
  }
}

export interface NeuralBatchRequest {
  brief: GenerationBrief
  n: number
  /** Kept motifs; a NEURAL_CONTINUATION_RATIO share of the batch continues one. */
  keepers: Motif[]
  seed: number
  onMotif: (raw: RawMotif, seed: number, parentId?: string) => void
  onDone: (generated: number) => void
  onError: (message: string) => void
  /** Sampling progress from the worker: completed candidates + decode speed. */
  onProgress?: (done: number, total: number, eventsPerSec: number) => void
}

/** Build the per-candidate jobs: fresh prompts + keeper continuations. */
export function buildNeuralJobs(
  brief: GenerationBrief,
  n: number,
  keepers: Motif[],
  seed: number,
): NeuralJob[] {
  const rng = mulberry32(seed)
  const jobs: NeuralJob[] = []
  const bpb = beatsPerBar(brief.timeSig)
  const wantedBeats = brief.bars * bpb
  for (let i = 0; i < n; i++) {
    const jobSeed = childSeed(seed, i)
    const continueKeeper = keepers.length > 0 && rng() < NEURAL_CONTINUATION_RATIO
    if (continueKeeper) {
      const parent = pick(rng, keepers)
      const rows = motifToEvents(parent, tok)
      rows.pop() // drop EOS so the model continues instead of stopping
      const parentBeats = parent.bars * beatsPerBar(parent.timeSig)
      const channels = new Set<number>()
      let melodic = 0
      const parts = parent.parts.length > 0 ? parent.parts : [{ instrument: 'synth' }]
      for (const part of parts) {
        if (part.instrument === 'drums') channels.add(9)
        else {
          if (melodic === 9) melodic = 10
          channels.add(melodic++)
        }
      }
      jobs.push({
        seed: jobSeed,
        promptRows: rows,
        targetBeats: parentBeats + wantedBeats,
        decodeFromBeat: parentBeats,
        bars: brief.bars,
        timeSig: parent.timeSig,
        maxEvents: Math.min(512, wantedBeats * 8 + 32),
        disableChannels: Array.from({ length: 16 }, (_, c) => c).filter((c) => !channels.has(c)),
        parentId: parent.id,
        ...SAMPLING,
      })
    } else {
      const patches = new Map<number, number>([[0, 0]]) // grand piano lead
      if (brief.includeRhythm) patches.set(9, 0) // standard kit
      jobs.push({
        seed: jobSeed,
        promptRows: buildPromptRows(
          { bpm: brief.tempo, timeSig: brief.timeSig, key: brief.key, mode: brief.mode, patches },
          tok,
        ),
        targetBeats: wantedBeats,
        decodeFromBeat: 0,
        bars: brief.bars,
        timeSig: brief.timeSig,
        maxEvents: Math.min(512, wantedBeats * 8 + 32),
        disableChannels: Array.from({ length: 16 }, (_, c) => c).filter((c) => !patches.has(c)),
        ...SAMPLING,
      })
    }
  }
  return jobs
}

/** Stream one neural batch; returns a cancel handle. */
export function requestNeuralBatch(req: NeuralBatchRequest): { cancel(): void } {
  const requestId = crypto.randomUUID()
  if (snapshot.state !== 'ready' || worker === null) {
    req.onError('neural engine not ready')
    return { cancel: () => undefined }
  }
  pending.set(requestId, {
    onMotif: req.onMotif,
    onDone: req.onDone,
    onError: req.onError,
    onProgress: req.onProgress,
  })
  const msg: ToWorker = {
    type: 'generate',
    requestId,
    jobs: buildNeuralJobs(req.brief, req.n, req.keepers, req.seed),
  }
  worker.postMessage(msg)
  return {
    cancel: () => {
      pending.delete(requestId)
      const cancelMsg: ToWorker = { type: 'cancel', requestId }
      worker?.postMessage(cancelMsg)
    },
  }
}
