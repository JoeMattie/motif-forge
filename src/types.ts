export interface Note {
  pitch: number // MIDI number, 36-96
  startBeat: number
  durationBeats: number
  velocity: number // 1-127
  part?: number // index into Motif.parts; absent = part 0
}

export type Sound = 'synth' | 'piano' | 'epiano' | 'marimba' | 'strings'

/** What a part can play: any pickable sound, or a GM-pitch drum kit. */
export type PartInstrument = Sound | 'drums'

/** LLM-designed patch for the Tone.js synth (instrument: 'synth' only). */
export interface SynthPreset {
  oscillator: 'sine' | 'triangle' | 'sawtooth' | 'square'
  envelope: { attack: number; decay: number; sustain: number; release: number }
}

/** One voice/layer of a polyphonic motif with its own instrument. */
export interface Part {
  name: string
  instrument: PartInstrument
  preset?: SynthPreset
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
  /** variedParts: indices of the parts the LLM was armed to rewrite (locked parts round-trip verbatim). */
  | { kind: 'llm-mutation'; parentId: string; brief: string; variedParts?: number[] }
  /** Promoted from the mutation bay: per-part selected variations mixed into one take.
   * variedParts: indices of the parts whose selection deviates from the parent. */
  | { kind: 'bay-mix'; parentId: string; variedParts: number[] }
  /** Tier-1 offline generation: fresh constrained-random-walk motif (no parents).
   * recipe = "contour/rhythm" descriptor; seed reproduces the exact motif. */
  | { kind: 'symbolic'; batchId: string; seed: number; recipe: string }
  /** Tier-1 genetic child of user-kept motifs: 1 parentId = mutant, 2 = crossover.
   * Children start their own family (they're fresh triage candidates); ancestry
   * stays queryable via parentIds. */
  | { kind: 'ga'; batchId: string; seed: number; op: string; parentIds: string[] }
  /** Tier-2 offline generation: on-device neural model (SkyTNT midi-model).
   * parentId set when the candidate continued a keeper (neural variation);
   * like 'ga', children start their own family. */
  | { kind: 'neural'; batchId: string; seed: number; parentId?: string }

export type Rating = 0 | 1 | 2 | 3 | 4 | 5

export type Texture = 'lead' | 'poly'

export interface Motif {
  id: string
  name: string
  notes: Note[] // sorted by startBeat; overlapping notes allowed (polyphonic)
  parts: Part[] // instrument per part; empty = single part played with the transport sound
  key: string // "D", "Bb", "F#"
  mode: Mode
  bars: number
  timeSig: string // "4/4"
  tempo: number // BPM
  conceptId: string | null
  rating: Rating
  discarded: boolean
  /** Exactly one motif per family may be promoted — it becomes the family's face
   * (grid card, playback, exports). No flag anywhere = the root is the face. */
  promoted?: boolean
  /** Track assignment in the Concepts / leitmotif desk (e.g. "01"). */
  trackId?: string | null
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
  texture: Texture // lead melody with light harmony vs free polyphony
  includeRhythm: boolean // ask for a GM-pitch drums part
  /** EXTRA toggle: demand a fuller arrangement — 4–6 parts with distinct roles. */
  extraInstruments: boolean
}

export function parentIdOf(m: Motif): string | null {
  const s = m.source
  return s.kind === 'transform' || s.kind === 'llm-mutation' || s.kind === 'bay-mix'
    ? s.parentId
    : null
}

/** How a mutation-bay tree node was produced. */
export type PartVariationProvenance =
  | { kind: 'llm'; brief: string }
  | { kind: 'transform'; transform: string }

/**
 * One node in a per-part mutation tree in the bay: an alternative take on a
 * single part of `sourceMotifId`. Trees persist; PRUNE hard-deletes nodes
 * (unlike motifs, which are only ever soft-discarded).
 */
export interface PartVariation {
  id: string
  /** The motif whose bay workspace owns this tree (the SET_MUTATION_TARGET motif). */
  sourceMotifId: string
  partIndex: number // 0 for partless motifs
  parentNodeId: string | null // null = direct child of the original part
  notes: Note[] // this part's notes only (note.part preserved = partIndex)
  provenance: PartVariationProvenance
  /** ≤1 selected node per (sourceMotifId, partIndex); none = the original part plays. */
  selected: boolean
  hidden: boolean // REBASE sets, SHOW HIDDEN clears, PRUNE deletes
  createdAt: number
}
