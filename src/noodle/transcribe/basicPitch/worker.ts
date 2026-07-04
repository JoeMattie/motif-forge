/**
 * Dedicated Web Worker for Basic Pitch: owns the onnxruntime-web WASM session
 * (the model is ~17K parameters — no WebGPU gate needed, unlike the neural
 * tier) and runs windowed inference off the main thread. Model bytes are read
 * from OPFS (written there by client.ts after a verified download).
 *
 * Windowing follows the reference basic-pitch pipeline exactly: pad the audio
 * with half the overlap up front, frame into 43844-sample windows hopped by
 * 36164 (zero-padded at the end), then trim 15 frames from each side of every
 * window's output and concatenate, clamped to the frame count of the original
 * audio length.
 */
// The wasm-EP-only bundle: the full 'onnxruntime-web' entry also references
// the 25.6 MiB JSEP/WebGPU binary, which this worker never uses — and which
// is over Cloudflare Pages' 25 MiB per-file limit.
import * as ort from 'onnxruntime-web/wasm'
import {
  BP_INPUT_NAME,
  BP_OUTPUT_NOTE,
  BP_OUTPUT_ONSET,
} from './manifest'
import {
  BP_ANNOTATIONS_FPS,
  BP_AUDIO_N_SAMPLES,
  BP_AUDIO_SAMPLE_RATE,
  BP_HOP_SIZE,
  BP_N_OVERLAPPING_FRAMES,
  BP_OVERLAP_LENGTH,
} from './postprocess'
import type { BpFromWorker, BpToWorker } from './protocol'

ort.env.wasm.numThreads = 1 // tiny model; avoids COOP/COEP requirements

const post = (msg: BpFromWorker, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: BpFromWorker, t?: Transferable[]): void }).postMessage(
    msg,
    transfer,
  )

let session: ort.InferenceSession | null = null

async function readOpfs(name: string): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(name)
  const file = await handle.getFile()
  return file.arrayBuffer()
}

async function init(file: string): Promise<void> {
  try {
    const bytes = await readOpfs(file)
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
    post({ type: 'ready' })
  } catch (e) {
    post({ type: 'unavailable', reason: String(e).slice(0, 200) })
  }
}

const N_BINS = 88
const TRIM = Math.floor(BP_N_OVERLAPPING_FRAMES / 2) // frames trimmed per side

async function transcribe(requestId: string, samples: Float32Array): Promise<void> {
  if (!session) {
    post({ type: 'error', requestId, message: 'basic pitch session not initialized' })
    return
  }
  try {
    // Reference prepareData: pad half the overlap up front, frame with pad_end.
    const padded = new Float32Array(Math.floor(BP_OVERLAP_LENGTH / 2) + samples.length)
    padded.set(samples, Math.floor(BP_OVERLAP_LENGTH / 2))
    const nWindows = Math.max(1, Math.ceil(padded.length / BP_HOP_SIZE))
    const nOutputFramesOriginal = Math.floor(
      samples.length * (BP_ANNOTATIONS_FPS / BP_AUDIO_SAMPLE_RATE),
    )

    const frames = new Float32Array(nOutputFramesOriginal * N_BINS)
    const onsets = new Float32Array(nOutputFramesOriginal * N_BINS)
    let written = 0

    for (let wnd = 0; wnd < nWindows && written < nOutputFramesOriginal; wnd++) {
      const start = wnd * BP_HOP_SIZE
      const window = new Float32Array(BP_AUDIO_N_SAMPLES) // zero pad_end
      const avail = Math.max(0, Math.min(BP_AUDIO_N_SAMPLES, padded.length - start))
      if (avail > 0) window.set(padded.subarray(start, start + avail))

      const input = new ort.Tensor('float32', window, [1, BP_AUDIO_N_SAMPLES, 1])
      const results = await session.run({ [BP_INPUT_NAME]: input })
      const note = results[BP_OUTPUT_NOTE]
      const onset = results[BP_OUTPUT_ONSET]
      const nFrames = Number(note.dims[1])
      const noteData = note.data as Float32Array
      const onsetData = onset.data as Float32Array

      // unwrap: trim half the overlapping frames from both sides
      for (let f = TRIM; f < nFrames - TRIM && written < nOutputFramesOriginal; f++) {
        frames.set(noteData.subarray(f * N_BINS, (f + 1) * N_BINS), written * N_BINS)
        onsets.set(onsetData.subarray(f * N_BINS, (f + 1) * N_BINS), written * N_BINS)
        written++
      }
      post({ type: 'progress', requestId, done: wnd + 1, total: nWindows })
    }

    post(
      { type: 'posteriograms', requestId, nFrames: written, frames, onsets },
      [frames.buffer, onsets.buffer],
    )
  } catch (e) {
    post({ type: 'error', requestId, message: String(e).slice(0, 200) })
  }
}

self.addEventListener('message', (e: MessageEvent<BpToWorker>) => {
  const msg = e.data
  if (msg.type === 'init') void init(msg.file)
  else if (msg.type === 'transcribe') void transcribe(msg.requestId, msg.samples)
})
