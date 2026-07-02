import type { Motif } from '../types'
import { beatsPerBar, isInScale } from '../core/theory'
import { usePlayhead } from './hooks/usePlayhead'

interface PianoRollProps {
  motif: Motif
  height?: number
  /** Interactive mode: click notes to toggle selection (octave displacement UI). */
  selectedNotes?: Set<number>
  onToggleNote?: (index: number) => void
}

const PAD = 2 // semitones of vertical padding around the pitch span

export function PianoRoll({ motif, height = 96, selectedNotes, onToggleNote }: PianoRollProps) {
  const { isPlaying, playheadRef } = usePlayhead(motif.id)
  const totalBeats = motif.bars * beatsPerBar(motif.timeSig)
  const bpb = beatsPerBar(motif.timeSig)

  const pitches = motif.notes.map((n) => n.pitch)
  const lo = Math.min(...pitches) - PAD
  const hi = Math.max(...pitches) + PAD
  const span = hi - lo

  const interactive = onToggleNote !== undefined

  return (
    <svg
      className={`piano-roll${isPlaying ? ' playing' : ''}`}
      viewBox={`0 0 ${totalBeats} ${span}`}
      preserveAspectRatio="none"
      style={{ height, width: '100%', display: 'block' }}
    >
      {/* bar lines */}
      {Array.from({ length: motif.bars - 1 }, (_, i) => (
        <line
          key={`bar-${i}`}
          x1={(i + 1) * bpb}
          x2={(i + 1) * bpb}
          y1={0}
          y2={span}
          className="roll-barline"
        />
      ))}
      {/* beat lines */}
      {Array.from({ length: totalBeats - 1 }, (_, i) =>
        (i + 1) % bpb === 0 ? null : (
          <line
            key={`beat-${i}`}
            x1={i + 1}
            x2={i + 1}
            y1={0}
            y2={span}
            className="roll-beatline"
          />
        ),
      )}
      {/* notes */}
      {motif.notes.map((n, i) => {
        const outOfScale = !isInScale(n.pitch, motif.key, motif.mode)
        const selected = selectedNotes?.has(i) ?? false
        const part = n.part ?? 0
        return (
          <rect
            key={i}
            x={n.startBeat}
            y={hi - n.pitch - 0.5}
            width={n.durationBeats}
            height={1}
            rx={0.08}
            className={`roll-note part-${part}${outOfScale ? ' chromatic' : ''}${selected ? ' selected' : ''}${interactive ? ' clickable' : ''}`}
            opacity={0.55 + (n.velocity / 127) * 0.45}
            onClick={interactive ? () => onToggleNote(i) : undefined}
          />
        )
      })}
      {/* playhead */}
      {isPlaying && (
        <line ref={playheadRef} x1={0} x2={0} y1={0} y2={span} className="roll-playhead" />
      )}
    </svg>
  )
}
