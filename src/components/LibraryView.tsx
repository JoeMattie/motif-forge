import { useMemo, useState } from 'react'
import { Button, Menu, Select, TextInput, Tooltip } from '@mantine/core'
import { CaretDownIcon, PlusIcon, StarIcon } from '@phosphor-icons/react'
import type { Family } from '../core/families'
import { buildFamilies } from '../core/families'
import { effectiveTempo } from '../store/appState'
import { motifToMidi, midiFilename } from '../core/midi'
import { audioBufferToWavBlob } from '../core/wav'
import { downloadBlob } from '../core/downloads'
import { renderMotif } from '../audio/renderOffline'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { useGridColumns } from './hooks/useGridColumns'
import { MotifCard } from './MotifCard'
import { FamilyTray } from './FamilyTray'

/** Concept select rendered as a hardware chip (dark = tagged, dashed = none). */
function ConceptChip({ family }: { family: Family }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const concept = family.face.conceptId ? state.concepts.get(family.face.conceptId) : null

  const assign = (conceptId: string | null) =>
    dispatch({
      type: 'FAMILY_ASSIGNED_CONCEPT',
      familyIds: family.members.map((m) => m.id),
      conceptId,
    })

  return (
    <Menu withinPortal position="bottom-start">
      <Menu.Target>
        <Tooltip label="Tag this family to a song concept — variants inherit the tag">
          <button className={`concept-chip${concept ? '' : ' none'}`} onClick={(e) => e.stopPropagation()}>
            {concept ? concept.name : 'No concept'} <CaretDownIcon size={8} weight="bold" />
          </button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => assign(null)}>no concept</Menu.Item>
        {[...state.concepts.values()].map((c) => (
          <Menu.Item key={c.id} onClick={() => assign(c.id)}>
            {c.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

export function LibraryView() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [minRating, setMinRating] = useState(3)
  const [conceptFilter, setConceptFilter] = useState<string>('')
  const [newConcept, setNewConcept] = useState('')
  const { gridRef, columns } = useGridColumns()

  const families = useMemo(() => buildFamilies(state.motifs), [state.motifs])

  const kept = useMemo(
    () =>
      families
        .filter((f) => !f.root.discarded && f.bestRating >= minRating)
        .filter((f) => !conceptFilter || f.face.conceptId === conceptFilter)
        .sort((a, b) => b.bestRating - a.bestRating || a.root.createdAt - b.root.createdAt),
    [families, minRating, conceptFilter],
  )
  const variantsInside = kept.reduce((sum, f) => sum + f.variants.length, 0)

  const createConcept = () => {
    const name = newConcept.trim()
    if (!name) return
    dispatch({ type: 'CONCEPT_CREATED', concept: { id: newId(), name, createdAt: Date.now() } })
    setNewConcept('')
  }

  const exportAllMidi = () => {
    for (const f of kept) {
      const tempo = effectiveTempo(state.transport, f.face)
      downloadBlob(
        new Blob([motifToMidi(f.face, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
        midiFilename(f.face, tempo),
      )
    }
  }

  const exportRow = (f: Family) => {
    const tempo = effectiveTempo(state.transport, f.face)
    return (
      <div className="card-concept-row" key="concept-row" onClick={(e) => e.stopPropagation()}>
        <ConceptChip family={f} />
        <span className="spacer" />
        <button
          className="text-btn"
          onClick={() =>
            downloadBlob(
              new Blob([motifToMidi(f.face, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
              midiFilename(f.face, tempo),
            )
          }
        >
          .MID
        </button>
        <button
          className="text-btn"
          onClick={() =>
            void renderMotif(f.face, tempo, {
              drone: state.transport.drone,
              sound: state.transport.sound,
              forceSound: state.transport.forceSound,
            }).then((buf) =>
              downloadBlob(
                audioBufferToWavBlob(buf),
                midiFilename(f.face, tempo).replace(/\.mid$/, '.wav'),
              ),
            )
          }
        >
          .WAV
        </button>
      </div>
    )
  }

  // Fold-out tray placement mirrors the triage grid.
  const expandedIdx = kept.findIndex((f) => f.rootId === state.expandedFamilyId)
  const trayAfter =
    expandedIdx < 0 ? -1 : Math.min(kept.length, (Math.floor(expandedIdx / columns) + 1) * columns)

  const cells: React.ReactNode[] = []
  kept.forEach((f, i) => {
    cells.push(
      <MotifCard
        key={f.rootId}
        family={f}
        selected={f.face.id === state.selectedId}
        expanded={f.rootId === state.expandedFamilyId}
        onToggleExpand={() =>
          dispatch({
            type: 'SET_EXPANDED_FAMILY',
            id: state.expandedFamilyId === f.rootId ? null : f.rootId,
          })
        }
        conceptRow={exportRow(f)}
      />,
    )
    if (i + 1 === trayAfter) {
      cells.push(
        <FamilyTray
          key={`tray-${state.expandedFamilyId}`}
          family={kept[expandedIdx]}
          onFold={() => dispatch({ type: 'SET_EXPANDED_FAMILY', id: null })}
        />,
      )
    }
  })

  return (
    <>
      <div className="module lib-toolbar">
        <span className="micro" style={{ letterSpacing: '.14em' }}>
          Min rating
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3, 4, 5].map((r) => (
            <Tooltip key={r} label={`Only families with a take rated ★${r} or higher`}>
              <button className="starkey" data-latched={minRating === r} onClick={() => setMinRating(r)}>
                <StarIcon size={8} weight="fill" />
                {r}
              </button>
            </Tooltip>
          ))}
        </div>
        <span className="toolbar-divider" />
        <span className="micro" style={{ letterSpacing: '.14em' }}>
          Concept
        </span>
        <Select
          w={150}
          size="xs"
          value={conceptFilter}
          onChange={(v) => setConceptFilter(v ?? '')}
          data={[
            { value: '', label: 'all' },
            ...[...state.concepts.values()].map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <span className="count-readout">
          {kept.length} families kept · {variantsInside} variants inside
        </span>
        <span className="spacer" />
        <TextInput
          w={180}
          placeholder="new concept name…"
          value={newConcept}
          onChange={(e) => setNewConcept(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && createConcept()}
        />
        <Button
          className="dark"
          disabled={!newConcept.trim()}
          onClick={createConcept}
          leftSection={<PlusIcon size={10} weight="bold" />}
        >
          Concept
        </Button>
        <Tooltip label="Download the promoted take of every family shown as .mid files">
          <Button className="accent" disabled={kept.length === 0} onClick={exportAllMidi}>
            Export all .MID
          </Button>
        </Tooltip>
      </div>
      {kept.length === 0 ? (
        <div className="empty-note">No families rated {'★'.repeat(minRating)} or higher yet.</div>
      ) : (
        <div className="motif-grid" ref={gridRef}>
          {cells}
        </div>
      )}
    </>
  )
}
