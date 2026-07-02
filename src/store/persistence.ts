import type { Concept, Motif } from '../types'

export interface PersistenceAdapter {
  init(): Promise<void>
  loadAll(): Promise<{ motifs: Motif[]; concepts: Concept[] }>
  putMotif(m: Motif): Promise<void>
  putMotifs(ms: Motif[]): Promise<void>
  putConcept(c: Concept): Promise<void>
  deleteConcept(id: string): Promise<void>
}
