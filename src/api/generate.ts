import type { GenerationBrief, Motif } from '../types'
import { callClaude } from './client'
import { extractJson } from './parse'
import {
  buildGenerationPrompt,
  buildMutationPrompt,
  buildSurprisePrompt,
  type MutationOptions,
} from './prompts'
import { lockedPartsRoundTrip, validateBatch, type ValidationResult } from '../core/validate'
import { newId } from '../core/ids'

// Sized for ~5 polyphonic motifs of minified JSON (multi-part + drums can run
// ~2k tokens each). Callers chunk larger requests down to 5 per call.
const MAX_TOKENS = 16000

async function runBatch(
  prompt: string,
  retryPrompt: (n: number) => string,
  n: number,
  toResult: (raw: unknown) => ValidationResult,
): Promise<ValidationResult> {
  let { text, stopReason } = await callClaude(prompt, MAX_TOKENS)
  if (stopReason === 'max_tokens') {
    // Truncated JSON is unsalvageable — retry once with a smaller batch.
    const smaller = Math.max(3, Math.floor(n / 2))
    ;({ text, stopReason } = await callClaude(retryPrompt(smaller), MAX_TOKENS))
    if (stopReason === 'max_tokens') throw new Error('response truncated twice; try a smaller batch')
  }
  return toResult(extractJson(text))
}

export async function generateBatch(brief: GenerationBrief, n: number): Promise<ValidationResult> {
  const batchId = newId()
  return runBatch(
    buildGenerationPrompt(brief, n),
    (m) => buildGenerationPrompt(brief, m),
    n,
    (raw) =>
      validateBatch(raw, {
        key: brief.key,
        mode: brief.mode,
        bars: brief.bars,
        timeSig: brief.timeSig,
        tempo: brief.tempo,
        allowChromatic: brief.allowChromatic,
        source: () => ({ kind: 'generated', brief: brief.text, batchId }),
      }),
  )
}

/** Free-rein batch: the model picks key/mode/tempo/bars per motif. */
export async function generateSurpriseBatch(n: number): Promise<ValidationResult> {
  const batchId = newId()
  return runBatch(
    buildSurprisePrompt(n),
    (m) => buildSurprisePrompt(m),
    n,
    (raw) =>
      validateBatch(raw, {
        key: 'C',
        mode: 'ionian',
        bars: 4,
        timeSig: '4/4',
        tempo: 100,
        allowChromatic: true,
        source: () => ({ kind: 'generated', brief: 'surprise me', batchId }),
      }),
  )
}

export async function mutateBatch(
  parent: Motif,
  mutationBrief: string,
  n: number,
  opts: MutationOptions = {},
): Promise<ValidationResult> {
  const locked = (opts.lockedParts ?? []).filter((i) => i >= 0 && i < parent.parts.length)
  const varied = parent.parts.map((_, i) => i).filter((i) => !locked.includes(i))
  const result = await runBatch(
    buildMutationPrompt(parent, mutationBrief, n, opts),
    (m) => buildMutationPrompt(parent, mutationBrief, m, opts),
    n,
    (raw) =>
      validateBatch(raw, {
        key: parent.key,
        mode: parent.mode,
        bars: parent.bars,
        timeSig: parent.timeSig,
        tempo: parent.tempo,
        allowChromatic: true,
        conceptId: parent.conceptId,
        source: () => ({
          kind: 'llm-mutation',
          parentId: parent.id,
          brief: mutationBrief,
          ...(parent.parts.length > 0 && locked.length > 0 ? { variedParts: varied } : {}),
        }),
      }),
  )
  // PART LOCK is a hard contract: children whose locked parts don't
  // round-trip verbatim are dropped, per the brief's validation rule.
  if (locked.length > 0) {
    const kept = result.valid.filter((child) => lockedPartsRoundTrip(parent, child, locked))
    const droppedHere = result.valid.length - kept.length
    if (droppedHere > 0) {
      result.errors.push(`${droppedHere} dropped: locked parts were modified`)
      result.droppedCount += droppedHere
      result.valid = kept
    }
  }
  return result
}
