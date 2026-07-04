/**
 * Claude-as-planner bridge for the INSTANT engine (after M6(GPT)3): one small
 * LLM call turns the author's free-text brief into an InstantSpec that steers
 * the offline symbolic generator. Every note is still written offline. Any
 * failure — no API path, network error, garbage JSON — resolves to null, and
 * the caller proceeds exactly as if no planner existed.
 */
import type { GenerationBrief, InstantSpec } from '../types'
import { callClaude } from './client'
import { extractJson } from './parse'
import { buildPlanPrompt } from './prompts'
import { parseInstantPlan } from '../generation/symbolic/plan'

/** The spec is tiny minified JSON; a small cap keeps the planner cheap. */
const PLAN_MAX_TOKENS = 500

export async function planInstantSpec(
  brief: GenerationBrief,
  onStep?: (step: string) => void,
): Promise<InstantSpec | null> {
  try {
    onStep?.('planning with claude-sonnet-4-6 — mood, contours, progression')
    const { text } = await callClaude(buildPlanPrompt(brief), PLAN_MAX_TOKENS)
    return parseInstantPlan(extractJson(text), brief.bars)
  } catch {
    return null // planner is best-effort: fall back to the unplanned engine
  }
}
