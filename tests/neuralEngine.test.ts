/**
 * Neural engine loop tests with scripted fake sessions — no onnxruntime.
 * The fake token model emits a huge logit on the next scripted id, so the
 * engine's masking/sampling must reproduce the script exactly; the fake base
 * model records call shapes so KV-cache incrementality is observable.
 */
import { describe, expect, it } from 'vitest'
import {
  generateEvents,
  rowsBeats,
  sampleTopPK,
  softmaxWithTemp,
  type SessionLike,
  type TensorLike,
  type TensorMaker,
} from '../src/generation/neural/engine'
import { MODEL_CONFIG } from '../src/generation/neural/manifest'
import { MidiTokenizerV2 } from '../src/generation/neural/tokenizer'
import { buildPromptRows } from '../src/generation/neural/adapters'

const tok = new MidiTokenizerV2()
const make: TensorMaker = (type, data, dims) => ({ dims, data, type }) as unknown as TensorLike

const prompt = () =>
  buildPromptRows(
    { bpm: 120, timeSig: '4/4', key: 'C', mode: 'ionian', patches: new Map([[0, 0]]) },
    tok,
  )

/** Unpadded note row (event id + 7 params) via the real tokenizer tables. */
const noteRow = (t1: number, t2: number, ch: number, pitch: number) =>
  tok.event2tokens(['note', t1, t2, 1, ch, pitch, 100, 4]).slice(0, 8)

function presentKv(prefix: Record<string, TensorLike>, layers: number, heads: number, hs: number, seq: number) {
  for (let i = 0; i < layers; i++) {
    prefix[`present.${i}.key`] = make('float32', new Float32Array(0), [1, heads, seq, hs])
    prefix[`present.${i}.value`] = make('float32', new Float32Array(0), [1, heads, seq, hs])
  }
  return prefix
}

class FakeBase implements SessionLike {
  calls: { n: number; past: number }[] = []
  async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
    const n = feeds.x.dims[1]
    const past = feeds['past_key_values.0.key'].dims[2]
    this.calls.push({ n, past })
    const out: Record<string, TensorLike> = {
      hidden: make('float32', new Float32Array(n * MODEL_CONFIG.embSize), [1, n, MODEL_CONFIG.embSize]),
    }
    return presentKv(out, MODEL_CONFIG.baseLayers, MODEL_CONFIG.baseHeads, MODEL_CONFIG.baseHeadSize, past + n)
  }
}

/** Emits scripted ids one sub-token at a time (50-logit spike per target). */
class FakeToken implements SessionLike {
  private queue: number[]
  calls = 0
  constructor(rows: number[][]) {
    this.queue = rows.flat()
  }
  async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
    const past = feeds['past_key_values.0.key'].dims[2]
    void past
    const target = this.queue[this.calls] ?? tok.eosId
    this.calls++
    const logits = new Float32Array(tok.vocabSize)
    logits[target] = 50
    const out: Record<string, TensorLike> = {
      y: make('float32', logits, [1, 1, tok.vocabSize]),
    }
    return presentKv(out, MODEL_CONFIG.tokenLayers, MODEL_CONFIG.tokenHeads, MODEL_CONFIG.tokenHeadSize, this.calls)
  }
}

const eosRow = () => [tok.eosId]

const spec = (over: Record<string, unknown> = {}) => ({
  promptRows: prompt(),
  maxEvents: 64,
  targetBeats: null as number | null,
  temperature: 1.0,
  topP: 0.94,
  topK: 20,
  seed: 42,
  ...over,
})

describe('sampling primitives', () => {
  it('softmaxWithTemp normalizes and favors the max', () => {
    const probs = softmaxWithTemp(new Float32Array([1, 2, 3]), 1)
    const sum = probs[0] + probs[1] + probs[2]
    expect(sum).toBeCloseTo(1, 6)
    expect(probs[2]).toBeGreaterThan(probs[1])
  })

  it('sampleTopPK honors top-k and the reference top-p boundary', () => {
    const probs = new Float32Array([0.5, 0.3, 0.2])
    // top-k = 1: always the argmax
    expect(sampleTopPK(probs, 1.0, 1, () => 0.99)).toBe(0)
    // top-p = 0.5 keeps ranks 0 and 1 (cum-BEFORE ≤ p, like the reference),
    // never rank 2
    expect(sampleTopPK(probs, 0.5, 10, () => 0.99)).toBe(1)
    expect(sampleTopPK(probs, 0.5, 10, () => 0.0)).toBe(0)
  })

  it('rowsBeats sums time1 deltas over event rows only', () => {
    const rows = [
      [tok.bosId, 0, 0, 0, 0, 0, 0, 0],
      tok.event2tokens(['set_tempo', 0, 0, 0, 120]),
      tok.event2tokens(['note', 2, 4, 1, 0, 60, 100, 4]),
      tok.event2tokens(['note', 3, 0, 1, 0, 62, 100, 4]),
    ]
    expect(rowsBeats(rows, tok)).toBe(5)
  })
})

describe('generateEvents', () => {
  it('reproduces the scripted rows and stops at EOS', async () => {
    const rows = [noteRow(0, 0, 0, 60), noteRow(1, 0, 0, 64), eosRow()]
    const base = new FakeBase()
    const token = new FakeToken(rows)
    const result = await generateEvents({ base, token }, make, MODEL_CONFIG, tok, spec())
    expect(result.completed).toBe(true)
    expect(result.generated).toBe(2)
    const generated = result.rows.slice(prompt().length)
    expect(generated).toEqual([rows[0], rows[1]])
  })

  it('feeds the base model incrementally via the KV cache', async () => {
    const base = new FakeBase()
    const token = new FakeToken([noteRow(0, 0, 0, 60), noteRow(1, 0, 0, 62), eosRow()])
    await generateEvents({ base, token }, make, MODEL_CONFIG, tok, spec())
    const p = prompt().length
    expect(base.calls).toEqual([
      { n: p, past: 0 },
      { n: 1, past: p },
      { n: 1, past: p + 1 },
    ])
  })

  it('stops once the next event reaches targetBeats, discarding it', async () => {
    const rows = [noteRow(0, 0, 0, 60), noteRow(2, 0, 0, 62), noteRow(2, 0, 0, 64)]
    const base = new FakeBase()
    const token = new FakeToken(rows)
    const result = await generateEvents(
      { base, token },
      make,
      MODEL_CONFIG,
      tok,
      spec({ targetBeats: 4 }),
    )
    // events land at beats 0 and 2; the third would start at beat 4 = full
    expect(result.completed).toBe(true)
    expect(result.generated).toBe(2)
    expect(rowsBeats(result.rows, tok)).toBe(2)
  })

  it('honors maxEvents as a hard cap', async () => {
    const endless = Array.from({ length: 20 }, (_, i) => noteRow(1, 0, 0, 60 + (i % 12)))
    const result = await generateEvents(
      { base: new FakeBase(), token: new FakeToken(endless) },
      make,
      MODEL_CONFIG,
      tok,
      spec({ maxEvents: 5 }),
    )
    expect(result.generated).toBe(5)
    expect(result.completed).toBe(true)
  })

  it('never samples a disabled channel even when the model insists', async () => {
    const rows = [noteRow(0, 0, 3, 60)] // model pushes hard for channel 3
    const result = await generateEvents(
      { base: new FakeBase(), token: new FakeToken(rows) },
      make,
      MODEL_CONFIG,
      tok,
      spec({ maxEvents: 1, disableChannels: [3] }),
    )
    expect(result.generated).toBe(1)
    const row = result.rows[result.rows.length - 1]
    const channelToken = row[4]
    expect(channelToken).not.toBe(tok.parameterIds.channel[3])
    // still a legal channel id
    expect(tok.parameterIds.channel).toContain(channelToken)
  })

  it('aborts between events when shouldStop flips', async () => {
    const endless = Array.from({ length: 20 }, () => noteRow(1, 0, 0, 60))
    let events = 0
    const result = await generateEvents(
      { base: new FakeBase(), token: new FakeToken(endless) },
      make,
      MODEL_CONFIG,
      tok,
      spec(),
      { onEvent: () => events++, shouldStop: () => events >= 3 },
    )
    expect(result.completed).toBe(false)
    expect(result.generated).toBe(3)
  })

  it('is deterministic for a given seed when probabilities are spread', async () => {
    // No scripted spike: uniform logits make sampling purely rng-driven.
    class UniformToken implements SessionLike {
      async run(): Promise<Record<string, TensorLike>> {
        const out: Record<string, TensorLike> = {
          y: make('float32', new Float32Array(tok.vocabSize), [1, 1, tok.vocabSize]),
        }
        return presentKv(out, MODEL_CONFIG.tokenLayers, MODEL_CONFIG.tokenHeads, MODEL_CONFIG.tokenHeadSize, 1)
      }
    }
    const run = () =>
      generateEvents(
        { base: new FakeBase(), token: new UniformToken() },
        make,
        MODEL_CONFIG,
        tok,
        spec({ maxEvents: 6, topK: 50, seed: 1234 }),
      )
    const a = await run()
    const b = await run()
    expect(a.rows).toEqual(b.rows)
  })
})
