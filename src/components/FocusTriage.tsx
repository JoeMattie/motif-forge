import { useEffect, useMemo } from 'react'
import { Button, Kbd, Mark, Tooltip } from '@mantine/core'
import {
  ArrowsClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  CircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import type { Rating as RatingValue } from '../types'
import { buildFamilies, type Family } from '../core/families'
import { engine } from '../audio/engine'
import { motifToMidi, midiFilename } from '../core/midi'
import { audioBufferToWavBlob } from '../core/wav'
import { downloadBlob } from '../core/downloads'
import { renderMotif } from '../audio/renderOffline'
import { effectiveTempo } from '../store/appState'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
import { usePlayOptions } from './hooks/usePlayOptions'
import { useKeyboardTriage } from './hooks/useKeyboardTriage'
import { useNoodleCaptureActive } from './hooks/useNoodleCaptureActive'
import { LcdRoll } from './LcdRoll'
import { PlayRound } from './hw/PlayRound'

/** One-at-a-time triage: large LCD, physical control cluster, queue strip. */
export function FocusTriage() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()

  const families = useMemo(() => buildFamilies(state.motifs), [state.motifs])
  const active = useMemo(() => families.filter((f) => !f.root.discarded), [families])
  const faces = useMemo(() => active.map((f) => f.face), [active])

  const index = faces.findIndex((m) => m.id === state.selectedId)
  const current: Family | undefined = index >= 0 ? active[index] : undefined

  // Entering focus mode (or exhausting the queue position): select the first
  // unrated face so the deck starts where triage left off.
  useEffect(() => {
    if (index < 0 && faces.length > 0) {
      const firstUnrated = active.find((f) => f.face.rating === 0)
      dispatch({ type: 'SELECT', id: (firstUnrated ?? active[0]).face.id })
    }
  }, [index, faces, active, dispatch])

  const noodleCapture = useNoodleCaptureActive()
  useKeyboardTriage(faces, 1, state.mutationTargetId === null && !noodleCapture, {
    onMutate: (m) => dispatch({ type: 'SET_MUTATION_TARGET', id: m.id }),
  })

  const face = current?.face
  const isPlaying = useIsPlaying(face?.id ?? '')
  const isLoading = useIsLoading(face?.id ?? '')

  const unratedCount = active.filter((f) => f.face.rating === 0).length

  const move = (delta: number) => {
    if (faces.length === 0) return
    const next = Math.max(0, Math.min(faces.length - 1, (index < 0 ? 0 : index) + delta))
    dispatch({ type: 'SELECT', id: faces[next].id })
  }

  const rate = (r: RatingValue) => {
    if (!face) return
    dispatch({ type: 'MOTIF_RATED', id: face.id, rating: r })
    move(1)
  }

  const discard = () => {
    if (!current) return
    dispatch({ type: 'MOTIF_DISCARDED', id: current.root.id })
    // list shrinks under us — the same index now points at the next family
    if (index >= 0 && index < faces.length - 1) dispatch({ type: 'SELECT', id: faces[index + 1].id })
  }

  const exportMidi = () => {
    if (!face) return
    const tempo = effectiveTempo(state.transport, face)
    downloadBlob(
      new Blob([motifToMidi(face, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
      midiFilename(face, tempo),
    )
  }
  const exportWav = async () => {
    if (!face) return
    const tempo = effectiveTempo(state.transport, face)
    const buf = await renderMotif(face, tempo, {
      drone: state.transport.drone,
      sound: state.transport.sound,
      forceSound: state.transport.forceSound,
    })
    downloadBlob(audioBufferToWavBlob(buf), midiFilename(face, tempo).replace(/\.mid$/, '.wav'))
  }

  // Queue window: 2 done behind, current, upcoming ahead.
  const qStart = Math.max(0, (index < 0 ? 0 : index) - 2)
  const queue = active.slice(qStart, qStart + 6)

  if (!face || !current) {
    return <div className="empty-note">Nothing to triage — generate a batch above.</div>
  }

  const tempo = effectiveTempo(state.transport, face)

  return (
    <>
      <div className="focus-row">
        <div className="focus-lcd">
          <div className="focus-lcd-head">
            <span className="focus-lcd-title">{face.name}</span>
            <span className="focus-lcd-meta">
              {(index < 0 ? 0 : index) + 1} / {active.length} · {face.key} {face.mode} ·{' '}
              {face.bars} bars{face.parts.length > 1 ? ` · ${face.parts.length} parts` : ''}
            </span>
            <span className="spacer" />
            <span className="focus-lcd-right">
              {isPlaying && <span className="focus-lcd-playmark blinking">▶</span>}
              <span className="focus-lcd-bpm">
                {String(tempo).padStart(3, '0')}
                <span> BPM</span>
              </span>
            </span>
          </div>
          <LcdRoll motif={face} height={132} deep minSpan={20} />
          <div className="focus-lcd-foot">
            <span className="legend">
              {(face.parts.length > 0 ? face.parts : [{ name: 'all', instrument: state.transport.sound }]).map(
                (p, i) => (
                  <span key={i}>
                    <i className={`part-swatch ${p.instrument === 'drums' ? 'drums' : `part-${i}`}`} />
                    {p.name} · {p.instrument === 'drums' ? 'GM kit' : p.instrument}
                  </span>
                ),
              )}
            </span>
            {face.rationale && <span className="rationale">“{face.rationale}”</span>}
          </div>
        </div>

        <div className="focus-controls module">
          <div className="focus-transport">
            <button type="button" className="play-round lg" title="Previous (←)" onClick={() => move(-1)}>
              <CaretLeftIcon size={16} />
            </button>
            <Tooltip label="Play/stop (Space)">
              <PlayRound
                size="xl"
                playing={isPlaying}
                loading={isLoading}
                onClick={() => engine.toggle(face, playOpts(face))}
              />
            </Tooltip>
            <button type="button" className="play-round lg" title="Next (→)" onClick={() => move(1)}>
              <CaretRightIcon size={16} />
            </button>
          </div>
          <div className="focus-caption">Prev · Play / Stop · Next</div>
          <div className="focus-ratekeys">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                type="button"
                key={r}
                className="ratekey"
                data-latched={face.rating === r}
                onClick={() => rate(r as RatingValue)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="focus-caption">Rate — auto-advances to next</div>
          <div className="focus-btn-row">
            <Button
              className="danger-text"
              aria-label="Discard"
              onClick={discard}
              leftSection={<XIcon size={11} />}
            >
              <span>
                Discard
              </span>
            </Button>
            <Button
              aria-label="Mutate"
              onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: face.id })}
              leftSection={<ArrowsClockwiseIcon size={11} />}
            >
              <span>
                <Mark className="hk">M</Mark>utate
              </span>
            </Button>
          </div>
          <div className="focus-btn-row">
            <Button onClick={exportMidi}>.MID</Button>
            <Button onClick={() => void exportWav()}>.WAV</Button>
          </div>
        </div>
      </div>

      <div className="queue-strip">
        <div className="queue-head">
          <span className="micro-head">Queue — {unratedCount} unrated remaining</span>
          <span className="kbd-legend">
            <Kbd>space</Kbd> plays · <Kbd>1–5</Kbd> rates &amp; advances · <Kbd>x</Kbd> discards
            &amp; advances
          </span>
        </div>
        <div className="queue-cards">
          {queue.map((f) => {
            const isCurrent = f.face.id === face.id
            const isDone = f.face.rating > 0
            const cls = isCurrent ? 'current' : isDone ? 'done' : ''
            return (
              <div
                key={f.rootId}
                className={`queue-card ${cls}`}
                onClick={() => dispatch({ type: 'SELECT', id: f.face.id })}
              >
                <div className="q-label">
                  {isCurrent ? (
                    <>
                      <CircleIcon size={6} /> {f.face.name}
                    </>
                  ) : isDone ? (
                    <>
                      <CheckIcon size={8} /> {'★'.repeat(f.face.rating)}
                    </>
                  ) : (
                    f.face.name
                  )}
                </div>
                <LcdRoll motif={f.face} height={40} muted={isDone && !isCurrent} queued={!isDone && !isCurrent} />
              </div>
            )
          })}
          {state.pending.map((b) => (
            <div key={b.id} className="queue-card pending">
              <span className="pending-label">Generating {b.count}…</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
