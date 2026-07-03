import type { Mode, Motif, Note } from '../types'
import { beatsPerBar, isInScale, pitchToDegree, degreeToPitch } from './theory'
import { newId } from './ids'

export type Transform =
  | { type: 'inversion' }
  | { type: 'retrograde' }
  | { type: 'retrogradeInversion' }
  | { type: 'transpose'; semitones: number }
  | { type: 'augment' }
  | { type: 'diminish' }
  | { type: 'modeSwap'; targetMode: Mode }
  | { type: 'octaveDisplace'; noteIndices: number[]; direction: 1 | -1 }

export function describeTransform(t: Transform): string {
  switch (t.type) {
    case 'inversion':
      return 'inversion'
    case 'retrograde':
      return 'retrograde'
    case 'retrogradeInversion':
      return 'retrograde-inversion'
    case 'transpose':
      return `transpose ${t.semitones >= 0 ? '+' : ''}${t.semitones}`
    case 'augment':
      return 'augmentation ×2'
    case 'diminish':
      return 'diminution ×0.5'
    case 'modeSwap':
      return `mode swap → ${t.targetMode}`
    case 'octaveDisplace':
      return `octave ${t.direction > 0 ? 'up' : 'down'} (${t.noteIndices.length} notes)`
  }
}

const clampPitch = (p: number) => Math.min(96, Math.max(36, p))

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

function invert(notes: Note[]): Note[] {
  if (notes.length === 0) return notes
  const axis = notes[0].pitch
  return notes.map((n) => ({ ...n, pitch: clampPitch(2 * axis - n.pitch) }))
}

function retrograde(notes: Note[], totalBeats: number): Note[] {
  return sortNotes(
    notes.map((n) => ({
      ...n,
      startBeat: totalBeats - (n.startBeat + n.durationBeats),
    })),
  )
}

export interface TransformOptions {
  /** Only notes of these part indices are transformed; the rest pass through
   * verbatim (mutation-bay LOCK). Omitted = transform every part. */
  parts?: Set<number>
}

export function applyTransform(parent: Motif, t: Transform, opts: TransformOptions = {}): Motif {
  const total = parent.bars * beatsPerBar(parent.timeSig)
  const inScope = (n: Note) => opts.parts === undefined || opts.parts.has(n.part ?? 0)
  // Transform only the in-scope notes, then merge the untouched ones back.
  const scoped = parent.notes.filter(inScope).map((n) => ({ ...n }))
  const passthrough = parent.notes.filter((n) => !inScope(n)).map((n) => ({ ...n }))
  let notes = scoped
  let bars = parent.bars
  let mode = parent.mode

  switch (t.type) {
    case 'inversion':
      notes = invert(notes)
      break
    case 'retrograde':
      notes = retrograde(notes, total)
      break
    case 'retrogradeInversion':
      notes = retrograde(invert(notes), total)
      break
    case 'transpose':
      notes = notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + t.semitones) }))
      break
    case 'augment':
      notes = notes.map((n) => ({
        ...n,
        startBeat: n.startBeat * 2,
        durationBeats: n.durationBeats * 2,
      }))
      bars = parent.bars * 2
      break
    case 'diminish':
      notes = notes.map((n) => ({
        ...n,
        startBeat: n.startBeat / 2,
        durationBeats: n.durationBeats / 2,
      }))
      bars = Math.max(1, parent.bars / 2)
      break
    case 'modeSwap':
      notes = notes.map((n) => {
        const pos = pitchToDegree(n.pitch, parent.key, parent.mode)
        return { ...n, pitch: clampPitch(degreeToPitch(pos, parent.key, t.targetMode)) }
      })
      mode = t.targetMode
      break
    case 'octaveDisplace': {
      // Indices refer to the FULL note list, so displace before scoping applies.
      const set = new Set(t.noteIndices)
      notes = parent.notes.map((n, i) =>
        set.has(i) ? { ...n, pitch: clampPitch(n.pitch + 12 * t.direction) } : { ...n },
      )
      passthrough.length = 0
      break
    }
  }

  notes = sortNotes([...notes, ...passthrough])
  const scaleWarning = notes.some((n) => !isInScale(n.pitch, parent.key, mode))

  return {
    ...parent,
    id: newId(),
    name: `${parent.name} (${describeTransform(t)})`,
    notes,
    bars,
    mode,
    rating: 0,
    discarded: false,
    scaleWarning,
    rationale: undefined,
    createdAt: Date.now(),
    source: { kind: 'transform', parentId: parent.id, transform: describeTransform(t) },
  }
}
