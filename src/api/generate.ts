import type { GenerationBrief, Motif } from '../types'
import { callClaude } from './client'
import { extractJson } from './parse'
import { buildGenerationPrompt, buildMutationPrompt } from './prompts'
import { validateBatch, type ValidationResult } from '../core/validate'
import { newId } from '../core/ids'

const MAX_TOKENS = 8000

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

export async function mutateBatch(
  parent: Motif,
  mutationBrief: string,
  n: number,
): Promise<ValidationResult> {
  return runBatch(
    buildMutationPrompt(parent, mutationBrief, n),
    (m) => buildMutationPrompt(parent, mutationBrief, m),
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
        source: () => ({ kind: 'llm-mutation', parentId: parent.id, brief: mutationBrief }),
      }),
  )
}
