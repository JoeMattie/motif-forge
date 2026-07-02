import { useEffect } from 'react'
import { useAppDispatch, useAppState } from './store/AppContext'
import { SAMPLE_MOTIFS } from './core/sampleMotifs'
import { TransportBar } from './components/TransportBar'
import { TriageGrid } from './components/TriageGrid'
import { LibraryView } from './components/LibraryView'
import { ConceptView } from './components/ConceptView'
import { MutationPanel } from './components/MutationPanel'

export function App() {
  const state = useAppState()
  const dispatch = useAppDispatch()

  // Seed the dev fixtures on first run (empty library).
  useEffect(() => {
    if (state.hydrated && state.motifs.size === 0) {
      dispatch({
        type: 'MOTIFS_ADDED',
        motifs: SAMPLE_MOTIFS.map((m) => ({ ...m, createdAt: Date.now() })),
      })
    }
  }, [state.hydrated]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!state.hydrated) {
    return <div className="loading">loading library…</div>
  }

  const mutationTarget = state.mutationTargetId
    ? state.motifs.get(state.mutationTargetId)
    : undefined

  return (
    <div className="app">
      <TransportBar />
      <main className={mutationTarget ? 'with-panel' : ''}>
        <div className="view">
          {state.view === 'triage' && <TriageGrid />}
          {state.view === 'library' && <LibraryView />}
          {state.view === 'concepts' && <ConceptView />}
        </div>
        {mutationTarget && <MutationPanel key={mutationTarget.id} motif={mutationTarget} />}
      </main>
    </div>
  )
}
