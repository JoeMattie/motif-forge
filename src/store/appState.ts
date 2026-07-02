import type { Concept, Motif, Rating, Sound } from '../types'

export type View = 'triage' | 'library' | 'concepts'

export interface TransportState {
  tempoMode: 'motif' | number // follow the motif's tempo, or a fixed BPM
  metronome: boolean
  drone: boolean
  sound: Sound
  forceSound: boolean // ignore motif parts; play everything through `sound`
}

export interface GenerationStatus {
  message: string | null // last result / error toast
}

/** A queued LLM batch awaiting results — rendered as a pulsing placeholder card. */
export interface PendingBatch {
  id: string
  count: number
  label: string
}

export interface AppState {
  hydrated: boolean
  motifs: Map<string, Motif>
  concepts: Map<string, Concept>
  selectedId: string | null
  mutationTargetId: string | null // motif open in the mutation panel
  view: View
  transport: TransportState
  generation: GenerationStatus
  pending: PendingBatch[]
  lastDiscardedId: string | null
}

export const initialState: AppState = {
  hydrated: false,
  motifs: new Map(),
  concepts: new Map(),
  selectedId: null,
  mutationTargetId: null,
  view: 'triage',
  transport: {
    tempoMode: 'motif',
    metronome: false,
    drone: false,
    sound: 'synth',
    forceSound: false,
  },
  generation: { message: null },
  pending: [],
  lastDiscardedId: null,
}

export type Action =
  | { type: 'HYDRATED'; motifs: Motif[]; concepts: Concept[] }
  | { type: 'MOTIFS_ADDED'; motifs: Motif[] }
  | { type: 'MOTIF_RATED'; id: string; rating: Rating }
  | { type: 'MOTIF_DISCARDED'; id: string }
  | { type: 'MOTIF_RESTORED'; id: string }
  | { type: 'MOTIF_ASSIGNED_CONCEPT'; id: string; conceptId: string | null }
  | { type: 'CONCEPT_CREATED'; concept: Concept }
  | { type: 'SELECT'; id: string | null }
  | { type: 'SET_MUTATION_TARGET'; id: string | null }
  | { type: 'SET_VIEW'; view: View }
  | { type: 'SET_TRANSPORT'; transport: Partial<TransportState> }
  | { type: 'BATCH_QUEUED'; batch: PendingBatch }
  | { type: 'BATCH_FINISHED'; id: string }
  | { type: 'GENERATION_FINISHED'; message: string }
  | { type: 'GENERATION_FAILED'; message: string }
  | { type: 'CLEAR_MESSAGE' }

function withMotif(state: AppState, id: string, patch: Partial<Motif>): AppState {
  const m = state.motifs.get(id)
  if (!m) return state
  const motifs = new Map(state.motifs)
  motifs.set(id, { ...m, ...patch })
  return { ...state, motifs }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATED': {
      const motifs = new Map(state.motifs)
      for (const m of action.motifs) motifs.set(m.id, m)
      const concepts = new Map(state.concepts)
      for (const c of action.concepts) concepts.set(c.id, c)
      return { ...state, hydrated: true, motifs, concepts }
    }
    case 'MOTIFS_ADDED': {
      const motifs = new Map(state.motifs)
      for (const m of action.motifs) motifs.set(m.id, m)
      const selectedId = state.selectedId ?? action.motifs[0]?.id ?? null
      return { ...state, motifs, selectedId }
    }
    case 'MOTIF_RATED':
      return withMotif(state, action.id, { rating: action.rating })
    case 'MOTIF_DISCARDED':
      return { ...withMotif(state, action.id, { discarded: true }), lastDiscardedId: action.id }
    case 'MOTIF_RESTORED':
      return {
        ...withMotif(state, action.id, { discarded: false }),
        lastDiscardedId: state.lastDiscardedId === action.id ? null : state.lastDiscardedId,
      }
    case 'MOTIF_ASSIGNED_CONCEPT':
      return withMotif(state, action.id, { conceptId: action.conceptId })
    case 'CONCEPT_CREATED': {
      const concepts = new Map(state.concepts)
      concepts.set(action.concept.id, action.concept)
      return { ...state, concepts }
    }
    case 'SELECT':
      return { ...state, selectedId: action.id }
    case 'SET_MUTATION_TARGET':
      return { ...state, mutationTargetId: action.id }
    case 'SET_VIEW':
      return { ...state, view: action.view, mutationTargetId: null }
    case 'SET_TRANSPORT':
      return { ...state, transport: { ...state.transport, ...action.transport } }
    case 'BATCH_QUEUED':
      return { ...state, pending: [...state.pending, action.batch] }
    case 'BATCH_FINISHED':
      return { ...state, pending: state.pending.filter((b) => b.id !== action.id) }
    case 'GENERATION_FINISHED':
      return { ...state, generation: { message: action.message } }
    case 'GENERATION_FAILED':
      return { ...state, generation: { message: action.message } }
    case 'CLEAR_MESSAGE':
      return { ...state, generation: { message: null } }
  }
}

/** Effective playback tempo for a motif under the current transport. */
export function effectiveTempo(transport: TransportState, motif: Motif): number {
  return transport.tempoMode === 'motif' ? motif.tempo : transport.tempoMode
}
