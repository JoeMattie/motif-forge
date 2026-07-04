import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, Menu, TextInput, Tooltip } from '@mantine/core'
import { ArrowRightIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import type { Motif, Rating as RatingValue } from '../types'
import { buildFamilies, variantBadge, type Family } from '../core/families'
import { engine } from '../audio/engine'
import { effectiveTempo } from '../store/appState'
import { motifToMidi, midiFilename } from '../core/midi'
import { downloadBlob } from '../core/downloads'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { useIsPlaying } from './hooks/usePlayhead'
import { usePlayOptions } from './hooks/usePlayOptions'
import { LcdRoll } from './LcdRoll'
import { PlayRound } from './hw/PlayRound'
import { RateSquares, Stars } from './hw/RateSquares'

const TRACKS = ['01', '02', '03', '04', '05', '06', '07', '08']

function TrackChip({ motif }: { motif: Motif }) {
  const dispatch = useAppDispatch()
  return (
    <Menu withinPortal position="bottom-start">
      <Menu.Target>
        <Tooltip label="Which track of the album this take is used on">
          <button
            type="button"
            className={`track-chip${motif.trackId ? '' : ' unassigned'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {motif.trackId ? `Track ${motif.trackId}` : 'Unassigned'}
          </button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => dispatch({ type: 'MOTIF_ASSIGNED_TRACK', id: motif.id, trackId: null })}>
          unassigned
        </Menu.Item>
        {TRACKS.map((t) => (
          <Menu.Item
            key={t}
            onClick={() => dispatch({ type: 'MOTIF_ASSIGNED_TRACK', id: motif.id, trackId: t })}
          >
            track {t}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

function DerivedCard({ motif }: { motif: Motif }) {
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const isPlaying = useIsPlaying(motif.id)
  const badge = variantBadge(motif)
  const badgeCls =
    badge.kind === 'transform'
      ? 'transform'
      : badge.parts.some((i) => motif.parts[i]?.instrument === 'drums')
        ? 'var-drums'
        : 'var'
  return (
    <div className={`tray-card${isPlaying ? ' playing' : ''}`}>
      <div className="tray-card-head">
        <span className="tray-card-name">{motif.name}</span>
        <span className={`tray-badge ${badgeCls}`}>{badge.label.replace('TRANSFORM · ', '')}</span>
      </div>
      <LcdRoll motif={motif} height={48} />
      <div className="tray-card-foot">
        <PlayRound
          size="sm"
          playing={isPlaying}
          onClick={() => {
            dispatch({ type: 'SELECT', id: motif.id })
            engine.toggle(motif, playOpts(motif))
          }}
        />
        <TrackChip motif={motif} />
        <span className="spacer" />
        <Stars rating={motif.rating} />
      </div>
    </div>
  )
}

function RootGroup({ family }: { family: Family }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const root = family.root
  const isPlaying = useIsPlaying(root.id)
  const derived = family.variants.filter((v) => !v.discarded)
  const tempo = effectiveTempo(state.transport, root)

  return (
    <section className="tray root-tray">
      <div className="root-tray-row">
        <div className="root-card">
          <div className="card-head">
            <span className="card-name">
              {root.name}
              <span className="root-tag">ROOT</span>
            </span>
            <span className="card-meta">
              {root.key} {root.mode.slice(0, 3).toUpperCase()} · {root.bars}B · {root.tempo}
            </span>
          </div>
          <LcdRoll motif={root} height={84} />
          <div className="card-footer">
            <PlayRound
              playing={isPlaying}
              onClick={() => {
                dispatch({ type: 'SELECT', id: root.id })
                engine.toggle(root, playOpts(root))
              }}
            />
            <RateSquares
              rating={root.rating}
              onRate={(r) => dispatch({ type: 'MOTIF_RATED', id: root.id, rating: r as RatingValue })}
            />
            <TrackChip motif={root} />
            <span className="spacer" />
            <button
              type="button"
              className="text-btn"
              onClick={() =>
                downloadBlob(
                  new Blob([motifToMidi(root, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
                  midiFilename(root, tempo),
                )
              }
            >
              .MID
            </button>
          </div>
        </div>
        <div className="derive-col">
          <div className="derive-head">
            <span className="micro" style={{ letterSpacing: '.14em' }}>
              Derived for other tracks — {derived.length}
            </span>
            <Tooltip label="Open the mutation bay pre-scoped to this root to derive a take for another track">
              <Button
                className="accent"
                onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: root.id })}
                rightSection={<ArrowRightIcon size={10} />}
              >
                Transform for new track
              </Button>
            </Tooltip>
          </div>
          <div className="derive-cards">
            {derived.map((d) => (
              <DerivedCard key={d.id} motif={d} />
            ))}
            <button
              type="button"
              className="derive-slot"
              onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: root.id })}
            >
              <PlusIcon size={11} /> Derive a variant for the next track
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Leitmotif desk: one concept's whole bloodline across tracks. */
export function ConceptView() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const concepts = useMemo(
    () => [...state.concepts.values()].sort((a, b) => a.createdAt - b.createdAt),
    [state.concepts],
  )
  const [conceptId, setConceptId] = useState<string | null>(concepts[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const families = useMemo(() => buildFamilies(state.motifs), [state.motifs])

  // Concepts referenced by any motif — including discarded ones, which can be
  // restored and would otherwise come back with a dangling concept tag.
  const usedConceptIds = useMemo(() => {
    const used = new Set<string>()
    for (const m of state.motifs.values()) if (m.conceptId) used.add(m.conceptId)
    return used
  }, [state.motifs])

  // Family count per concept, in one pass instead of a filter per tab.
  const familyCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of families) {
      if (f.root.discarded) continue
      const tagged = new Set<string>()
      for (const m of f.members) if (m.conceptId) tagged.add(m.conceptId)
      for (const id of tagged) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [families])

  const groups = useMemo(
    () =>
      conceptId
        ? families.filter((f) => !f.root.discarded && f.members.some((m) => m.conceptId === conceptId))
        : [],
    [families, conceptId],
  )

  const active = conceptId ? state.concepts.get(conceptId) : null
  const bestRating = Math.max(0, ...groups.map((g) => g.bestRating))
  const usedTracks = [
    ...new Set(groups.flatMap((g) => g.members.map((m) => m.trackId)).filter((t): t is string => !!t)),
  ].sort()

  // Play the concept's promoted takes back to back.
  const playQueue = useRef<Motif[]>([])
  const [playingAll, setPlayingAll] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: playOpts reads the current transport settings on purpose; only playingAll should re-subscribe
  useEffect(() => {
    if (!playingAll) return
    const unsub = engine.subscribe(() => {
      if (engine.getSnapshot().playingMotifId === null) {
        const next = playQueue.current.shift()
        if (next) engine.play(next, playOpts(next))
        else setPlayingAll(false)
      }
    })
    return unsub
  }, [playingAll])

  const playAll = () => {
    if (playingAll) {
      playQueue.current = []
      setPlayingAll(false)
      engine.stop()
      return
    }
    const faces = groups.map((g) => g.face)
    if (faces.length === 0) return
    playQueue.current = faces.slice(1)
    setPlayingAll(true)
    engine.play(faces[0], playOpts(faces[0]))
  }

  const exportConcept = () => {
    for (const g of groups) {
      for (const m of [g.face, ...g.variants.filter((v) => !v.discarded && v.id !== g.face.id)]) {
        const tempo = effectiveTempo(state.transport, m)
        downloadBlob(
          new Blob([motifToMidi(m, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
          midiFilename(m, tempo),
        )
      }
    }
  }

  const createConcept = () => {
    const name = newName.trim()
    if (!name) return
    const id = newId()
    dispatch({ type: 'CONCEPT_CREATED', concept: { id, name, createdAt: Date.now() } })
    setConceptId(id)
    setNewName('')
    setAdding(false)
  }

  if (concepts.length === 0) {
    return (
      <div className="empty-note">
        No concepts yet — name one in the generation module or create one in the Library.
      </div>
    )
  }

  return (
    <>
      <div className="concept-tabs">
        {concepts.map((c) => (
          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Button data-latched={conceptId === c.id} onClick={() => setConceptId(c.id)}>
              <span>
                {c.name} · {familyCounts.get(c.id) ?? 0}
              </span>
            </Button>
            {!usedConceptIds.has(c.id) && (
              <Tooltip label="Delete this concept — no motifs are tagged to it">
                <ActionIcon
                  aria-label="Delete concept"
                  onClick={() => {
                    dispatch({ type: 'CONCEPT_DELETED', id: c.id })
                    if (conceptId === c.id)
                      setConceptId(concepts.find((x) => x.id !== c.id)?.id ?? null)
                  }}
                >
                  <XIcon size={10} />
                </ActionIcon>
              </Tooltip>
            )}
          </span>
        ))}
        {adding ? (
          <TextInput
            w={160}
            autoFocus
            placeholder="concept name"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createConcept()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        ) : (
          <Button
            className="dashed"
            onClick={() => setAdding(true)}
            leftSection={<PlusIcon size={10} />}
          >
            New
          </Button>
        )}
        <span className="spacer" />
        <span className="concept-hint">
          A concept is one musical idea — its motifs recur across tracks in transformed forms
        </span>
      </div>

      {active && (
        <div className="module concept-summary">
          <span className="cs-title">{active.name}</span>
          <span className="cs-meta">
            {groups.length} famil{groups.length === 1 ? 'y' : 'ies'}
            {usedTracks.length > 0 && (
              <>
                {' · used on '}
                <b>{usedTracks.map((t) => `Track ${t}`).join(' · ')}</b>
              </>
            )}
            {bestRating > 0 && <> · best {'★'.repeat(bestRating)}</>}
          </span>
          <span className="spacer" />
          <Tooltip label="Play every family's used take back to back">
            <button type="button" className="play-all" onClick={playAll}>
              <PlayRound size="md" playing={playingAll} onClick={playAll} />
              Play all in sequence
            </button>
          </Tooltip>
          <Tooltip label="Download every take in this concept as .mid files">
            <Button onClick={exportConcept}>Export concept .MID</Button>
          </Tooltip>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-note">No motifs tagged to this concept yet.</div>
      ) : (
        groups.map((g) => <RootGroup key={g.rootId} family={g} />)
      )}
    </>
  )
}
