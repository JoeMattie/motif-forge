import { useEffect, useRef } from 'react'
import type { Motif } from '../types'
import { engine } from '../audio/engine'
import { motifToMidi, midiFilename } from '../core/midi'
import { audioBufferToWavBlob } from '../core/wav'
import { downloadBlob } from '../core/downloads'
import { renderMotif } from '../audio/renderOffline'
import { effectiveTempo } from '../store/appState'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { useIsPlaying } from './hooks/usePlayhead'
import { PianoRoll } from './PianoRoll'

interface MotifCardProps {
  motif: Motif
  selected: boolean
  showConcept?: boolean
}

export function MotifCard({ motif, selected, showConcept }: MotifCardProps) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const isPlaying = useIsPlaying(motif.id)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const tempo = effectiveTempo(state.transport, motif)
  const playOpts = {
    tempo,
    metronome: state.transport.metronome,
    drone: state.transport.drone,
  }

  const exportMidi = () => {
    downloadBlob(
      new Blob([motifToMidi(motif, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
      midiFilename(motif, tempo),
    )
  }

  const exportWav = async () => {
    const buf = await renderMotif(motif, tempo, { drone: state.transport.drone })
    downloadBlob(audioBufferToWavBlob(buf), midiFilename(motif, tempo).replace(/\.mid$/, '.wav'))
  }

  const concept = motif.conceptId ? state.concepts.get(motif.conceptId) : null

  return (
    <div
      ref={cardRef}
      className={`motif-card${selected ? ' selected' : ''}${isPlaying ? ' playing' : ''}${motif.discarded ? ' discarded' : ''}`}
      onClick={() => dispatch({ type: 'SELECT', id: motif.id })}
    >
      <div className="card-head">
        <span className="card-name" title={motif.rationale}>
          {motif.name}
        </span>
        <span className="card-meta">
          {motif.key} {motif.mode} · {motif.bars}b · {motif.tempo}bpm
        </span>
      </div>
      <PianoRoll motif={motif} />
      <div className="card-foot">
        <button
          className="btn play-btn"
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'SELECT', id: motif.id })
            engine.toggle(motif, playOpts)
          }}
          title="Play/stop (Space)"
        >
          {isPlaying ? '■' : '▶'}
        </button>
        <span className="rating">
          {motif.rating > 0 ? '★'.repeat(motif.rating) + '☆'.repeat(5 - motif.rating) : '·····'}
        </span>
        {motif.scaleWarning && (
          <span className="badge warn" title="Contains out-of-scale pitches">
            chr
          </span>
        )}
        {showConcept && concept && <span className="badge concept">{concept.name}</span>}
        <span className="spacer" />
        <button
          className="btn small"
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'SET_MUTATION_TARGET', id: motif.id })
          }}
          title="Mutate"
        >
          mutate
        </button>
        <button
          className="btn small"
          onClick={(e) => {
            e.stopPropagation()
            exportMidi()
          }}
          title="Download MIDI"
        >
          .mid
        </button>
        <button
          className="btn small"
          onClick={(e) => {
            e.stopPropagation()
            void exportWav()
          }}
          title="Download WAV"
        >
          .wav
        </button>
      </div>
    </div>
  )
}
