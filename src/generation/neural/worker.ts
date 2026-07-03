/**
 * Dedicated Web Worker for the neural tier: owns the onnxruntime-web WebGPU
 * sessions and runs the sampling loop off the main thread. Model bytes are
 * read from OPFS (written there by client.ts after a verified download).
 * WebGPU only — if session creation fails we report unavailable and the app
 * stays on Tier 1; there is deliberately no WASM fallback at this model size.
 */
import * as ort from 'onnxruntime-web/webgpu'
import { MidiTokenizerV2 } from './tokenizer'
import { eventsToMotif, trimRawMotif } from './adapters'
import { generateEvents, type SessionLike, type TensorMaker } from './engine'
import { MODEL_CONFIG } from './manifest'
import type { FromWorker, NeuralJob, ToWorker } from './protocol'

// No wasmPaths override: ORT 1.27's webgpu bundle selects its own binary
// (ort-wasm-simd-threaded.asyncify.wasm) via new URL(..., import.meta.url),
// which Vite resolves in dev (/@fs) and rewrites to a hashed local asset in
// build — offline either way. Forcing a different binary (e.g. the JSEP one)
// mismatches the glue's expected exports: "ke.$b is not a function".
ort.env.wasm.numThreads = 1 // GPU does the heavy lifting; avoids COOP/COEP needs

const post = (msg: FromWorker) => (self as unknown as { postMessage(m: FromWorker): void }).postMessage(msg)

const tok = new MidiTokenizerV2()
// ort.Tensor's data union is wider than TensorLike's (string tensors etc.);
// ours are only ever float32/int64, so the narrowing is safe.
const makeTensor: TensorMaker = (type, data, dims) =>
  new ort.Tensor(type, data, dims) as unknown as ReturnType<TensorMaker>

let sessions: { base: SessionLike; token: SessionLike } | null = null
const cancelled = new Set<string>()
// ORT sessions can't run() concurrently — a second batch while one is in
// flight throws mid-inference. Chain them so extra generate clicks queue.
let batchChain: Promise<void> = Promise.resolve()

async function readOpfs(name: string): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(name)
  const file = await handle.getFile()
  return file.arrayBuffer()
}

async function init(files: { base: string; token: string }): Promise<void> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    if (!gpu || (await gpu.requestAdapter()) === null) {
      post({ type: 'unavailable', reason: 'WebGPU adapter unavailable' })
      return
    }
    const [baseBytes, tokenBytes] = await Promise.all([
      readOpfs(files.base),
      readOpfs(files.token),
    ])
    const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['webgpu'] }
    const base = await ort.InferenceSession.create(baseBytes, opts)
    const token = await ort.InferenceSession.create(tokenBytes, opts)
    sessions = { base: base as SessionLike, token: token as SessionLike }
    post({ type: 'ready' })
  } catch (e) {
    post({ type: 'unavailable', reason: String(e).slice(0, 200) })
  }
}

async function runBatch(requestId: string, jobs: NeuralJob[]): Promise<void> {
  if (!sessions) {
    post({ type: 'error', requestId, message: 'neural sessions not initialized' })
    return
  }
  let produced = 0
  try {
    for (let index = 0; index < jobs.length; index++) {
      if (cancelled.has(requestId)) break
      const job = jobs[index]
      const t0 = performance.now()
      let events = 0
      const result = await generateEvents(
        sessions,
        makeTensor,
        MODEL_CONFIG,
        tok,
        {
          promptRows: job.promptRows,
          maxEvents: job.maxEvents,
          targetBeats: job.targetBeats,
          temperature: job.temperature,
          topP: job.topP,
          topK: job.topK,
          seed: job.seed,
          disableChannels: job.disableChannels,
          disablePatchChange: true, // instruments are fixed by the prompt
          disableControlChange: true, // motifs carry no CC
        },
        {
          onEvent: (_row, n) => {
            events = n
            if (n % 8 === 0) {
              post({
                type: 'progress',
                requestId,
                done: index,
                total: jobs.length,
                eventsPerSec: (n / Math.max(1, performance.now() - t0)) * 1000,
              })
            }
          },
          shouldStop: () => cancelled.has(requestId),
        },
      )
      if (cancelled.has(requestId) || !result.completed) break
      // trimRawMotif also clamps trailing durations into the bar count for
      // fresh jobs (fromBeat 0) — validation drops notes that overrun.
      const decoded = eventsToMotif(result.rows, tok)
      const raw = trimRawMotif(decoded, job.decodeFromBeat, job.bars)
      post({ type: 'motif', requestId, index, raw, seed: job.seed, parentId: job.parentId })
      produced++
      post({
        type: 'progress',
        requestId,
        done: index + 1,
        total: jobs.length,
        eventsPerSec: (events / Math.max(1, performance.now() - t0)) * 1000,
      })
    }
    post({ type: 'done', requestId, generated: produced })
  } catch (e) {
    post({ type: 'error', requestId, message: String(e).slice(0, 200) })
  } finally {
    cancelled.delete(requestId)
  }
}

self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'init') void init(msg.files)
  else if (msg.type === 'generate') {
    // runBatch reports its own failures via post(); the catch only keeps a
    // rejected link from wedging the chain for every later batch.
    batchChain = batchChain.then(() => runBatch(msg.requestId, msg.jobs)).catch(() => undefined)
  }
  else if (msg.type === 'cancel') cancelled.add(msg.requestId)
})
