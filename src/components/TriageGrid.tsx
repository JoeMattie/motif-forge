import { useCallback, useMemo, useState } from 'react'
import { Button, Kbd, Mark, Tooltip } from '@mantine/core'
import type { Motif } from '../types'
import { buildFamilies, rootIdOf } from '../core/families'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { useGridColumns } from './hooks/useGridColumns'
import { useKeyboardTriage } from './hooks/useKeyboardTriage'
import { GenerationPanel } from './GenerationPanel'
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
  const dispatch = useAppDispatch()
  const [filter, setFilter] = useState<Filter>('all')
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

  const toggleFold = useCallback(
    (m: Motif) => {
      const rid = rootIdOf(m, state.motifs)
      dispatch({ type: 'SET_EXPANDED_FAMILY', id: state.expandedFamilyId === rid ? null : rid })
    },
    [dispatch, state.motifs, state.expandedFamilyId],
  )
  const openBay = useCallback(
    (m: Motif) => dispatch({ type: 'SET_MUTATION_TARGET', id: m.id }),
    [dispatch],
  )
  const promote = useCallback(
    (m: Motif) => {
      const fam = families.find((f) => f.rootId === rootIdOf(m, state.motifs))
      if (fam) {
        dispatch({ type: 'MOTIF_PROMOTED', id: m.id, familyIds: fam.members.map((x) => x.id) })
      }
    },
    [families, state.motifs, dispatch],
  )

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

  const counts = useMemo(
    () => ({
      all: families.filter((f) => !f.root.discarded).length,
      unrated: families.filter((f) => !f.root.discarded && f.face.rating === 0).length,
      rated: families.filter((f) => !f.root.discarded && f.face.rating > 0).length,
      discarded: families.filter((f) => f.root.discarded).length,
    }),
    [families],
  )

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
        onToggleExpand={() => toggleFold(f.face)}
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
      <GenerationPanel />
      <div className="filter-row">
        {(['all', 'unrated', 'rated', 'discarded'] as Filter[]).map((f) => (
          <Tooltip key={f} label={FILTER_HINTS[f]}>
            <Button data-latched={filter === f} onClick={() => setFilter(f)}>
              <span>
                {f} {counts[f]}
              </span>
            </Button>
          </Tooltip>
        ))}
        <Tooltip label="Mutating never adds cards to the grid — variants land inside each family's fold-out tray">
          <span className="note-chip">Counts = families · variants stay inside</span>
        </Tooltip>
        <span className="spacer" />
        <span className="kbd-legend">
          <Kbd>← → ↑ ↓</Kbd> nav · <Kbd>space</Kbd> play · <Kbd>1–5</Kbd> rate ·{' '}
          <Kbd>x</Kbd> discard · <Mark className="hk">u</Mark>ndo ·{' '}
          <Mark className="hk">f</Mark>old out · <Mark className="hk">p</Mark>romote ·{' '}
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
