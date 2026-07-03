/**
 * Tier-2 neural inference engine: the two-session sampling loop of SkyTNT
 * midi-model, ported from app_onnx.py's generate() (batch size 1, streaming).
 * Runs inside the neural worker in production, but is written against
 * injected SessionLike/TensorMaker interfaces so tests can drive it with
 * scripted fake sessions — no onnxruntime import here.
 *
 * Loop shape (verified against the reference, docs/model-notes.md):
 *   event loop  — model_base over new event rows with an explicit KV cache
 *                 (past_key_values.{i}.key/value -> present.{i}.key/value),
 *                 take the last hidden state;
 *   token loop  — model_token decodes the event id then up to 7 params, with
 *                 its own per-event KV cache, masked so only legal ids can be
 *                 sampled at each position.
 * Sampling = softmax(logits/temp) · mask, then top-p, then top-k,
 * renormalize, categorical draw — same order as the reference, driven by the
 * app's seedable mulberry32 so any motif is reproducible.
 */
import { mulberry32, type Rng } from '../symbolic/prng'
import { MidiTokenizerV2 } from './tokenizer'
import type { NeuralModelConfig } from './manifest'

export interface TensorLike {
  readonly dims: readonly number[]
  readonly data: Float32Array | BigInt64Array
}

export type TensorMaker = (
  type: 'float32' | 'int64',
  data: Float32Array | BigInt64Array,
  dims: number[],
) => TensorLike

export interface SessionLike {
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>
}

export interface GenerateSpec {
  /** BOS + setup rows (and keeper rows for continuation), each maxTokenSeq long. */
  promptRows: number[][]
  /** Hard cap on generated events (safety net; targetBeats usually stops first). */
  maxEvents: number
  /** Stop once the next event would start at/after this beat (null = no limit).
   * Measured from the very first row, so continuation prompts count too. */
  targetBeats: number | null
  temperature: number
  topP: number
  topK: number
  seed: number
  /** Channel numbers (0-15) the model may NOT write to. */
  disableChannels?: number[]
  disablePatchChange?: boolean
  disableControlChange?: boolean
}

export interface GenerateHooks {
  /** Called after each accepted event row. */
  onEvent?: (row: number[], generatedCount: number) => void
  /** Polled between events; return true to abort (rows so far are returned). */
  shouldStop?: () => boolean
}

/** softmax(logits / temp) into a fresh Float32Array. */
export function softmaxWithTemp(logits: Float32Array, temp: number): Float32Array {
  const out = new Float32Array(logits.length)
  let max = -Infinity
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i] / temp
    out[i] = v
    if (v > max) max = v
  }
  let sum = 0
  for (let i = 0; i < out.length; i++) {
    const e = Math.exp(out[i] - max)
    out[i] = e
    sum += e
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum
  return out
}

/**
 * Reference-order nucleus sampling: sort probs descending, keep an entry
 * while the cumulative mass BEFORE it is ≤ p AND its rank < k, renormalize
 * over the kept set, draw. Mirrors app_onnx.py's sample_top_p_k.
 */
export function sampleTopPK(probs: Float32Array, topP: number, topK: number, rng: Rng): number {
  const idx: number[] = Array.from(probs.keys())
  idx.sort((a, b) => probs[b] - probs[a])
  const cand: number[] = []
  const candP: number[] = []
  let cumBefore = 0
  for (let r = 0; r < idx.length && r < topK; r++) {
    if (cumBefore > topP) break
    const p = probs[idx[r]]
    if (p > 0) {
      cand.push(idx[r])
      candP.push(p)
    }
    cumBefore += p
  }
  if (cand.length === 0) return idx[0]
  let total = 0
  for (const p of candP) total += p
  let roll = rng() * total
  for (let i = 0; i < cand.length; i++) {
    roll -= candP[i]
    if (roll < 0) return cand[i]
  }
  return cand[cand.length - 1]
}

const kvName = (i: number) => [`past_key_values.${i}.key`, `past_key_values.${i}.value`] as const

function emptyKv(
  make: TensorMaker,
  layers: number,
  heads: number,
  headSize: number,
): Record<string, TensorLike> {
  const feeds: Record<string, TensorLike> = {}
  for (let i = 0; i < layers; i++) {
    const [k, v] = kvName(i)
    feeds[k] = make('float32', new Float32Array(0), [1, heads, 0, headSize])
    feeds[v] = make('float32', new Float32Array(0), [1, heads, 0, headSize])
  }
  return feeds
}

/** Carry present.* outputs forward as the next call's past_key_values.*. */
function carryKv(
  outputs: Record<string, TensorLike>,
  layers: number,
): Record<string, TensorLike> {
  const feeds: Record<string, TensorLike> = {}
  for (let i = 0; i < layers; i++) {
    const [k, v] = kvName(i)
    feeds[k] = outputs[`present.${i}.key`]
    feeds[v] = outputs[`present.${i}.value`]
  }
  return feeds
}

function rowsToTensor(make: TensorMaker, rows: number[][], tokenSeq: number): TensorLike {
  const data = new BigInt64Array(rows.length * tokenSeq)
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < tokenSeq; c++) data[r * tokenSeq + c] = BigInt(rows[r][c])
  }
  return make('int64', data, [1, rows.length, tokenSeq])
}

/** Sum of time1 deltas across event rows (BOS/EOS rows contribute 0). */
export function rowsBeats(rows: number[][], tok: MidiTokenizerV2): number {
  const t1Start = tok.parameterIds.time1[0]
  let beats = 0
  for (const row of rows) {
    if (row[0] in tok.idEvents) beats += row[1] - t1Start
  }
  return beats
}

export interface GenerateResult {
  /** All rows: prompt + generated (no EOS row). */
  rows: number[][]
  generated: number
  /** True when the loop ended by EOS/targetBeats/maxEvents, false when aborted. */
  completed: boolean
}

export async function generateEvents(
  sessions: { base: SessionLike; token: SessionLike },
  make: TensorMaker,
  cfg: NeuralModelConfig,
  tok: MidiTokenizerV2,
  spec: GenerateSpec,
  hooks: GenerateHooks = {},
): Promise<GenerateResult> {
  const rng = mulberry32(spec.seed)
  const t1Start = tok.parameterIds.time1[0]
  const disabledChannelIds = new Set(
    (spec.disableChannels ?? []).map((c) => tok.parameterIds.channel[c]),
  )

  const rows = spec.promptRows.map((r) => [...r])
  let beats = rowsBeats(rows, tok)
  let generated = 0
  let pastLen = 0
  let baseKv = emptyKv(make, cfg.baseLayers, cfg.baseHeads, cfg.baseHeadSize)

  while (generated < spec.maxEvents) {
    if (hooks.shouldStop?.()) return { rows, generated, completed: false }

    // --- event step: base model over the not-yet-seen rows ---
    const newRows = rows.slice(pastLen)
    const baseOut = await sessions.base.run({
      x: rowsToTensor(make, newRows, tok.maxTokenSeq),
      ...baseKv,
    })
    baseKv = carryKv(baseOut, cfg.baseLayers)
    const hiddenAll = baseOut.hidden.data as Float32Array
    const lastHidden = hiddenAll.subarray(
      (newRows.length - 1) * cfg.embSize,
      newRows.length * cfg.embSize,
    )

    // --- sub-token loop: decode event id + params with the token model ---
    let tokKv = emptyKv(make, cfg.tokenLayers, cfg.tokenHeads, cfg.tokenHeadSize)
    const sampled: number[] = []
    let eventName = ''
    let sawEos = false
    for (let i = 0; i < tok.maxTokenSeq; i++) {
      // Legal ids at this position.
      let allowed: number[]
      if (i === 0) {
        allowed = [...Object.values(tok.eventIds), tok.eosId]
        if (spec.disablePatchChange) {
          allowed = allowed.filter((id) => id !== tok.eventIds.patch_change)
        }
        if (spec.disableControlChange) {
          allowed = allowed.filter((id) => id !== tok.eventIds.control_change)
        }
      } else {
        const paramName = tok.events[eventName][i - 1]
        allowed = tok.parameterIds[paramName]
        if (paramName === 'channel' && disabledChannelIds.size > 0) {
          allowed = allowed.filter((id) => !disabledChannelIds.has(id))
        }
      }

      const hidden =
        i === 0
          ? make('float32', new Float32Array(lastHidden), [1, 1, cfg.embSize])
          : make('float32', new Float32Array(0), [1, 0, cfg.embSize])
      const x =
        i === 0
          ? make('int64', new BigInt64Array(0), [1, 0])
          : make('int64', new BigInt64Array([BigInt(sampled[sampled.length - 1])]), [1, 1])
      const tokOut = await sessions.token.run({ hidden, x, ...tokKv })
      tokKv = carryKv(tokOut, cfg.tokenLayers)
      const y = tokOut.y
      const q = y.dims[1]
      const logits = (y.data as Float32Array).subarray((q - 1) * tok.vocabSize, q * tok.vocabSize)

      const probs = softmaxWithTemp(logits, spec.temperature)
      const masked = new Float32Array(tok.vocabSize)
      for (const id of allowed) masked[id] = probs[id]
      const sample = sampleTopPK(masked, spec.topP, spec.topK, rng)

      if (i === 0) {
        if (sample === tok.eosId) {
          sawEos = true
          break
        }
        eventName = tok.idEvents[sample]
      }
      sampled.push(sample)
      if (i > 0 && tok.events[eventName].length === i) break
    }
    if (sawEos) return { rows, generated, completed: true }

    const row = [...sampled]
    while (row.length < tok.maxTokenSeq) row.push(tok.padId)

    // Stop-by-length: an event starting at/after the target beat is discarded
    // and generation ends — the phrase is full.
    const newBeats = beats + (row[1] - t1Start)
    if (spec.targetBeats !== null && newBeats >= spec.targetBeats) {
      return { rows, generated, completed: true }
    }

    rows.push(row)
    beats = newBeats
    pastLen = rows.length - 1
    generated++
    hooks.onEvent?.(row, generated)
  }
  return { rows, generated, completed: true }
}
