/**
 * Validation for Claude-planned InstantSpecs (the M6(GPT)3 "LLM as planner"
 * bridge): raw model JSON in, a clamped/whitelisted spec out — or null when
 * nothing usable was found, in which case the INSTANT engine runs exactly as
 * it would have without a planner. Pure and framework-free.
 */
import type { InstantSpec } from '../../types'
import { CONTOURS, RHYTHMS } from './walk'

const DENSITIES = ['sparse', 'medium', 'busy'] as const
const REGISTERS = ['low', 'mid', 'high'] as const

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Whitelist a weight map's keys and clamp weights to (0, 10]; null if nothing survives. */
function cleanWeights(
  raw: unknown,
  allowed: readonly string[],
): Partial<Record<string, number>> | null {
  if (!isRecord(raw)) return null
  const out: Partial<Record<string, number>> = {}
  let any = false
  for (const key of allowed) {
    const w = raw[key]
    if (finite(w) && w > 0) {
      out[key] = clamp(w, 0, 10)
      any = true
    }
  }
  return any ? out : null
}

/**
 * Parse a planner response into an InstantSpec: clamp valence/arousal,
 * whitelist contour/rhythm weight keys against the walk's own tables,
 * validate density/register enums, clamp progression degrees to integers 0–6
 * and cycle them to one per bar. Unknown fields are dropped; `chromaticism`
 * is parsed but ignored in v1 (the walk is diatonic by design). Returns null
 * when the payload is garbage or contributes nothing.
 */
export function parseInstantPlan(raw: unknown, bars: number): InstantSpec | null {
  if (!isRecord(raw)) return null
  const spec: InstantSpec = {}

  if (finite(raw.valence)) spec.valence = clamp(raw.valence, -1, 1)
  if (finite(raw.arousal)) spec.arousal = clamp(raw.arousal, 0, 1)

  const contourWeights = cleanWeights(raw.contourWeights, CONTOURS)
  if (contourWeights) spec.contourWeights = contourWeights
  const rhythmWeights = cleanWeights(raw.rhythmWeights, RHYTHMS)
  if (rhythmWeights) spec.rhythmWeights = rhythmWeights

  if (typeof raw.density === 'string' && (DENSITIES as readonly string[]).includes(raw.density)) {
    spec.density = raw.density as InstantSpec['density']
  }
  if (typeof raw.register === 'string' && (REGISTERS as readonly string[]).includes(raw.register)) {
    spec.register = raw.register as InstantSpec['register']
  }

  if (Array.isArray(raw.progression)) {
    const degrees = raw.progression
      .filter(finite)
      .map((d) => clamp(Math.round(d), 0, 6))
    if (degrees.length > 0) {
      const cycled: number[] = []
      for (let i = 0; i < bars; i++) cycled.push(degrees[i % degrees.length])
      spec.progression = cycled
    }
  }

  return Object.keys(spec).length > 0 ? spec : null
}
