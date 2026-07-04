import { useEffect } from 'react'
import { Center, Drawer, Group, Loader, Text } from '@mantine/core'
import { engine } from './audio/engine'
import { useAppDispatch, useAppState } from './store/AppContext'
import { SAMPLE_MOTIFS } from './core/sampleMotifs'
import { GenerationPanel } from './components/GenerationPanel'
import { NoodlePanel } from './components/NoodlePanel'
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once when hydration lands on an empty library; motifs.size must not re-trigger it
  useEffect(() => {
    if (state.hydrated && state.motifs.size === 0) {
      dispatch({
        type: 'MOTIFS_ADDED',
        motifs: SAMPLE_MOTIFS.map((m) => ({ ...m, createdAt: Date.now() })),
      })
    }
  }, [state.hydrated])

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

  const closeBay = () => {
    engine.stop()
    dispatch({ type: 'SET_MUTATION_TARGET', id: null })
  }

  return (
    <div className="app">
      <Header />
      <main>
        <div className="view">
          {/* Mounted once for the app's lifetime (hidden outside triage) so the
              brief, knob settings, and run progress survive Grid↔Focus toggles
              and view switches. display:contents keeps the panel a layout child
              of the .view scroller, which its sticky dock depends on. */}
          <div style={{ display: state.view === 'triage' ? 'contents' : 'none' }}>
            <GenerationPanel />
            <NoodlePanel />
          </div>
          {state.view === 'triage' ? (
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
      <Drawer
        opened={baySource !== undefined}
        onClose={closeBay}
        position="bottom"
        size="94%"
        // The bay owns Escape (blur field → close advanced panel → close bay)
        // and drives everything from a window keydown, not roving focus.
        closeOnEscape={false}
        trapFocus={false}
      >
        {baySource && <MutationBay key={baySource.id} source={baySource} />}
      </Drawer>
    </div>
  )
}
