import type { Concept, Motif, PartVariation } from '../types'
import { parentIdOf } from '../types'
import type { PersistenceAdapter } from './persistence'

const DB_NAME = 'motif-forge'
const DB_VERSION = 2 // v2: partVariations store (mutation-bay trees)

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
      let rejectedAsBlocked = false
      // Another tab still holds the DB open at an older version, so the
      // upgrade can't run. Without this handler the request never settles
      // and the app hangs on "loading library…" forever.
      open.onblocked = () => {
        rejectedAsBlocked = true
        reject(
          new Error(
            'The library database is locked by another Motif Forge tab or window ' +
              '(it needs a version upgrade this tab is waiting on).',
          ),
        )
      }
      open.onupgradeneeded = () => {
        // Runs for fresh installs AND version upgrades — every creation must
        // be guarded or an existing v1 database would throw here.
        const db = open.result
        if (!db.objectStoreNames.contains('motifs')) {
          const motifs = db.createObjectStore('motifs', { keyPath: 'id' })
          motifs.createIndex('conceptId', 'conceptId')
          motifs.createIndex('parentId', 'parentId')
          motifs.createIndex('rating', 'rating')
          motifs.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains('concepts')) {
          const concepts = db.createObjectStore('concepts', { keyPath: 'id' })
          concepts.createIndex('name', 'name')
        }
        if (!db.objectStoreNames.contains('partVariations')) {
          const vs = db.createObjectStore('partVariations', { keyPath: 'id' })
          vs.createIndex('sourceMotifId', 'sourceMotifId')
        }
      }
      open.onsuccess = () => {
        const db = open.result
        // If another tab bumps the version later, release our connection so
        // WE are never the tab that blocks its upgrade.
        db.onversionchange = () => db.close()
        if (rejectedAsBlocked) {
          // The blocking tab closed after we already gave up — don't hold a
          // connection nobody owns.
          db.close()
          return
        }
        resolve(db)
      }
      open.onerror = () => reject(open.error)
    })
  }

  private store(name: string, mode: IDBTransactionMode): { s: IDBObjectStore; tx: IDBTransaction } {
    if (!this.db) throw new Error('idbAdapter not initialized')
    const tx = this.db.transaction(name, mode)
    return { s: tx.objectStore(name), tx }
  }

  async loadAll(): Promise<{ motifs: Motif[]; concepts: Concept[]; partVariations: PartVariation[] }> {
    const motifs = await req(this.store('motifs', 'readonly').s.getAll() as IDBRequest<StoredMotif[]>)
    const concepts = await req(this.store('concepts', 'readonly').s.getAll() as IDBRequest<Concept[]>)
    const partVariations = await req(
      this.store('partVariations', 'readonly').s.getAll() as IDBRequest<PartVariation[]>,
    )
    return {
      // Normalize records written before the polyphony/parts migration.
      motifs: motifs.map(({ parentId: _parentId, ...m }) => ({ ...m, parts: m.parts ?? [] }) as Motif),
      concepts,
      partVariations,
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

  async deleteConcept(id: string): Promise<void> {
    const { s, tx } = this.store('concepts', 'readwrite')
    s.delete(id)
    await txDone(tx)
  }

  async putPartVariations(vs: PartVariation[]): Promise<void> {
    const { s, tx } = this.store('partVariations', 'readwrite')
    for (const v of vs) s.put(v)
    await txDone(tx)
  }

  async deletePartVariations(ids: string[]): Promise<void> {
    const { s, tx } = this.store('partVariations', 'readwrite')
    for (const id of ids) s.delete(id)
    await txDone(tx)
  }

  async destroy(): Promise<void> {
    this.db?.close()
    this.db = null
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(DB_NAME)
      del.onsuccess = () => resolve()
      del.onerror = () => reject(del.error)
      // Deletion is queued behind other open tabs; treat that as done.
      del.onblocked = () => resolve()
    })
  }
}

export const idbAdapter: PersistenceAdapter = new IdbAdapter()
