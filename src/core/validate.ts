import type { Mode, Motif, MotifSource, Note, Part, PartInstrument, SynthPreset } from '../types'
import { beatsPerBar, isInScale, MODES } from './theory'
import { newId } from './ids'

export const EPS = 1e-6

const VALID_INSTRUMENTS = new Set<PartInstrument>([
  'synth',
  'piano',
  'epiano',
  'marimba',
  'strings',
  'drums',
])
const VALID_OSCILLATORS = new Set(['sine', 'triangle', 'sawtooth', 'square'])
export const MAX_PARTS = 4

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

function parseNote(raw: unknown, partCount: number): Note | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const pitch = asNumber(o.pitch)
  const startBeat = asNumber(o.startBeat)
  const durationBeats = asNumber(o.durationBeats)
  const velocity = asNumber(o.velocity) ?? 96
  if (pitch === null || startBeat === null || durationBeats === null) return null
  const rawPart = asNumber(o.part)
  const note: Note = {
    pitch: Math.round(pitch),
    startBeat,
    durationBeats,
    velocity: Math.min(127, Math.max(1, Math.round(velocity))),
  }
  if (rawPart !== null && partCount > 0) {
    note.part = Math.min(partCount - 1, Math.max(0, Math.round(rawPart)))
  }
  return note
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function parsePreset(raw: unknown): SynthPreset | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const o = raw as Record<string, unknown>
  const osc = typeof o.oscillator === 'string' && VALID_OSCILLATORS.has(o.oscillator)
    ? (o.oscillator as SynthPreset['oscillator'])
    : 'triangle'
  const env = (typeof o.envelope === 'object' && o.envelope !== null ? o.envelope : {}) as Record<
    string,
    unknown
  >
  return {
    oscillator: osc,
    envelope: {
      attack: clamp(asNumber(env.attack) ?? 0.005, 0.001, 2),
      decay: clamp(asNumber(env.decay) ?? 0.15, 0.01, 2),
      sustain: clamp(asNumber(env.sustain) ?? 0.35, 0, 1),
      release: clamp(asNumber(env.release) ?? 0.25, 0.01, 3),
    },
  }
}

/** Lenient part parsing: bad instruments fall back to 'synth', never drop. */
function parseParts(raw: unknown): Part[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_PARTS).map((p, i) => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>
    const instrument =
      typeof o.instrument === 'string' && VALID_INSTRUMENTS.has(o.instrument as PartInstrument)
        ? (o.instrument as PartInstrument)
        : 'synth'
    const part: Part = {
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `part ${i + 1}`,
      instrument,
    }
    if (instrument === 'synth' && o.preset !== undefined) {
      part.preset = parsePreset(o.preset)
    }
    return part
  })
}

/**
 * Validate one raw motif object against the generation context.
 * Returns an error string on failure, or the normalized Motif.
 */
function validateOne(raw: unknown, ctx: ValidationContext, index: number): Motif | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const o = raw as Record<string, unknown>

  const parts = parseParts(o.parts)

  const rawNotes = o.notes
  if (!Array.isArray(rawNotes)) return 'missing notes array'
  const notes: Note[] = []
  for (const rn of rawNotes) {
    const n = parseNote(rn, parts.length)
    if (n === null) return 'malformed note'
    notes.push(n)
  }
  if (notes.length < 3) return `only ${notes.length} notes (min 3)`

  const bars = asNumber(o.bars) ?? ctx.bars
  const timeSig = typeof o.timeSig === 'string' ? o.timeSig : ctx.timeSig
  const totalBeats = bars * beatsPerBar(timeSig)

  const isDrumNote = (n: Note) =>
    parts.length > 0 && parts[Math.min(n.part ?? 0, parts.length - 1)].instrument === 'drums'

  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  for (const n of notes) {
    const minPitch = isDrumNote(n) ? 35 : 36 // GM acoustic kick sits at 35
    if (n.pitch < minPitch || n.pitch > 96) return `pitch ${n.pitch} out of range`
    if (n.startBeat < -EPS) return 'negative startBeat'
    if (n.durationBeats <= EPS) return 'non-positive duration'
    if (n.startBeat + n.durationBeats > totalBeats + EPS)
      return `note ends at ${n.startBeat + n.durationBeats} beyond ${totalBeats} beats`
  }
  // Polyphony is allowed; cap simultaneous voices to keep motifs playable.
  const MAX_VOICES = 8
  const edges = notes
    .flatMap((n) => [
      { t: n.startBeat, d: 1 },
      { t: n.startBeat + n.durationBeats, d: -1 },
    ])
    .sort((a, b) => a.t - b.t || a.d - b.d) // note-off before note-on at equal times
  let voices = 0
  for (const e of edges) {
    voices += e.d
    if (voices > MAX_VOICES) return `more than ${MAX_VOICES} simultaneous voices`
  }

  const key = typeof o.key === 'string' ? o.key : ctx.key
  const modeRaw = typeof o.mode === 'string' ? (o.mode.toLowerCase() as Mode) : ctx.mode
  const mode: Mode = MODES.includes(modeRaw) ? modeRaw : ctx.mode
  const tempoRaw = asNumber(o.tempo)
  const tempo = tempoRaw !== null ? Math.min(220, Math.max(40, Math.round(tempoRaw))) : ctx.tempo

  // Drum-part notes are unpitched — exempt from the scale check.
  const scaleWarning = notes.some((n) => !isDrumNote(n) && !isInScale(n.pitch, key, mode))

  return {
    id: newId(),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Motif ${index + 1}`,
    notes,
    parts,
    key,
    mode,
    bars,
    timeSig,
    tempo,
    conceptId: ctx.conceptId ?? null,
    rating: 0,
    discarded: false,
    scaleWarning,
    rationale: typeof o.rationale === 'string' ? o.rationale : undefined,
    createdAt: Date.now(),
    source: ctx.source(index),
  }
}

/**
 * Mutation-bay PART LOCK check: every locked part's notes must round-trip
 * from parent to child unchanged (same count; identical pitch/velocity/part,
 * timing within EPS). Children that fail are dropped by the caller.
 */
export function lockedPartsRoundTrip(parent: Motif, child: Motif, lockedParts: number[]): boolean {
  const key = (n: Note) => `${n.part ?? 0}`
  const sortNotes = (ns: Note[]) =>
    [...ns].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  for (const p of lockedParts) {
    const pn = sortNotes(parent.notes.filter((n) => Number(key(n)) === p))
    const cn = sortNotes(child.notes.filter((n) => Number(key(n)) === p))
    if (pn.length !== cn.length) return false
    for (let i = 0; i < pn.length; i++) {
      const a = pn[i]
      const b = cn[i]
      if (
        a.pitch !== b.pitch ||
        a.velocity !== b.velocity ||
        Math.abs(a.startBeat - b.startBeat) > EPS ||
        Math.abs(a.durationBeats - b.durationBeats) > EPS
      ) {
        return false
      }
    }
  }
  return true
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
