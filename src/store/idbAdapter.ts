import type { Concept, Motif } from '../types'
import { parentIdOf } from '../types'
import type { PersistenceAdapter } from './persistence'

const DB_NAME = 'motif-forge'
const DB_VERSION = 1

type StoredMotif = Motif & { parentId: string | null }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

class IdbAdapter implements PersistenceAdapter {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION)
      open.onupgradeneeded = () => {
        const db = open.result
        const motifs = db.createObjectStore('motifs', { keyPath: 'id' })
        motifs.createIndex('conceptId', 'conceptId')
        motifs.createIndex('parentId', 'parentId')
        motifs.createIndex('rating', 'rating')
        motifs.createIndex('createdAt', 'createdAt')
        const concepts = db.createObjectStore('concepts', { keyPath: 'id' })
        concepts.createIndex('name', 'name')
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
  }

  private store(name: string, mode: IDBTransactionMode): { s: IDBObjectStore; tx: IDBTransaction } {
    if (!this.db) throw new Error('idbAdapter not initialized')
    const tx = this.db.transaction(name, mode)
    return { s: tx.objectStore(name), tx }
  }

  async loadAll(): Promise<{ motifs: Motif[]; concepts: Concept[] }> {
    const motifs = await req(this.store('motifs', 'readonly').s.getAll() as IDBRequest<StoredMotif[]>)
    const concepts = await req(this.store('concepts', 'readonly').s.getAll() as IDBRequest<Concept[]>)
    return {
      // Normalize records written before the polyphony/parts migration.
      motifs: motifs.map(({ parentId: _parentId, ...m }) => ({ ...m, parts: m.parts ?? [] }) as Motif),
      concepts,
    }
  }

  async putMotif(m: Motif): Promise<void> {
    const { s, tx } = this.store('motifs', 'readwrite')
    s.put({ ...m, parentId: parentIdOf(m) } satisfies StoredMotif)
    await txDone(tx)
  }

  async putMotifs(ms: Motif[]): Promise<void> {
    const { s, tx } = this.store('motifs', 'readwrite')
    for (const m of ms) s.put({ ...m, parentId: parentIdOf(m) } satisfies StoredMotif)
    await txDone(tx)
  }

  async putConcept(c: Concept): Promise<void> {
    const { s, tx } = this.store('concepts', 'readwrite')
    s.put(c)
    await txDone(tx)
  }
}

export const idbAdapter: PersistenceAdapter = new IdbAdapter()
