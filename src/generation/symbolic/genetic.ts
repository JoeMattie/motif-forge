/**
 * Tier-1 genetic operators: evolve new candidates from the motifs the user
 * kept during triage. Crossover splices two keepers at a bar boundary;
 * mutations make small, always-in-scale edits to one keeper's melodic line.
 * All pitch moves happen in scale-degree space so children stay in-key.
 */
import type { Mode, Motif, Note, Part } from '../../types'
import { beatsPerBar, degreeToPitch, pitchToDegree } from '../../core/theory'
import { EPS } from '../../core/validate'
import { pick, pickWeighted, randInt, type Rng } from './prng'

/** Population mix for a GA batch; fresh immigrants keep diversity. */
export const GA_RATIOS = { crossover: 0.3, mutant: 0.4, fresh: 0.3 } as const

/** Minimum share of fresh random-walk immigrants in any GA batch. */
export const GA_DIVERSITY_FLOOR = 0.2

/** A motif counts as "kept" (GA parent material) from this rating up. */
export const KEEPER_MIN_RATING = 3

export function keepersOf(motifs: Iterable<Motif>): Motif[] {
  const kept: Motif[] = []
  for (const m of motifs) {
    if (!m.discarded && m.rating >= KEEPER_MIN_RATING) kept.push(m)
  }
  return kept
}

const clampPitch = (p: number) => Math.min(96, Math.max(36, p))

const sortNotes = (notes: Note[]) =>
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)

/**
 * The structural slice of a Motif the genetic operators need — evolution
 * individuals satisfy it without carrying full Motif records.
 */
export interface LineMaterial extends MutationContext {
  parts: Part[]
  notes: Note[]
}

/**
 * The keeper's primary melodic material as a partless line: the first part
 * that is neither drums nor a 'chords' bed when parts exist, all notes
 * otherwise. A CHORDS-mode keeper (only a chords part) reduces to its top
 * voice per onset so keeper crossover / fitness never see vertical stacks.
 * GA children are partless melodic bones (monophonic-first; polyphony
 * passes through).
 */
export function melodicLine(m: LineMaterial): Note[] {
  let picked: Note[]
  let chordsOnly = false
  if (m.parts.length === 0) {
    picked = m.notes
  } else {
    let leadIndex = m.parts.findIndex((p) => p.instrument !== 'drums' && p.name !== 'chords')
    if (leadIndex === -1) {
      leadIndex = m.parts.findIndex((p) => p.instrument !== 'drums')
      chordsOnly = true
    }
    picked = m.notes.filter((n) => (n.part ?? 0) === leadIndex)
    if (picked.length < 3) {
      const drumParts = new Set(m.parts.flatMap((p, i) => (p.instrument === 'drums' ? [i] : [])))
      picked = m.notes.filter((n) => !drumParts.has(n.part ?? 0))
    }
  }
  let line = picked.map(({ part: _part, ...n }) => ({ ...n }))
  if (chordsOnly) {
    const topByOnset = new Map<number, Note>()
    for (const n of line) {
      const top = topByOnset.get(n.startBeat)
      if (!top || n.pitch > top.pitch) topByOnset.set(n.startBeat, n)
    }
    line = [...topByOnset.values()]
  }
  return sortNotes(line)
}

/** Degree-index space (octave * 7 + degree): moving here is always in-scale. */
function toIdx(pitch: number, key: string, mode: Mode): number {
  const pos = pitchToDegree(pitch, key, mode) // chromatic offset dropped = snap to scale
  return pos.octave * 7 + pos.degree
}

function fromIdx(idx: number, key: string, mode: Mode): number {
  return clampPitch(
    degreeToPitch(
      { degree: ((idx % 7) + 7) % 7, octave: Math.floor(idx / 7), chromaticOffset: 0 },
      key,
      mode,
    ),
  )
}

/** Re-spell a pitch from one key/mode into another, degree-for-degree. */
function mapPitch(pitch: number, from: LineMaterial, to: LineMaterial): number {
  const pos = pitchToDegree(pitch, from.key, from.mode)
  return clampPitch(
    degreeToPitch({ ...pos, chromaticOffset: 0 }, to.key, to.mode),
  )
}

export interface CrossoverResult {
  notes: Note[]
  cutBar: number
}

/**
 * Splice `a`'s opening bars with `b`'s material after a bar-boundary cut.
 * The child lives in `a`'s key/mode/length; `b`'s notes are re-spelled
 * degree-for-degree into it. Returns null when the splice is too thin.
 */
export function crossover(a: LineMaterial, b: LineMaterial, rng: Rng): CrossoverResult | null {
  if (a.bars < 2) return null
  const bpb = beatsPerBar(a.timeSig)
  const totalBeats = a.bars * bpb
  const cutBar = randInt(rng, 1, a.bars - 1)
  const cut = cutBar * bpb

  const head = melodicLine(a)
    .filter((n) => n.startBeat < cut - EPS)
    .map((n) => ({ ...n, durationBeats: Math.min(n.durationBeats, cut - n.startBeat) }))

  // Pull the tail from a window of b that fills the remaining beats, starting
  // at one of b's own bar boundaries so its material stays metrically intact.
  const need = totalBeats - cut
  const bTotal = b.bars * beatsPerBar(b.timeSig)
  const maxSrcBar = Math.floor((bTotal - need) / beatsPerBar(b.timeSig))
  const srcStart = maxSrcBar > 0 ? randInt(rng, 0, maxSrcBar) * beatsPerBar(b.timeSig) : 0
  const shift = cut - srcStart
  const tail = melodicLine(b)
    .filter((n) => n.startBeat >= srcStart - EPS && n.startBeat + shift < totalBeats - EPS)
    .map((n) => ({
      ...n,
      pitch: mapPitch(n.pitch, b, a),
      startBeat: n.startBeat + shift,
      durationBeats: Math.min(n.durationBeats, totalBeats - (n.startBeat + shift)),
    }))

  const notes = sortNotes([...head, ...tail])
  return notes.length >= 3 && tail.length > 0 && head.length > 0 ? { notes, cutBar } : null
}

export interface MutationResult {
  notes: Note[]
  ops: string[]
}

type MutationOp =
  | 'transpose-note'
  | 'swap-adjacent'
  | 'invert-interval'
  | 'alter-rhythm-cell'
  | 'transpose-all'
  | 'retrograde-bar'

const OP_WEIGHTS: readonly (readonly [MutationOp, number])[] = [
  ['transpose-note', 24],
  ['swap-adjacent', 18],
  ['invert-interval', 16],
  ['alter-rhythm-cell', 18],
  ['transpose-all', 12],
  ['retrograde-bar', 12],
]

/** Drum takes only get ops with no scale-degree math — degree-space moves
 * would remap GM percussion pitches onto the key's scale. */
const DRUM_OP_WEIGHTS: readonly (readonly [MutationOp, number])[] = [
  ['swap-adjacent', 18],
  ['alter-rhythm-cell', 18],
  ['retrograde-bar', 12],
]

/** The key/mode/length context mutation ops need — a Motif satisfies it. */
export interface MutationContext {
  key: string
  mode: Mode
  bars: number
  timeSig: string
}

function applyOp(op: MutationOp, notes: Note[], ctx: MutationContext, rng: Rng): Note[] {
  const { key, mode } = ctx
  const bpb = beatsPerBar(ctx.timeSig)
  const totalBeats = ctx.bars * bpb
  const out = notes.map((n) => ({ ...n }))
  switch (op) {
    case 'transpose-note': {
      const i = randInt(rng, 0, out.length - 1)
      const step = pick(rng, [-2, -1, 1, 2])
      out[i].pitch = fromIdx(toIdx(out[i].pitch, key, mode) + step, key, mode)
      break
    }
    case 'swap-adjacent': {
      if (out.length < 2) break
      const i = randInt(rng, 0, out.length - 2)
      const tmp = out[i].pitch
      out[i].pitch = out[i + 1].pitch
      out[i + 1].pitch = tmp
      break
    }
    case 'invert-interval': {
      if (out.length < 2) break
      const i = randInt(rng, 1, out.length - 1)
      const prev = toIdx(out[i - 1].pitch, key, mode)
      const cur = toIdx(out[i].pitch, key, mode)
      out[i].pitch = fromIdx(2 * prev - cur, key, mode)
      break
    }
    case 'alter-rhythm-cell': {
      const i = randInt(rng, 0, out.length - 1)
      const n = out[i]
      if (rng() < 0.5) {
        const shifted = n.startBeat + pick(rng, [-0.25, 0.25])
        n.startBeat = Math.min(Math.max(0, shifted), totalBeats - n.durationBeats)
      } else {
        const scaled = n.durationBeats * pick(rng, [0.5, 2])
        n.durationBeats = Math.min(Math.max(0.25, scaled), totalBeats - n.startBeat)
      }
      break
    }
    case 'transpose-all': {
      const step = pick(rng, [-3, -2, -1, 1, 2, 3])
      for (const n of out) n.pitch = fromIdx(toIdx(n.pitch, key, mode) + step, key, mode)
      break
    }
    case 'retrograde-bar': {
      const bar = randInt(rng, 0, ctx.bars - 1)
      const barStart = bar * bpb
      const barEnd = barStart + bpb
      for (const n of out) {
        if (n.startBeat >= barStart - EPS && n.startBeat + n.durationBeats <= barEnd + EPS) {
          n.startBeat = barStart + (barEnd - (n.startBeat + n.durationBeats))
        }
      }
      break
    }
  }
  return sortNotes(out)
}

/**
 * One (sometimes two) small in-scale edits to an arbitrary note list — the
 * shared core behind full-motif GA mutants and the bay's per-part MUTATE.
 * `drums` restricts to rhythm-only ops (drum pitches aren't scale material).
 */
export function mutateNotes(
  input: Note[],
  ctx: MutationContext,
  rng: Rng,
  opts: { drums?: boolean } = {},
): MutationResult {
  if (input.length === 0) return { notes: [], ops: [] }
  const weights = opts.drums ? DRUM_OP_WEIGHTS : OP_WEIGHTS
  const ops: string[] = []
  let notes = sortNotes(input.map((n) => ({ ...n })))
  const rounds = rng() < 0.4 ? 2 : 1
  for (let r = 0; r < rounds; r++) {
    const op = pickWeighted(rng, weights)
    notes = applyOp(op, notes, ctx, rng)
    ops.push(op)
  }
  return { notes, ops }
}

/** One (sometimes two) small in-scale edits to a keeper's melodic line. */
export function mutateLine(parent: LineMaterial, rng: Rng): MutationResult {
  return mutateNotes(melodicLine(parent), parent, rng)
}
