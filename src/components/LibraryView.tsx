import { useMemo, useState } from 'react'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { MotifCard } from './MotifCard'

export function LibraryView() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [minRating, setMinRating] = useState(3)
  const [newConcept, setNewConcept] = useState('')

  const kept = useMemo(
    () =>
      [...state.motifs.values()]
        .filter((m) => !m.discarded && m.rating >= minRating)
        .sort((a, b) => b.rating - a.rating || a.createdAt - b.createdAt),
    [state.motifs, minRating],
  )

  const createConcept = () => {
    const name = newConcept.trim()
    if (!name) return
    dispatch({
      type: 'CONCEPT_CREATED',
      concept: { id: newId(), name, createdAt: Date.now() },
    })
    setNewConcept('')
  }

  return (
    <div className="library">
      <div className="filter-row">
        <label className="transport-control">
          min rating
          <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {'★'.repeat(r)}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <input
          type="text"
          placeholder="new concept name"
          value={newConcept}
          onChange={(e) => setNewConcept(e.target.value)}
        />
        <button className="btn" onClick={createConcept} disabled={!newConcept.trim()}>
          + concept
        </button>
      </div>
      {kept.length === 0 ? (
        <div className="empty">No motifs rated {'★'.repeat(minRating)} or higher yet.</div>
      ) : (
        <div className="motif-grid">
          {kept.map((m) => (
            <div key={m.id} className="library-item">
              <MotifCard motif={m} selected={m.id === state.selectedId} showConcept />
              <select
                className="concept-select"
                value={m.conceptId ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'MOTIF_ASSIGNED_CONCEPT',
                    id: m.id,
                    conceptId: e.target.value || null,
                  })
                }
              >
                <option value="">no concept</option>
                {[...state.concepts.values()].map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
