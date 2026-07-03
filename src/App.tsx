import { useEffect } from 'react'
import { Center, Group, Loader, Text } from '@mantine/core'
import { useAppDispatch, useAppState } from './store/AppContext'
import { SAMPLE_MOTIFS } from './core/sampleMotifs'
import { Header } from './components/Header'
import { TransportStrip } from './components/TransportStrip'
import { TriageGrid } from './components/TriageGrid'
import { FocusTriage } from './components/FocusTriage'
import { LibraryView } from './components/LibraryView'
import { ConceptView } from './components/ConceptView'
import { MutationBay } from './components/MutationBay'

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
    return (
      <Center h="100vh">
        <Group gap="xs">
          <Loader size="sm" />
          <Text c="dimmed">loading library…</Text>
        </Group>
      </Center>
    )
  }

  const baySource = state.mutationTargetId ? state.motifs.get(state.mutationTargetId) : undefined

  return (
    <div className="app">
      <Header />
      <main>
        <div className="view">
          {baySource ? (
            <MutationBay key={baySource.id} source={baySource} />
          ) : state.view === 'triage' ? (
            state.triageMode === 'grid' ? (
              <TriageGrid />
            ) : (
              <FocusTriage />
            )
          ) : state.view === 'library' ? (
            <LibraryView />
          ) : (
            <ConceptView />
          )}
        </div>
      </main>
      <TransportStrip />
    </div>
  )
}
