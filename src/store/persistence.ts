import type { Concept, Motif, PartVariation } from '../types'

export interface PersistenceAdapter {
  init(): Promise<void>
  loadAll(): Promise<{ motifs: Motif[]; concepts: Concept[]; partVariations: PartVariation[] }>
  putMotif(m: Motif): Promise<void>
  putMotifs(ms: Motif[]): Promise<void>
  /** Hard-delete motifs — the purge path for cleared discards; everything else soft-discards. */
  deleteMotifs(ids: string[]): Promise<void>
  putConcept(c: Concept): Promise<void>
  deleteConcept(id: string): Promise<void>
  putPartVariations(vs: PartVariation[]): Promise<void>
  deletePartVariations(ids: string[]): Promise<void>
  /** Wipe the backing store entirely (recovery path when the DB can't load). */
  destroy(): Promise<void>
}
