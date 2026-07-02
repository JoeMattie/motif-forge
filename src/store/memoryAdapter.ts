import type { PersistenceAdapter } from './persistence'

/** No-op adapter: state lives only in React. Used for dev/tests. */
export const memoryAdapter: PersistenceAdapter = {
  async init() {},
  async loadAll() {
    return { motifs: [], concepts: [] }
  },
  async putMotif() {},
  async putMotifs() {},
  async putConcept() {},
  async deleteConcept() {},
}
