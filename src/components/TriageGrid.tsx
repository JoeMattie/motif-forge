import { useMemo, useState } from 'react'
import { useAppState } from '../store/AppContext'
import { useGridColumns } from './hooks/useGridColumns'
import { useKeyboardTriage } from './hooks/useKeyboardTriage'
import { GenerationPanel } from './GenerationPanel'
import { MotifCard } from './MotifCard'

type Filter = 'unrated' | 'rated' | 'discarded' | 'all'

export function TriageGrid() {
  const state = useAppState()
  const [filter, setFilter] = useState<Filter>('all')
  const { gridRef, columns } = useGridColumns()

  const visible = useMemo(() => {
    const all = [...state.motifs.values()].sort((a, b) => a.createdAt - b.createdAt)
    switch (filter) {
      case 'unrated':
        return all.filter((m) => !m.discarded && m.rating === 0)
      case 'rated':
        return all.filter((m) => !m.discarded && m.rating > 0)
      case 'discarded':
        return all.filter((m) => m.discarded)
      case 'all':
        return all.filter((m) => !m.discarded)
    }
  }, [state.motifs, filter])

  useKeyboardTriage(visible, columns, state.mutationTargetId === null)

  const counts = useMemo(() => {
    const all = [...state.motifs.values()]
    return {
      unrated: all.filter((m) => !m.discarded && m.rating === 0).length,
      rated: all.filter((m) => !m.discarded && m.rating > 0).length,
      discarded: all.filter((m) => m.discarded).length,
      all: all.filter((m) => !m.discarded).length,
    }
  }, [state.motifs])

  return (
    <div className="triage">
      <GenerationPanel />
      <div className="filter-row">
        {(['all', 'unrated', 'rated', 'discarded'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`btn chip${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
            title={
              {
                all: 'Everything except discards',
                unrated: 'Still to triage — no rating yet',
                rated: 'Rated 1–5 stars',
                discarded: 'Soft-deleted with x — press u to undo the most recent discard',
              }[f]
            }
          >
            {f} ({counts[f]})
          </button>
        ))}
        <span className="hint">
          ←→↑↓ navigate · space play · 1–5 rate · x discard · u undo
        </span>
      </div>
      {visible.length === 0 && state.pending.length === 0 ? (
        <div className="empty">
          {state.motifs.size === 0
            ? 'No motifs yet — write a brief above and generate a batch.'
            : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div className="motif-grid" ref={gridRef}>
          {visible.map((m) => (
            <MotifCard key={m.id} motif={m} selected={m.id === state.selectedId} />
          ))}
          {state.pending.map((b) => (
            <div key={b.id} className="motif-card pending-card">
              <span className="pending-label">
                generating {b.count} · {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
