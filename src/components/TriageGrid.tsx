import { useCallback, useMemo, useState } from 'react'
import { Button, Kbd, Mark, Tooltip } from '@mantine/core'
import type { Motif } from '../types'
import { engine } from '../audio/engine'
import { buildFamilies, rootIdOf } from '../core/families'
import { useAppDispatch, useAppState, useAppStateGetter } from '../store/AppContext'
import { useGridColumns } from './hooks/useGridColumns'
import { useKeyboardTriage } from './hooks/useKeyboardTriage'
import { MotifCard } from './MotifCard'
import { FamilyTray } from './FamilyTray'

type Filter = 'all' | 'unrated' | 'rated' | 'discarded'

const FILTER_HINTS: Record<Filter, string> = {
  all: 'Every family except discards',
  unrated: 'Families still to triage — face not rated yet',
  rated: 'Families whose face is rated 1–5',
  discarded: 'Families discarded with x — press u to undo the most recent',
}

export function TriageGrid() {
  const state = useAppState()
  const getState = useAppStateGetter()
  const dispatch = useAppDispatch()
  const [filter, setFilter] = useState<Filter>('all')
  const [purgeArmed, setPurgeArmed] = useState(false)
  const { gridRef, columns } = useGridColumns()

  const families = useMemo(() => buildFamilies(state.motifs), [state.motifs])

  const visible = useMemo(() => {
    switch (filter) {
      case 'unrated':
        return families.filter((f) => !f.root.discarded && f.face.rating === 0)
      case 'rated':
        return families.filter((f) => !f.root.discarded && f.face.rating > 0)
      case 'discarded':
        return families.filter((f) => f.root.discarded)
      case 'all':
        return families.filter((f) => !f.root.discarded)
    }
  }, [families, filter])

  const faces = useMemo(() => visible.map((f) => f.face), [visible])

  // Built on the state getter so they're referentially stable — memoized
  // cards receive the same callback across selection moves and fold toggles.
  const toggleFold = useCallback(
    (m: Motif): string | null => {
      const { motifs, expandedFamilyId } = getState()
      const rid = rootIdOf(m, motifs)
      if (expandedFamilyId === rid) {
        dispatch({ type: 'SET_EXPANDED_FAMILY', id: null })
        return null
      }
      dispatch({ type: 'SET_EXPANDED_FAMILY', id: rid })
      // Report the root of a freshly opened walkable tray: the keyboard path
      // moves the cursor onto it (F enters the panel), while mouse opens
      // (card/chip click) leave the selection on the card that was clicked.
      const fam = buildFamilies(motifs).find((f) => f.rootId === rid)
      return fam && fam.variants.length > 0 ? rid : null
    },
    [dispatch, getState],
  )
  const openBay = useCallback(
    (m: Motif) => dispatch({ type: 'SET_MUTATION_TARGET', id: m.id }),
    [dispatch],
  )
  const promote = useCallback(
    (m: Motif) => {
      const { motifs } = getState()
      const fam = buildFamilies(motifs).find((f) => f.rootId === rootIdOf(m, motifs))
      if (fam) {
        // Toggle: USE on the already-used take clears the flag family-wide,
        // so the face falls back to the root.
        const inUse = fam.face.id === m.id && !!motifs.get(m.id)?.promoted
        dispatch({
          type: 'MOTIF_PROMOTED',
          id: inUse ? '' : m.id,
          familyIds: fam.members.map((x) => x.id),
        })
      }
    },
    [dispatch, getState],
  )

  // Hard-delete every discarded family (all members ride along — an orphaned
  // variant would otherwise resurface as its own root) plus their bay trees.
  const purgeDiscarded = useCallback(() => {
    const { motifs, partVariations } = getState()
    const motifIds = buildFamilies(motifs)
      .filter((f) => f.root.discarded)
      .flatMap((f) => f.members.map((m) => m.id))
    if (motifIds.length === 0) return
    const gone = new Set(motifIds)
    const playing = engine.getSnapshot().playingMotifId
    if (playing && gone.has(playing.split('::')[0])) engine.stop()
    const variationIds = [...partVariations.values()]
      .filter((v) => gone.has(v.sourceMotifId))
      .map((v) => v.id)
    dispatch({ type: 'DISCARDED_PURGED', motifIds, variationIds })
    setPurgeArmed(false)
  }, [dispatch, getState])

  const expandedFamily = useMemo(
    () => families.find((f) => f.rootId === state.expandedFamilyId),
    [families, state.expandedFamilyId],
  )

  useKeyboardTriage(faces, columns, state.mutationTargetId === null, {
    onFold: toggleFold,
    onMutate: openBay,
    onPromote: promote,
    tray: expandedFamily
      ? { anchorId: expandedFamily.face.id, motifs: expandedFamily.members }
      : undefined,
  })

  const counts = useMemo(() => {
    const c = { all: 0, unrated: 0, rated: 0, discarded: 0 }
    for (const f of families) {
      if (f.root.discarded) c.discarded++
      else {
        c.all++
        if (f.face.rating > 0) c.rated++
        else c.unrated++
      }
    }
    return c
  }, [families])

  // The fold-out tray spans the full grid width directly under the expanded
  // card's row — insert it after the last card of that row.
  const expandedIdx = visible.findIndex((f) => f.rootId === state.expandedFamilyId)
  const trayAfter =
    expandedIdx < 0 ? -1 : Math.min(visible.length, (Math.floor(expandedIdx / columns) + 1) * columns)

  const cells: React.ReactNode[] = []
  visible.forEach((f, i) => {
    cells.push(
      <MotifCard
        key={f.rootId}
        family={f}
        selected={f.face.id === state.selectedId}
        expanded={f.rootId === state.expandedFamilyId}
        onToggleExpand={toggleFold}
      />,
    )
    if (i + 1 === trayAfter) {
      cells.push(
        <FamilyTray
          key={`tray-${state.expandedFamilyId}`}
          family={visible[expandedIdx]}
          onFold={() => dispatch({ type: 'SET_EXPANDED_FAMILY', id: null })}
        />,
      )
    }
  })

  return (
    <>
      <div className="filter-row">
        {(['all', 'unrated', 'rated', 'discarded'] as Filter[]).map((f) => (
          <Tooltip key={f} label={FILTER_HINTS[f]}>
            <Button
              data-latched={filter === f}
              onClick={() => {
                setFilter(f)
                setPurgeArmed(false)
              }}
            >
              <span>
                {f} {counts[f]}
              </span>
            </Button>
          </Tooltip>
        ))}
        {filter === 'discarded' && counts.discarded > 0 && (
          <Tooltip label="Permanently delete every discarded family — motifs, variants, and their bay takes — from the library database. Cannot be undone">
            <Button
              className="danger-text"
              data-danger={purgeArmed}
              onClick={() => (purgeArmed ? purgeDiscarded() : setPurgeArmed(true))}
            >
              {purgeArmed
                ? `Clear ${counts.discarded} ${counts.discarded === 1 ? 'family' : 'families'} — sure?`
                : 'Clear from disk'}
            </Button>
          </Tooltip>
        )}
        <Tooltip label="Mutating never adds cards to the grid — variants land inside each family's fold-out tray">
          <span className="note-chip">Counts = families · variants stay inside</span>
        </Tooltip>
        <span className="spacer" />
        <span className="kbd-legend">
          <Kbd>← → ↑ ↓</Kbd> nav · <Kbd>space</Kbd> play · <Kbd>1–5</Kbd> rate ·{' '}
          <Kbd>x</Kbd> discard · <Mark className="hk">u</Mark>ndo ·{' '}
          <Mark className="hk">f</Mark>old out · <Kbd>↵</Kbd> use ·{' '}
          <Mark className="hk">m</Mark>utate
        </span>
      </div>
      {visible.length === 0 && state.pending.length === 0 ? (
        <div className="empty-note">
          {state.motifs.size === 0
            ? 'No motifs yet — expand GENERATE above, write a brief, and queue a batch.'
            : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div className="motif-grid triage-grid" ref={gridRef}>
          {cells}
          {state.pending.map((b) => (
            <div key={b.id} className="pending-card">
              <span className="pending-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="pending-label">
                Generating {b.count} · {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
