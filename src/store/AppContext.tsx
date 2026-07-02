import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { initialState, reducer, type Action, type AppState } from './appState'
import type { PersistenceAdapter } from './persistence'

const StateContext = createContext<AppState>(initialState)
const DispatchContext = createContext<Dispatch<Action>>(() => {})

export function AppProvider({
  adapter,
  children,
}: {
  adapter: PersistenceAdapter
  children: ReactNode
}) {
  const [state, rawDispatch] = useReducer(reducer, initialState)

  // Write-through persistence: pattern-match persistent actions and mirror
  // them to the adapter fire-and-forget. Keeps the reducer pure.
  const dispatch = useMemo<Dispatch<Action>>(() => {
    const persist = (p: Promise<void>) =>
      p.catch((e) => console.error('persistence write failed', e))
    return (action: Action) => {
      rawDispatch(action)
      switch (action.type) {
        case 'MOTIFS_ADDED':
          persist(adapter.putMotifs(action.motifs))
          break
        case 'CONCEPT_CREATED':
          persist(adapter.putConcept(action.concept))
          break
        default:
          break
      }
    }
  }, [adapter])

  // Motif field updates (rating/discard/concept) need the post-reducer motif;
  // mirror them from state changes via a queue keyed on the action.
  const dispatchWithMotifWrites = useMemo<Dispatch<Action>>(() => {
    return (action: Action) => {
      dispatch(action)
      if (
        action.type === 'MOTIF_RATED' ||
        action.type === 'MOTIF_DISCARDED' ||
        action.type === 'MOTIF_RESTORED' ||
        action.type === 'MOTIF_ASSIGNED_CONCEPT'
      ) {
        pendingMotifWrites.add(action.id)
      }
    }
  }, [dispatch])

  // Flush pending motif writes whenever state reflects them.
  useEffect(() => {
    if (pendingMotifWrites.size === 0) return
    const toWrite = [...pendingMotifWrites]
      .map((id) => state.motifs.get(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined)
    pendingMotifWrites.clear()
    if (toWrite.length > 0) {
      adapter.putMotifs(toWrite).catch((e) => console.error('persistence write failed', e))
    }
  }, [state.motifs, adapter])

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await adapter.init()
        const { motifs, concepts } = await adapter.loadAll()
        if (!cancelled) rawDispatch({ type: 'HYDRATED', motifs, concepts })
      } catch (e) {
        console.error('hydration failed', e)
        if (!cancelled) rawDispatch({ type: 'HYDRATED', motifs: [], concepts: [] })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter])

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatchWithMotifWrites}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  )
}

const pendingMotifWrites = new Set<string>()

export function useAppState(): AppState {
  return useContext(StateContext)
}

export function useAppDispatch(): Dispatch<Action> {
  return useContext(DispatchContext)
}
