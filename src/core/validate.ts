import type { Mode, Motif, MotifSource, Note } from '../types'
import { beatsPerBar, isInScale, MODES } from './theory'
import { newId } from './ids'

export const EPS = 1e-6

export interface ValidationContext {
  key: string
  mode: Mode
  bars: number
  timeSig: string
  tempo: number
  allowChromatic: boolean
  source: (index: number) => MotifSource
  conceptId?: string | null
}

export interface ValidationResult {
  valid: Motif[]
  droppedCount: number
  scaleWarningCount: number
  errors: string[]
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseNote(raw: unknown): Note | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const pitch = asNumber(o.pitch)
  const startBeat = asNumber(o.startBeat)
  const durationBeats = asNumber(o.durationBeats)
  const velocity = asNumber(o.velocity) ?? 96
  if (pitch === null || startBeat === null || durationBeats === null) return null
  return {
    pitch: Math.round(pitch),
    startBeat,
    durationBeats,
    velocity: Math.min(127, Math.max(1, Math.round(velocity))),
  }
}

/**
 * Validate one raw motif object against the generation context.
 * Returns an error string on failure, or the normalized Motif.
 */
function validateOne(raw: unknown, ctx: ValidationContext, index: number): Motif | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const o = raw as Record<string, unknown>

  const rawNotes = o.notes
  if (!Array.isArray(rawNotes)) return 'missing notes array'
  const notes: Note[] = []
  for (const rn of rawNotes) {
    const n = parseNote(rn)
    if (n === null) return 'malformed note'
    notes.push(n)
  }
  if (notes.length < 3) return `only ${notes.length} notes (min 3)`

  const bars = asNumber(o.bars) ?? ctx.bars
  const timeSig = typeof o.timeSig === 'string' ? o.timeSig : ctx.timeSig
  const totalBeats = bars * beatsPerBar(timeSig)

  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  for (const n of notes) {
    if (n.pitch < 36 || n.pitch > 96) return `pitch ${n.pitch} out of range 36-96`
    if (n.startBeat < -EPS) return 'negative startBeat'
    if (n.durationBeats <= EPS) return 'non-positive duration'
    if (n.startBeat + n.durationBeats > totalBeats + EPS)
      return `note ends at ${n.startBeat + n.durationBeats} beyond ${totalBeats} beats`
  }
  for (let i = 0; i < notes.length - 1; i++) {
    if (notes[i].startBeat + notes[i].durationBeats > notes[i + 1].startBeat + EPS)
      return 'overlapping notes (must be monophonic)'
  }

  const key = typeof o.key === 'string' ? o.key : ctx.key
  const modeRaw = typeof o.mode === 'string' ? (o.mode.toLowerCase() as Mode) : ctx.mode
  const mode: Mode = MODES.includes(modeRaw) ? modeRaw : ctx.mode

  const scaleWarning = notes.some((n) => !isInScale(n.pitch, key, mode))

  return {
    id: newId(),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Motif ${index + 1}`,
    notes,
    key,
    mode,
    bars,
    timeSig,
    tempo: ctx.tempo,
    conceptId: ctx.conceptId ?? null,
    rating: 0,
    discarded: false,
    scaleWarning,
    rationale: typeof o.rationale === 'string' ? o.rationale : undefined,
    createdAt: Date.now(),
    source: ctx.source(index),
  }
}

export function validateBatch(raw: unknown, ctx: ValidationContext): ValidationResult {
  const result: ValidationResult = { valid: [], droppedCount: 0, scaleWarningCount: 0, errors: [] }
  const list =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).motifs)
      ? ((raw as Record<string, unknown>).motifs as unknown[])
      : Array.isArray(raw)
        ? raw
        : null
  if (list === null) {
    result.errors.push('response is not a motif batch')
    return result
  }
  list.forEach((item, i) => {
    const v = validateOne(item, ctx, i)
    if (typeof v === 'string') {
      result.droppedCount++
      result.errors.push(`motif ${i + 1}: ${v}`)
    } else {
      if (v.scaleWarning) result.scaleWarningCount++
      result.valid.push(v)
    }
  })
  return result
}
