/** Message contract between the Basic Pitch client and its worker. */

export type BpToWorker =
  | { type: 'init'; file: string }
  | {
      type: 'transcribe'
      requestId: string
      /** 22050 Hz mono (resampled on the main thread via OfflineAudioContext). */
      samples: Float32Array
    }

export type BpFromWorker =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | { type: 'progress'; requestId: string; done: number; total: number }
  | {
      type: 'posteriograms'
      requestId: string
      nFrames: number
      /** Row-major [nFrames × 88] note (frame) and onset posteriograms. */
      frames: Float32Array
      onsets: Float32Array
    }
  | { type: 'error'; requestId: string; message: string }
