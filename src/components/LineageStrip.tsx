import type { Motif } from '../types'
import { parentIdOf } from '../types'
import { useAppDispatch, useAppState } from '../store/AppContext'

function sourceLabel(m: Motif): string {
  switch (m.source.kind) {
    case 'seed':
      return 'seed'
    case 'generated':
      return 'generated'
    case 'transform':
      return m.source.transform
    case 'llm-mutation':
      return `LLM: "${m.source.brief.slice(0, 60)}${m.source.brief.length > 60 ? '…' : ''}"`
  }
}

/** Ancestor chain (root → motif) plus direct children of the motif. */
export function LineageStrip({ motif }: { motif: Motif }) {
  const { motifs } = useAppState()
  const dispatch = useAppDispatch()

  const chain: Motif[] = [motif]
  let cursor = motif
  for (let guard = 0; guard < 50; guard++) {
    const pid = parentIdOf(cursor)
    if (!pid) break
    const parent = motifs.get(pid)
    if (!parent) break
    chain.unshift(parent)
    cursor = parent
  }

  const children = [...motifs.values()]
    .filter((m) => parentIdOf(m) === motif.id)
    .sort((a, b) => a.createdAt - b.createdAt)

  return (
    <div className="lineage">
      <div className="lineage-chain">
        {chain.map((m, i) => (
          <span key={m.id} className="lineage-node">
            {i > 0 && <span className="lineage-arrow"> → </span>}
            <button
              className={`btn link${m.id === motif.id ? ' current' : ''}`}
              onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: m.id })}
              title={sourceLabel(m)}
            >
              {m.name}
            </button>
          </span>
        ))}
      </div>
      {children.length > 0 && (
        <div className="lineage-children">
          <span className="dim">{children.length} descendant{children.length > 1 ? 's' : ''}:</span>
          {children.map((c) => (
            <button
              key={c.id}
              className="btn link"
              onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: c.id })}
              title={sourceLabel(c)}
            >
              {sourceLabel(c)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
