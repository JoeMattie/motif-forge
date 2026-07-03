import { useEffect, useMemo, useRef, useState } from 'react'
import { NumberInput, Select, Textarea, Tooltip } from '@mantine/core'
import {
  ArrowElbowDownRightIcon,
  AsteriskIcon,
  CaretRightIcon,
  CircleIcon,
  DiceFiveIcon,
  LockSimpleIcon,
  XIcon,
} from '@phosphor-icons/react'
import type { Mode, Motif, Rating as RatingValue } from '../types'
import { parentIdOf } from '../types'
import { MODES, beatsPerBar } from '../core/theory'
import { applyTransform, type Transform } from '../core/transforms'
import { familyOf, variantBadge } from '../core/families'
import { mutateBatch } from '../api/generate'
import { enqueue } from '../api/queue'
import { SURPRISE_MUTATION_BRIEF } from '../api/prompts'
import { engine } from '../audio/engine'
import { effectiveTempo } from '../store/appState'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { motifToMidi, midiFilename } from '../core/midi'
import { audioBufferToWavBlob } from '../core/wav'
import { downloadBlob } from '../core/downloads'
import { renderMotif } from '../audio/renderOffline'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
import { isTypingTarget } from './hooks/useKeyboardTriage'
import { usePlayOptions } from './hooks/usePlayOptions'
import { LcdRoll } from './LcdRoll'
import { PatchCables, type CableSpec } from './PatchCables'
import { HardToggle } from './hw/HardToggle'
import { PlayRound } from './hw/PlayRound'
import { RateSquares } from './hw/RateSquares'

type PartState = 'lock' | 'vary'

const ACCENT = '#f14d0e'
const YELLOW = '#e8b23c'
const GREEN = '#3ba07e'

const PART_COLOR_CLASSES = ['part-0', 'part-1', 'part-2', 'part-3']

function cableColorFor(motif: Motif): string {
  if (motif.source.kind === 'transform') return GREEN
  if (motif.source.kind === 'llm-mutation' && motif.source.variedParts?.length) {
    const allDrums = motif.source.variedParts.every((i) => motif.parts[i]?.instrument === 'drums')
    return allDrums ? YELLOW : ACCENT
  }
  return ACCENT
}

function lineageChain(motif: Motif, motifs: Map<string, Motif>): Motif[] {
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
  return chain
}

function lineageLabel(m: Motif): string {
  switch (m.source.kind) {
    case 'seed':
      return 'SEED'
    case 'generated':
      return 'GEN BATCH'
    case 'transform':
      return m.source.transform.toUpperCase().slice(0, 18)
    case 'llm-mutation':
      return 'LLM VAR'
  }
}

function ChildCard({
  child,
  isAbTarget,
  onSelectAb,
  cardRef,
  mixForPlayback,
}: {
  child: Motif
  isAbTarget: boolean
  onSelectAb: () => void
  cardRef: (el: HTMLDivElement | null) => void
  /** Applies the live stem swap (locked parts play the source's stems). */
  mixForPlayback: (m: Motif) => Motif
}) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const isPlaying = useIsPlaying(child.id)
  const isLoading = useIsLoading(child.id)
  const badge = variantBadge(child)
  const color = cableColorFor(child)
  const family = familyOf(child, state.motifs)
  const kept = family.face.id === child.id

  const varied = child.source.kind === 'llm-mutation' ? (child.source.variedParts ?? []) : []
  const dimParts =
    varied.length > 0
      ? new Set(child.parts.map((_, i) => i).filter((i) => !varied.includes(i)))
      : undefined

  const soloVar = () => {
    if (varied.length === 0) return
    const solo: Motif = {
      ...child,
      id: `${child.id}::solo`,
      notes: child.notes.filter((n) => varied.includes(n.part ?? 0)),
    }
    engine.toggle(solo, playOpts(child))
  }

  const tempo = effectiveTempo(state.transport, child)
  const exportMidi = () =>
    downloadBlob(
      new Blob([motifToMidi(child, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
      midiFilename(child, tempo),
    )
  const exportWav = async () => {
    const buf = await renderMotif(child, tempo, {
      drone: state.transport.drone,
      sound: state.transport.sound,
      forceSound: state.transport.forceSound,
    })
    downloadBlob(audioBufferToWavBlob(buf), midiFilename(child, tempo).replace(/\.mid$/, '.wav'))
  }

  const badgeCls = badge.kind === 'transform' ? 'transform' : color === YELLOW ? 'var-drums' : 'var'
  const cableCls = color === YELLOW ? ' cable-yellow' : color === GREEN ? ' cable-green' : ''

  return (
    <div
      ref={cardRef}
      className={`child-card${cableCls}${isPlaying || isAbTarget ? ' playing' : ''}`}
      onClick={onSelectAb}
    >
      <div className="card-head">
        <Tooltip label={child.rationale} disabled={child.rationale ? undefined : true}>
          <span className="child-name">
            <ArrowElbowDownRightIcon size={11} /> {child.name}
          </span>
        </Tooltip>
        <span className={`child-badge ${badgeCls}`}>{badge.label}</span>
      </div>
      <LcdRoll motif={child} height={80} dimParts={dimParts} />
      {child.parts.length > 0 && varied.length > 0 && (
        <div className="part-badges">
          {child.parts.map((p, i) =>
            varied.includes(i) ? (
              <span
                key={i}
                className={`part-badge varied${p.instrument === 'drums' ? ' drums' : ''}`}
              >
                {p.name} <AsteriskIcon size={7} weight="bold" />
              </span>
            ) : (
              <span key={i} className="part-badge">
                {p.name} <LockSimpleIcon size={7} weight="fill" />
              </span>
            ),
          )}
        </div>
      )}
      <div className="child-foot">
        <Tooltip label="Play/stop — locked channels play the source's stems, armed channels play this variation">
          <PlayRound
            playing={isPlaying}
            loading={isLoading}
            onClick={() => engine.toggle(mixForPlayback(child), playOpts(child))}
          />
        </Tooltip>
        <RateSquares
          rating={child.rating}
          onRate={(r) => dispatch({ type: 'MOTIF_RATED', id: child.id, rating: r as RatingValue })}
        />
        <span className="spacer" />
        <Tooltip label="Promote this child as the family's face — what triage shows, plays, and exports">
          <button
            className="promote-chip"
            data-promoted={kept}
            onClick={(e) => {
              e.stopPropagation()
              dispatch({
                type: 'MOTIF_PROMOTED',
                id: child.id,
                familyIds: family.members.map((m) => m.id),
              })
            }}
          >
            {kept ? (
              <>
                Keep <CircleIcon size={6} weight="fill" />
              </>
            ) : (
              'Keep'
            )}
          </button>
        </Tooltip>
        {varied.length > 0 && (
          <Tooltip label="Audition only the varied part(s), muting everything the LLM left untouched">
            <button
              className="text-btn"
              onClick={(e) => {
                e.stopPropagation()
                soloVar()
              }}
            >
              Solo var
            </button>
          </Tooltip>
        )}
        <button
          className="text-btn"
          onClick={(e) => {
            e.stopPropagation()
            exportMidi()
          }}
        >
          .MID
        </button>
        <button
          className="text-btn"
          onClick={(e) => {
            e.stopPropagation()
            void exportWav()
          }}
        >
          .WAV
        </button>
        <button
          className="text-btn"
          title="Discard this variant"
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'MOTIF_DISCARDED', id: child.id })
          }}
        >
          <XIcon size={10} weight="bold" />
        </button>
      </div>
    </div>
  )
}

/**
 * Mutation Bay — opens scoped to ONE family. Left: source module with
 * per-part LOCK/VARY channel strips + transform/LLM module. Middle: variant
 * children patched in by color-coded cables. Right: A/B audition, cable
 * legend, part-activity meters.
 */
export function MutationBay({ source }: { source: Motif }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const isPlaying = useIsPlaying(source.id)
  const isLoading = useIsLoading(source.id)

  const family = useMemo(() => familyOf(source, state.motifs), [source, state.motifs])
  const children = useMemo(
    () =>
      family.members
        .filter((m) => m.id !== family.rootId && !m.discarded)
        .sort((a, b) => b.createdAt - a.createdAt),
    [family],
  )

  const hasParts = source.parts.length > 0
  const [partState, setPartState] = useState<PartState[]>(() => source.parts.map(() => 'lock'))
  const armed = hasParts
    ? partState.flatMap((s, i) => (s === 'vary' ? [i] : []))
    : source.parts.map((_, i) => i)
  const locked = hasParts ? partState.flatMap((s, i) => (s === 'lock' ? [i] : [])) : []

  const [brief, setBrief] = useState('')
  const [lockRhythm, setLockRhythm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [transposeBy, setTransposeBy] = useState(2)
  const [targetMode, setTargetMode] = useState<Mode>(source.mode === 'dorian' ? 'phrygian' : 'dorian')
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set())
  const [abSide, setAbSide] = useState<'A' | 'B'>('A')
  const [abLoop, setAbLoop] = useState(true)
  const [abChildId, setAbChildId] = useState<string | null>(null)

  const abChild = (abChildId ? state.motifs.get(abChildId) : undefined) ?? children[0]

  /**
   * Live stem swap: auditioning a variation honors the CURRENT channel
   * toggles — locked parts play the SOURCE's stems, armed parts play the
   * variation's. Only kicks in once something is armed (default all-LOCK
   * plays the variation as-is), and only when the stems line up.
   */
  const mixForPlayback = (child: Motif): Motif => {
    if (
      !hasParts ||
      armed.length === 0 ||
      locked.length === 0 ||
      child.parts.length !== source.parts.length ||
      child.bars !== source.bars
    ) {
      return child
    }
    const stem = (m: Motif, s: PartState) =>
      m.notes.filter((n) => partState[Math.min(n.part ?? 0, partState.length - 1)] === s)
    return {
      ...child,
      notes: [...stem(source, 'lock'), ...stem(child, 'vary')].sort(
        (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch,
      ),
    }
  }

  // Space plays/stops (source, or whatever bay motif is sounding); ESC closes
  // the bay. Guarded so typing in the brief textarea keeps its keys.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        // first ESC leaves the text field, the next one closes the bay
        if (isTypingTarget(e.target)) {
          ;(e.target as HTMLElement).blur()
          return
        }
        engine.stop()
        dispatch({ type: 'SET_MUTATION_TARGET', id: null })
        return
      }
      if (isTypingTarget(e.target)) return
      if (e.key === ' ') {
        e.preventDefault()
        if (engine.getSnapshot().playingMotifId !== null) engine.stop()
        else engine.play(source, playOpts(source))
      } else if (e.key === 'p' && abChild) {
        dispatch({
          type: 'MOTIF_PROMOTED',
          id: abChild.id,
          familyIds: family.members.map((m) => m.id),
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [source, dispatch, playOpts, abChild, family])

  const bayRef = useRef<HTMLDivElement>(null)
  const stripRefs = useRef<(HTMLDivElement | null)[]>([])
  const sourceLcdRef = useRef<HTMLDivElement>(null)
  const transformModuleRef = useRef<HTMLDivElement>(null)
  const childRefs = useRef(new Map<string, HTMLDivElement>())

  const setPart = (i: number, s: PartState) =>
    setPartState((prev) => prev.map((p, j) => (j === i ? s : p)))

  // Transforms apply client-side to the unlocked (armed) parts only. Pitch
  // transforms skip drum parts — inverting a kick pattern is noise.
  const transformScope = (pitchTransform: boolean): Set<number> | undefined => {
    if (!hasParts) return undefined
    const scope = armed.filter((i) => !pitchTransform || source.parts[i].instrument !== 'drums')
    return new Set(scope)
  }
  const transformsDisabled = hasParts && armed.length === 0

  const apply = (t: Transform, pitchTransform = true) => {
    const child = applyTransform(source, t, { parts: transformScope(pitchTransform) })
    dispatch({ type: 'MOTIFS_ADDED', motifs: [child] })
    if (t.type === 'octaveDisplace') setSelectedNotes(new Set())
  }

  const toggleNote = (i: number) =>
    setSelectedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const runLlmMutation = async (mutationBrief: string) => {
    if (!mutationBrief.trim() || busy) return
    if (hasParts && armed.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await enqueue(() =>
        mutateBatch(source, mutationBrief.trim(), 5, {
          lockRhythm,
          lockedParts: hasParts ? locked : undefined,
        }),
      )
      dispatch({ type: 'MOTIFS_ADDED', motifs: result.valid })
      setMessage(
        `${result.valid.length} children added${result.droppedCount ? `, ${result.droppedCount} dropped` : ''}`,
      )
    } catch (e) {
      setMessage(`Mutation failed: ${String(e).slice(0, 120)}`)
    } finally {
      setBusy(false)
    }
  }

  // A/B audition — latch a side; while looping the swap lands on the next bar.
  // The B side plays through the live stem swap, so only armed parts differ.
  const audition = (side: 'A' | 'B') => {
    setAbSide(side)
    const target = side === 'A' ? source : abChild && mixForPlayback(abChild)
    if (!target) return
    const pos = engine.getPositionBeats()
    const playingId = engine.getSnapshot().playingMotifId
    const nowPlaying = playingId === source.id || playingId === abChild?.id
    if (abLoop && nowPlaying && pos !== null) {
      const bpb = beatsPerBar(source.timeSig)
      const nextBar = Math.ceil((pos + 0.05) / bpb) * bpb
      const waitMs = ((nextBar - pos) * 60 * 1000) / effectiveTempo(state.transport, source)
      const targetTotal = target.bars * beatsPerBar(target.timeSig)
      window.setTimeout(() => {
        engine.play(target, playOpts(target, { loop: true, fromBeat: nextBar % targetTotal }))
      }, Math.max(0, waitMs - 90))
    } else {
      engine.play(target, playOpts(target, { loop: abLoop }))
    }
  }

  // Patch cables: one per varied part per child, from that part's channel
  // strip jack; transforms patch from the transform module in green.
  // Endpoints are getters — refs aren't populated until after the first
  // render, and cables must be visible from the first paint.
  const cables: CableSpec[] = children.flatMap((child) => {
    const to = {
      getEl: () => childRefs.current.get(child.id) ?? null,
      edge: 'left' as const,
      vAlign: 0.25,
    }
    if (child.source.kind === 'transform') {
      return [{ from: { getEl: () => transformModuleRef.current, edge: 'right' as const }, to, color: GREEN }]
    }
    const varied = child.source.kind === 'llm-mutation' ? (child.source.variedParts ?? []) : []
    if (varied.length === 0) {
      return [{ from: { getEl: () => sourceLcdRef.current, edge: 'right' as const }, to, color: ACCENT }]
    }
    return varied.map((p) => ({
      from: { getEl: () => stripRefs.current[p] ?? null, edge: 'right' as const, vAlign: 0.5 },
      to,
      color: source.parts[p]?.instrument === 'drums' ? YELLOW : ACCENT,
    }))
  })

  const chain = lineageChain(source, state.motifs)
  const armedNames = armed.map((i) => ({
    i,
    name: source.parts[i]?.name ?? `part ${i}`,
    drums: source.parts[i]?.instrument === 'drums',
  }))

  return (
    <div className="bay" ref={bayRef}>
      <PatchCables
        container={bayRef}
        cables={cables}
        deps={[children.map((c) => c.id).join(','), partState.join(','), busy]}
      />

      {/* -------- left column: source + transform/LLM -------- */}
      <div className="bay-left">
        <section className="module bay-module">
          <div className="bay-head-row">
            <span className="micro-head">
              Source{hasParts ? ` · ${source.parts.length} parts` : ''}
            </span>
            <span className="micro-dim">
              {chain.map((m) => lineageLabel(m)).join(' → ') || 'THIS'}
            </span>
          </div>
          <div className="bay-head-row">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <Tooltip label="Play/stop the source (Space)">
                <PlayRound
                  playing={isPlaying}
                  loading={isLoading}
                  onClick={() => engine.toggle(source, playOpts(source))}
                />
              </Tooltip>
              <span className="bay-title">{source.name}</span>
            </span>
            <span className="bay-meta">
              {source.key} {source.mode.slice(0, 3).toUpperCase()} · {source.bars}B · {source.tempo}
            </span>
          </div>
          <div ref={sourceLcdRef}>
            <LcdRoll
              motif={source}
              height={148}
              selectedNotes={selectedNotes}
              onToggleNote={toggleNote}
            />
          </div>
          <div className="bay-head-row">
            <span className="micro-head">Part channels</span>
            <span className="micro-dim">Lock = pass through · vary = patch to LLM</span>
          </div>
          {hasParts ? (
            <div className="channel-strips">
              {source.parts.map((p, i) => {
                const armedStrip = partState[i] === 'vary'
                const drums = p.instrument === 'drums'
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      stripRefs.current[i] = el
                    }}
                    className={`channel-strip${drums ? ' drums' : ''}`}
                    data-armed={armedStrip}
                  >
                    <i className={`cs-swatch part-swatch ${drums ? 'drums' : PART_COLOR_CLASSES[i]}`} />
                    <span className="cs-name">{p.name}</span>
                    <span className="cs-inst">{drums ? 'GM kit' : p.instrument}</span>
                    <span className="spacer" />
                    <Tooltip label="Locked parts are copied into every child verbatim">
                      <HardToggle
                        on={partState[i] === 'lock'}
                        label={
                          partState[i] === 'lock' ? (
                            <>
                              lock <LockSimpleIcon size={8} weight="fill" />
                            </>
                          ) : (
                            'lock'
                          )
                        }
                        onChange={(on) => setPart(i, on ? 'lock' : 'vary')}
                      />
                    </Tooltip>
                    <Tooltip label="Armed parts are the only thing the LLM rewrites">
                      <HardToggle
                        on={armedStrip}
                        label={
                          armedStrip ? (
                            <>
                              vary <CircleIcon size={6} weight="fill" />
                            </>
                          ) : (
                            'vary'
                          )
                        }
                        color={drums ? 'yellow' : 'accent'}
                        onChange={(on) => setPart(i, on ? 'vary' : 'lock')}
                      />
                    </Tooltip>
                  </div>
                )
              })}
            </div>
          ) : (
            <span className="micro-dim">
              Partless motif — plays on the transport sound; mutations rewrite the whole line.
            </span>
          )}
          <div className="lineage-row">
            <span style={{ letterSpacing: '.14em', color: 'var(--faint)' }}>Lineage</span>
            {chain.map((m, i) => (
              <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span className="lineage-arrow">→</span>}
                <Tooltip label={m.name}>
                  <button
                    className="lineage-chip"
                    data-current={m.id === source.id}
                    onClick={() =>
                      m.id !== source.id && dispatch({ type: 'SET_MUTATION_TARGET', id: m.id })
                    }
                  >
                    {m.id === source.id ? 'THIS' : lineageLabel(m)}
                  </button>
                </Tooltip>
              </span>
            ))}
          </div>
        </section>

        <section className="module bay-module" ref={transformModuleRef}>
          <div className="bay-head-row">
            <span className="micro-head">Transform — unlocked parts only</span>
            <span className="micro-dim">
              {hasParts ? `${armed.length} of ${source.parts.length} armed` : 'whole motif'}
            </span>
          </div>
          <div className="transform-grid">
            <Tooltip label="Flip the contour upside down around the first note — rises become falls">
              <button className="hw-key" disabled={transformsDisabled} onClick={() => apply({ type: 'inversion' })}>
                Invert
              </button>
            </Tooltip>
            <Tooltip label="Play the motif backwards in time">
              <button className="hw-key" disabled={transformsDisabled} onClick={() => apply({ type: 'retrograde' }, false)}>
                Retro
              </button>
            </Tooltip>
            <Tooltip
              label={`Double every duration — same notes at half speed, twice the bars${source.bars * 2 > 8 ? ` (result will be ${source.bars * 2} bars, beyond the 2–8 bar range)` : ''}`}
            >
              <button className="hw-key" disabled={transformsDisabled} onClick={() => apply({ type: 'augment' }, false)}>
                Aug ×2{source.bars * 2 > 8 ? ' ⚠' : ''}
              </button>
            </Tooltip>
            <Tooltip label="Halve every duration — same notes at double speed, half the bars">
              <button className="hw-key" disabled={transformsDisabled} onClick={() => apply({ type: 'diminish' }, false)}>
                Dim ×.5
              </button>
            </Tooltip>
          </div>
          <div className="transform-aux">
            <Tooltip label="Backwards and upside down — the most disguised transform">
              <button
                className="hw-key"
                disabled={transformsDisabled}
                onClick={() => apply({ type: 'retrogradeInversion' })}
              >
                R-Inv
              </button>
            </Tooltip>
            <Tooltip label="Shift every pitch by the chosen number of semitones (+12 = up an octave)">
              <button
                className="hw-key"
                disabled={transformsDisabled}
                onClick={() => apply({ type: 'transpose', semitones: transposeBy })}
              >
                Transpose
              </button>
            </Tooltip>
            <NumberInput
              w={62}
              size="xs"
              min={-12}
              max={12}
              value={transposeBy}
              onChange={(v) => setTransposeBy(Number(v) || 0)}
            />
            <Tooltip label="Recolor the motif: keep each note's scale degree but re-spell it in the target mode">
              <button
                className="hw-key"
                disabled={transformsDisabled}
                onClick={() => apply({ type: 'modeSwap', targetMode })}
              >
                Mode swap
              </button>
            </Tooltip>
            <Select
              w={110}
              size="xs"
              value={targetMode}
              onChange={(v) => v && setTargetMode(v as Mode)}
              data={MODES.filter((m) => m !== source.mode)}
            />
          </div>
          <div className="transform-aux">
            <Tooltip label="Move the notes selected on the source LCD up one octave (click notes to select)">
              <button
                className="hw-key"
                disabled={selectedNotes.size === 0}
                onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: 1 })}
              >
                8va ↑
              </button>
            </Tooltip>
            <Tooltip label="Move the notes selected on the source LCD down one octave (click notes to select)">
              <button
                className="hw-key"
                disabled={selectedNotes.size === 0}
                onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: -1 })}
              >
                8vb ↓
              </button>
            </Tooltip>
            <span className="micro-dim">click notes on the source LCD to select them</span>
          </div>

          <div className="llm-section">
            <span className="micro-head">
              LLM mutate
              {hasParts && armedNames.length > 0 && (
                <>
                  {' — armed: '}
                  {armedNames.map((a, j) => (
                    <span key={a.i}>
                      {j > 0 && ' + '}
                      <span className={`armed-name ${a.drums ? 'yellow' : 'accent'}`}>{a.name}</span>
                    </span>
                  ))}
                </>
              )}
            </span>
            <Textarea
              rows={2}
              placeholder='e.g. "keep the lead untouched; reharmonize darker and loosen the groove"'
              value={brief}
              onChange={(e) => setBrief(e.currentTarget.value)}
            />
            <div className="transform-aux">
              <Tooltip label="Children keep the parent's exact note timings — only pitches (and velocities) change">
                <HardToggle on={lockRhythm} label="lock rhythm" onChange={setLockRhythm} />
              </Tooltip>
              <span className="micro-dim" style={{ lineHeight: 1.5 }}>
                locked parts are copied
                <br />
                into every child verbatim
              </span>
              <span className="spacer" />
              <Tooltip
                label={
                  hasParts && armed.length === 0
                    ? 'Arm at least one part with VARY first'
                    : 'Run 5 LLM variations of the armed parts'
                }
              >
                <button
                  className="hw-key accent"
                  disabled={busy || !brief.trim() || (hasParts && armed.length === 0)}
                  onClick={() => void runLlmMutation(brief)}
                >
                  {busy ? (
                    'Running…'
                  ) : (
                    <>
                      Run <CaretRightIcon size={10} weight="fill" />
                    </>
                  )}
                </button>
              </Tooltip>
              <Tooltip label="Free rein: reinterpret texture, rhythm, or mood while keeping a recognizable kernel">
                <button
                  className="hw-key"
                  disabled={busy || (hasParts && armed.length === 0)}
                  onClick={() => void runLlmMutation(SURPRISE_MUTATION_BRIEF)}
                >
                  <DiceFiveIcon size={13} weight="fill" />
                </button>
              </Tooltip>
            </div>
            {message && <span className="micro-dim">{message}</span>}
          </div>
        </section>
      </div>

      {/* -------- middle column: children -------- */}
      <div className="bay-children">
        {children.length === 0 && !busy && (
          <div className="empty-note">
            No variants yet — arm a part and RUN, or fire a deterministic transform.
          </div>
        )}
        {children.map((c) => (
          <ChildCard
            key={c.id}
            child={c}
            isAbTarget={abSide === 'B' && abChild?.id === c.id}
            onSelectAb={() => setAbChildId(c.id)}
            mixForPlayback={mixForPlayback}
            cardRef={(el) => {
              if (el) childRefs.current.set(c.id, el)
              else childRefs.current.delete(c.id)
            }}
          />
        ))}
      </div>

      {/* -------- right column -------- */}
      <div className="bay-right">
        <span className="micro-head">A/B audition</span>
        <section className="module bay-module">
          <span className="micro-dim" style={{ lineHeight: 1.6 }}>
            Flip between parent and child while looping — only the varied part changes under your
            ear
          </span>
          <div className="ab-buttons">
            <button className="hw-key" data-latched={abSide === 'A'} onClick={() => audition('A')}>
              A · Source
            </button>
            <button
              className="hw-key"
              data-latched={abSide === 'B'}
              disabled={!abChild}
              onClick={() => audition('B')}
            >
              B · Child
            </button>
          </div>
          <Tooltip label="Loop the phrase; latching the other side swaps on the next bar boundary">
            <HardToggle on={abLoop} label="loop · swap on bar" onChange={setAbLoop} />
          </Tooltip>
          {abChild && <span className="micro-dim">B → {abChild.name}</span>}
        </section>

        {busy && (
          <div className="bay-pending">
            Mutating{' '}
            {hasParts && armedNames.length > 0
              ? armedNames.map((a) => a.name).join('+')
              : 'motif'}{' '}
            · 5 inbound
          </div>
        )}

        <section className="module cable-legend">
          <span className="micro-head">Cable legend</span>
          <span className="cl-row">
            <i className="cable-sample" style={{ background: ACCENT }} />
            var · melodic channel
          </span>
          <span className="cl-row">
            <i className="cable-sample" style={{ background: YELLOW }} />
            var · drums channel
          </span>
          <span className="cl-row">
            <i className="cable-sample" style={{ background: GREEN }} />
            deterministic transform
          </span>
          <span className="cl-row">
            <i
              className="cable-sample"
              style={{ background: `repeating-linear-gradient(90deg, ${GREEN} 0 4px, transparent 4px 9px)` }}
            />
            pending patch
          </span>
          <span className="cl-note">
            Cables leave from the armed part's jack — locked parts never patch out
          </span>
        </section>

        <section className="module vu-module">
          <div className="vu-bars">
            {(hasParts ? source.parts : [{ name: 'all', instrument: 'synth' }]).flatMap((p, i) => {
              const colors = ['var(--note-lead)', 'var(--note-harmony)', 'var(--note-bass)', 'var(--note-drums)']
              const color = p.instrument === 'drums' ? 'var(--note-drums)' : colors[i % colors.length]
              const anyPlaying = engine.getSnapshot().playingMotifId !== null
              const style = (d: number): React.CSSProperties => ({
                background: color,
                animationDelay: `${d}s`,
                animationDuration: `${0.8 + i * 0.2}s`,
                animationPlayState: anyPlaying || isPlaying || isLoading ? 'running' : 'paused',
              })
              return [
                <i key={`${i}a`} style={style(i * 0.15)} />,
                <i key={`${i}b`} style={style(i * 0.15 + 0.3)} />,
              ]
            })}
          </div>
          <div className="vu-label">
            Part
            <br />
            activity
            <br />
            <b>{hasParts ? source.parts.length : 1} channel{hasParts && source.parts.length !== 1 ? 's' : ''}</b>
          </div>
        </section>

        <button
          className="hw-key"
          aria-label="Close bay"
          onClick={() => {
            engine.stop()
            dispatch({ type: 'SET_MUTATION_TARGET', id: null })
          }}
        >
          <XIcon size={10} weight="bold" /> Close bay · <b className="hk">esc</b>
        </button>
        <span className="kbd-legend" style={{ textAlign: 'center' }}>
          <b className="hk">space</b> play · <b className="hk">p</b> promote B ·{' '}
          <b className="hk">esc</b> close
        </span>
      </div>
    </div>
  )
}
