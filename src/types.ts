export interface Note {
  pitch: number // MIDI number, 36-96
  startBeat: number
  durationBeats: number
  velocity: number // 1-127
}

export type Mode =
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian'

export type MotifSource =
  | { kind: 'seed' }
  | { kind: 'generated'; brief: string; batchId: string }
  | { kind: 'transform'; parentId: string; transform: string }
  | { kind: 'llm-mutation'; parentId: string; brief: string }

export type Rating = 0 | 1 | 2 | 3 | 4 | 5

export interface Motif {
  id: string
  name: string
  notes: Note[] // sorted by startBeat; monophonic
  key: string // "D", "Bb", "F#"
  mode: Mode
  bars: number
  timeSig: string // "4/4"
  tempo: number // BPM
  conceptId: string | null
  rating: Rating
  discarded: boolean
  scaleWarning: boolean
  rationale?: string
  createdAt: number
  source: MotifSource
}

export interface Concept {
  id: string
  name: string
  createdAt: number
}

export interface GenerationBrief {
  key: string
  mode: Mode
  tempo: number
  bars: number
  timeSig: string
  concept: string
  text: string // free-text: contour, rhythmic character, emotional intent
  allowChromatic: boolean
}

export function parentIdOf(m: Motif): string | null {
  const s = m.source
  return s.kind === 'transform' || s.kind === 'llm-mutation' ? s.parentId : null
}
