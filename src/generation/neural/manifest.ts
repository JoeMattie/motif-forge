/**
 * Pinned int8 model artifacts for the neural tier, produced by
 * tools/quantize/quantize.py (see tools/quantize/dist/manifest.json). File
 * names carry a content-hash prefix for cache-busting; full sha256 hashes are
 * verified after download before anything is written to OPFS.
 *
 * Hosting: artifacts are fetched from VITE_MODEL_BASE_URL (default `/models/`
 * on the app's own static host — drop the dist/ files there, or point the
 * env var at a CORS-friendly host like a HF repo's resolve/main URL).
 */

export interface ModelFile {
  name: string
  bytes: number
  sha256: string
}

/** Architecture facts (verified in docs/model-notes.md); the engine is
 * model-agnostic — sizes come from here, never constants in the loop. */
export interface NeuralModelConfig {
  baseLayers: number
  baseHeads: number
  baseHeadSize: number
  tokenLayers: number
  tokenHeads: number
  tokenHeadSize: number
  embSize: number
}

export const MODEL_CONFIG: NeuralModelConfig = {
  baseLayers: 12,
  baseHeads: 16,
  baseHeadSize: 64,
  tokenLayers: 3,
  tokenHeads: 4,
  tokenHeadSize: 256,
  embSize: 1024,
}

export const MODEL_FILES: { base: ModelFile; token: ModelFile } = {
  base: {
    name: 'model_base.q8.0d5db3a6.onnx',
    bytes: 207138439,
    sha256: '0d5db3a62032facc08eda62fd80bc8b27f3aeea0fd2f6a00079f92d997e28b1f',
  },
  token: {
    name: 'model_token.q8.3be942e2.onnx',
    bytes: 29640678,
    sha256: '3be942e23c38ee3635d89ded190284ab5b2b40abdb61ba374348442b97a9c9fc',
  },
}

export const MODEL_TOTAL_BYTES = MODEL_FILES.base.bytes + MODEL_FILES.token.bytes

export const MODEL_BASE_URL: string =
  (import.meta.env?.VITE_MODEL_BASE_URL as string | undefined) ?? '/models/'

/** Attribution: SkyTNT midi-model tv2o-medium, Apache 2.0. */
export const MODEL_SOURCE = 'skytnt/midi-model-tv2o-medium'
