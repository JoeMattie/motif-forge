import { useEffect, useRef } from 'react'
import { ActionIcon, Badge, Button, Group, Rating, Tooltip } from '@mantine/core'
import type { Motif, Rating as RatingValue } from '../types'
import { engine } from '../audio/engine'
import { motifToMidi, midiFilename } from '../core/midi'
import { audioBufferToWavBlob } from '../core/wav'
import { downloadBlob } from '../core/downloads'
import { renderMotif } from '../audio/renderOffline'
import { effectiveTempo } from '../store/appState'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
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
  const isLoading = useIsLoading(motif.id)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const tempo = effectiveTempo(state.transport, motif)
  const playOpts = {
    tempo,
    metronome: state.transport.metronome,
    drone: state.transport.drone,
    sound: state.transport.sound,
    forceSound: state.transport.forceSound,
  }

  const exportMidi = () => {
    downloadBlob(
      new Blob([motifToMidi(motif, tempo).buffer as ArrayBuffer], { type: 'audio/midi' }),
      midiFilename(motif, tempo),
    )
  }

  const exportWav = async () => {
    const buf = await renderMotif(motif, tempo, {
      drone: state.transport.drone,
      sound: state.transport.sound,
      forceSound: state.transport.forceSound,
    })
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
        {/* undefined (not false) when rationale exists, so the global hints toggle still applies */}
        <Tooltip label={motif.rationale} disabled={motif.rationale ? undefined : true}>
          <span className="card-name">{motif.name}</span>
        </Tooltip>
        <span className="card-meta">
          {motif.key} {motif.mode} · {motif.bars}b · {motif.tempo}bpm
        </span>
      </div>
      <PianoRoll motif={motif} />
      {motif.parts.length > 1 && (
        <div className="part-legend">
          {motif.parts.map((p, i) => (
            <Tooltip
              key={i}
              label={p.preset ? `${p.name}: ${p.preset.oscillator} synth` : p.name}
            >
              <span className={`part-chip part-${i}`}>
                {p.name}·{p.instrument}
              </span>
            </Tooltip>
          ))}
        </div>
      )}
      <Group gap="0.45rem" wrap="nowrap">
        <Tooltip label="Play/stop (Space)">
          <ActionIcon
            className="play-btn"
            variant="default"
            size="lg"
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SELECT', id: motif.id })
              engine.toggle(motif, playOpts)
            }}
          >
            {isLoading ? '…' : isPlaying ? '■' : '▶'}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Rate (keys 1–5 while selected)">
          <Rating
            size="xs"
            value={motif.rating}
            onChange={(r) => dispatch({ type: 'MOTIF_RATED', id: motif.id, rating: r as RatingValue })}
            onClick={(e) => e.stopPropagation()}
          />
        </Tooltip>
        {motif.scaleWarning && (
          <Tooltip label="Contains out-of-scale pitches">
            <Badge color="yellow" size="xs" tt="none">
              chr
            </Badge>
          </Tooltip>
        )}
        {showConcept && concept && (
          <Badge color="blue" size="xs" tt="none">
            {concept.name}
          </Badge>
        )}
        <span className="spacer" />
        <Tooltip label="Open in the mutation panel">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SET_MUTATION_TARGET', id: motif.id })
            }}
          >
            mutate
          </Button>
        </Tooltip>
        <Tooltip label="Download MIDI">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={(e) => {
              e.stopPropagation()
              exportMidi()
            }}
          >
            .mid
          </Button>
        </Tooltip>
        <Tooltip label="Download WAV">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={(e) => {
              e.stopPropagation()
              void exportWav()
            }}
          >
            .wav
          </Button>
        </Tooltip>
      </Group>
    </div>
  )
}
