import { useMemo, useState } from 'react'
import type { Motif } from '../types'
import { parentIdOf } from '../types'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { MotifCard } from './MotifCard'

/** All motifs attached to a concept plus their descendants, as lineage groups. */
export function ConceptView() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const concepts = [...state.concepts.values()].sort((a, b) => a.createdAt - b.createdAt)
  const [conceptId, setConceptId] = useState<string | null>(concepts[0]?.id ?? null)

  const groups = useMemo(() => {
    if (!conceptId) return []
    const all = [...state.motifs.values()].filter((m) => !m.discarded)
    const byParent = new Map<string, Motif[]>()
    for (const m of all) {
      const pid = parentIdOf(m)
      if (pid) {
        const list = byParent.get(pid) ?? []
        list.push(m)
        byParent.set(pid, list)
      }
    }
    // Roots: tagged motifs whose parent is not itself tagged to this concept
    // (so a mutated child of a tagged motif nests under it, not beside it).
    const tagged = all.filter((m) => m.conceptId === conceptId)
    const taggedIds = new Set(tagged.map((m) => m.id))
    const roots = tagged.filter((m) => {
      const pid = parentIdOf(m)
      return !pid || !taggedIds.has(pid)
    })

    const collectDescendants = (m: Motif): Motif[] => {
      const kids = (byParent.get(m.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)
      return kids.flatMap((k) => [k, ...collectDescendants(k)])
    }
    return roots
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((root) => ({ root, descendants: collectDescendants(root) }))
  }, [state.motifs, conceptId])

  if (concepts.length === 0) {
    return (
      <div className="empty">
        No concepts yet — name one in the generation panel or create one in the Library.
      </div>
    )
  }

  return (
    <div className="concept-view">
      <div className="filter-row">
        {concepts.map((c) => (
          <button
            key={c.id}
            className={`btn chip${conceptId === c.id ? ' active' : ''}`}
            onClick={() => setConceptId(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="empty">No motifs tagged to this concept yet.</div>
      ) : (
        groups.map(({ root, descendants }) => (
          <div key={root.id} className="concept-group">
            <div className="concept-group-head">
              <MotifCard motif={root} selected={root.id === state.selectedId} />
              <button
                className="btn"
                onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: root.id })}
              >
                transform for new track →
              </button>
            </div>
            {descendants.length > 0 && (
              <div className="motif-grid indented">
                {descendants.map((d) => (
                  <MotifCard key={d.id} motif={d} selected={d.id === state.selectedId} />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
