import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react'
import { Button, Center, Stack, Text } from '@mantine/core'
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
        case 'CONCEPT_DELETED':
          persist(adapter.deleteConcept(action.id))
          break
        case 'PART_VARIATIONS_UPSERT':
          persist(adapter.putPartVariations(action.variations))
          break
        case 'PART_VARIATIONS_DELETED':
          persist(adapter.deletePartVariations(action.ids))
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
        action.type === 'MOTIF_ASSIGNED_CONCEPT' ||
        action.type === 'MOTIF_ASSIGNED_TRACK'
      ) {
        pendingMotifWrites.add(action.id)
      }
      if (action.type === 'MOTIF_PROMOTED' || action.type === 'FAMILY_ASSIGNED_CONCEPT') {
        for (const fid of action.familyIds) pendingMotifWrites.add(fid)
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

  // Hydrate once on mount (and again on RETRY). A blocked/corrupt IndexedDB
  // can stall without ever erroring, so the whole load races a timeout and
  // failure lands on a recovery screen instead of an eternal spinner.
  const [hydrationError, setHydrationError] = useState<string | null>(null)
  const [hydrationAttempt, setHydrationAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrationAttempt is the RETRY trigger — the "unnecessary" dep deliberately re-runs the load
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await withTimeout(adapter.init(), 'opening the library database')
        const { motifs, concepts, partVariations } = await withTimeout(
          adapter.loadAll(),
          'reading the library',
        )
        if (!cancelled) rawDispatch({ type: 'HYDRATED', motifs, concepts, partVariations })
      } catch (e) {
        console.error('hydration failed', e)
        if (!cancelled) setHydrationError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, hydrationAttempt])

  const clearDatabase = useCallback(async () => {
    try {
      await withTimeout(adapter.destroy(), 'clearing the database')
      location.reload()
    } catch (e) {
      setHydrationError(e instanceof Error ? e.message : String(e))
    }
  }, [adapter])

  if (hydrationError && !state.hydrated) {
    return (
      <HydrationRecovery
        message={hydrationError}
        onRetry={() => {
          setHydrationError(null)
          setHydrationAttempt((n) => n + 1)
        }}
        onContinue={() =>
          rawDispatch({ type: 'HYDRATED', motifs: [], concepts: [], partVariations: [] })
        }
        onClear={clearDatabase}
      />
    )
  }

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatchWithMotifWrites}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  )
}

const HYDRATION_TIMEOUT_MS = 5000

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out ${what}. The database may be locked by another tab.`)),
      HYDRATION_TIMEOUT_MS,
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

function HydrationRecovery({
  message,
  onRetry,
  onContinue,
  onClear,
}: {
  message: string
  onRetry: () => void
  onContinue: () => void
  onClear: () => void
}) {
  return (
    <Center h="100vh">
      <Stack gap="sm" maw={440} align="center" ta="center">
        <Text fw={700}>LIBRARY FAILED TO LOAD</Text>
        <Text c="dimmed" size="sm">
          {message}
        </Text>
        <Text c="dimmed" size="sm">
          If Motif Forge is open in another tab or window, close it first, then retry.
        </Text>
        <Button onClick={onRetry}>RETRY</Button>
        <Button variant="default" onClick={onContinue}>
          CONTINUE WITHOUT SAVING
        </Button>
        <Button
          color="red"
          variant="outline"
          onClick={() => {
            if (
              window.confirm(
                'Delete the entire library database? All motifs, ratings, and concepts will be lost.',
              )
            )
              onClear()
          }}
        >
          CLEAR DATABASE
        </Button>
      </Stack>
    </Center>
  )
}

const pendingMotifWrites = new Set<string>()

export function useAppState(): AppState {
  return useContext(StateContext)
}

export function useAppDispatch(): Dispatch<Action> {
  return useContext(DispatchContext)
}
