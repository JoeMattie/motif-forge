import type { Concept, Motif, Rating } from '../types'

export type View = 'triage' | 'library' | 'concepts'

export interface TransportState {
  tempoMode: 'motif' | number // follow the motif's tempo, or a fixed BPM
  metronome: boolean
  drone: boolean
}

export interface GenerationStatus {
  busy: boolean
  message: string | null // last result / error toast
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
  lastDiscardedId: string | null
}

export const initialState: AppState = {
  hydrated: false,
  motifs: new Map(),
  concepts: new Map(),
  selectedId: null,
  mutationTargetId: null,
  view: 'triage',
  transport: { tempoMode: 'motif', metronome: false, drone: false },
  generation: { busy: false, message: null },
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
  | { type: 'GENERATION_STARTED' }
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
    case 'GENERATION_STARTED':
      return { ...state, generation: { busy: true, message: null } }
    case 'GENERATION_FINISHED':
      return { ...state, generation: { busy: false, message: action.message } }
    case 'GENERATION_FAILED':
      return { ...state, generation: { busy: false, message: action.message } }
    case 'CLEAR_MESSAGE':
      return { ...state, generation: { ...state.generation, message: null } }
  }
}

/** Effective playback tempo for a motif under the current transport. */
export function effectiveTempo(transport: TransportState, motif: Motif): number {
  return transport.tempoMode === 'motif' ? motif.tempo : transport.tempoMode
}
