/** Message protocol between the neural client (main thread) and worker. */
import type { RawMotif } from './adapters'

/** One candidate to generate; the client builds prompts, the worker samples. */
export interface NeuralJob {
  seed: number
  promptRows: number[][]
  /** Absolute stop beat (prompt beats included for continuations). */
  targetBeats: number
  /** Decoded notes before this beat are trimmed (continuation prompt material). */
  decodeFromBeat: number
  /** Bar count stamped on the decoded motif. */
  bars: number
  timeSig: string
  maxEvents: number
  temperature: number
  topP: number
  topK: number
  disableChannels: number[]
  /** Keeper id when this job continues a kept motif. */
  parentId?: string
}

export type ToWorker =
  | { type: 'init'; files: { base: string; token: string } }
  | { type: 'generate'; requestId: string; jobs: NeuralJob[] }
  | { type: 'cancel'; requestId: string }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | { type: 'progress'; requestId: string; done: number; total: number; eventsPerSec: number }
  | { type: 'motif'; requestId: string; index: number; raw: RawMotif; seed: number; parentId?: string }
  | { type: 'done'; requestId: string; generated: number }
  | { type: 'error'; requestId: string; message: string }
