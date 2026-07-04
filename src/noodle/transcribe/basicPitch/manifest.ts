/**
 * Pinned Spotify Basic Pitch model artifact (ICASSP 2022 `nmp.onnx`,
 * Apache-2.0 code AND weights — see spotify/basic-pitch). The stock export is
 * self-contained (CQT + harmonic stacking inside the graph) and tiny, so it
 * ships in public/models/ with a content-hash name; the sha256 is verified
 * after download before anything lands in OPFS, same discipline as the
 * neural tier. VITE_MODEL_BASE_URL relocates hosting without code changes.
 *
 * Graph facts (verified in Netron/onnx):
 *   input  serving_default_input_2:0  [batch, 43844, 1]  — 22050 Hz mono, 2 s windows
 *   output StatefulPartitionedCall:0  [batch, 172, 264]  — contour (3 bins/semitone; unused, we carry no bends)
 *   output StatefulPartitionedCall:1  [batch, 172, 88]   — note (frame) posteriogram, MIDI 21–108
 *   output StatefulPartitionedCall:2  [batch, 172, 88]   — onset posteriogram
 */

export interface BasicPitchModelFile {
  name: string
  bytes: number
  sha256: string
}

export const BASIC_PITCH_FILE: BasicPitchModelFile = {
  name: 'nmp.2c3c1d14.onnx',
  bytes: 230444,
  sha256: '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',
}

export const BASIC_PITCH_BASE_URL: string =
  (import.meta.env?.VITE_MODEL_BASE_URL as string | undefined) ?? '/models/'

export const BP_INPUT_NAME = 'serving_default_input_2:0'
export const BP_OUTPUT_NOTE = 'StatefulPartitionedCall:1'
export const BP_OUTPUT_ONSET = 'StatefulPartitionedCall:2'

/** Attribution: Spotify Basic Pitch (ICASSP 2022), Apache 2.0. */
export const BASIC_PITCH_SOURCE = 'spotify/basic-pitch icassp_2022/nmp.onnx'
