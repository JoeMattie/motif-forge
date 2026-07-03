import type { Motif } from '../types'
import { beatsPerBar, isInScale } from '../core/theory'
import { usePlayhead } from './hooks/usePlayhead'

interface LcdRollProps {
  motif: Motif
  height?: number
  /** Deep-black inner surface (large focus LCD). */
  deep?: boolean
  /** Part indices rendered dimmed (locked/context parts in variant rolls). */
  dimParts?: Set<number>
  /** All notes in the muted green-gray (discarded/done cards). */
  muted?: boolean
  /** Queued-but-not-yet-triaged look (queue strip upcoming cards). */
  queued?: boolean
  /** Interactive mode: click notes to toggle selection (octave displacement UI). */
  selectedNotes?: Set<number>
  onToggleNote?: (index: number) => void
  /** Minimum vertical span in semitones — keeps note bars thin on tall LCDs
   * when the motif's pitch range is narrow (the range is centered). */
  minSpan?: number
}

const PAD = 2 // semitones of vertical padding around the pitch span
const DRUM_LANE = 2.4 // pitch-units reserved at the bottom for drum ticks

/**
 * Inset dark LCD screen rendering the motif as a multi-part piano roll.
 * Melodic parts map pitch → y; drum-part notes draw as short ticks on a
 * bottom lane. Velocity maps to opacity (~0.55–1). The playhead is a 2px
 * orange sweep driven by one rAF loop outside React.
 */
export function LcdRoll({
  motif,
  height = 88,
  deep,
  dimParts,
  muted,
  queued,
  selectedNotes,
  onToggleNote,
  minSpan,
}: LcdRollProps) {
  const { isPlaying, playheadRef } = usePlayhead(motif.id)
  const bpb = beatsPerBar(motif.timeSig)
  const totalBeats = motif.bars * bpb

  const isDrum = (part: number | undefined) =>
    motif.parts.length > 0 &&
    motif.parts[Math.min(part ?? 0, motif.parts.length - 1)].instrument === 'drums'

  const melodic = motif.notes.filter((n) => !isDrum(n.part))
  const hasDrums = melodic.length < motif.notes.length
  const pitches = (melodic.length > 0 ? melodic : motif.notes).map((n) => n.pitch)
  let lo = Math.min(...pitches) - PAD
  let hi = Math.max(...pitches) + PAD
  if (minSpan !== undefined && hi - lo < minSpan) {
    const extra = (minSpan - (hi - lo)) / 2
    lo -= extra
    hi += extra
  }
  const span = hi - lo + (hasDrums ? DRUM_LANE : 0)

  const interactive = onToggleNote !== undefined

  return (
    <div className={`lcd${deep ? ' deep' : ''}`} style={{ height }}>
      <svg
        role="img"
        aria-label={`Piano roll: ${motif.name}`}
        viewBox={`0 0 ${totalBeats} ${span}`}
        preserveAspectRatio="none"
        style={{ height: '100%' }}
      >
        {/* beat lines under bar lines */}
        {Array.from({ length: totalBeats - 1 }, (_, i) =>
          (i + 1) % bpb === 0 ? null : (
            <line key={`beat-${i}`} x1={i + 1} x2={i + 1} y1={0} y2={span} className="roll-beatline" />
          ),
        )}
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
        {/* notes */}
        {motif.notes.map((n, i) => {
          const part = n.part ?? 0
          const drum = isDrum(n.part)
          const outOfScale = !drum && !isInScale(n.pitch, motif.key, motif.mode)
          const selected = selectedNotes?.has(i) ?? false
          const dimmed = dimParts?.has(part) ?? false
          const cls = [
            'roll-note',
            drum ? 'drums' : `part-${part}`,
            outOfScale ? 'chromatic' : '',
            muted || queued ? 'muted' : '',
            selected ? 'selected' : '',
            interactive ? 'clickable' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const baseOpacity = 0.55 + (n.velocity / 127) * 0.45
          return (
            <rect
              key={i}
              x={n.startBeat}
              y={drum ? span - DRUM_LANE * 0.7 : hi - n.pitch - 0.5}
              width={drum ? Math.min(n.durationBeats, totalBeats / 34) : n.durationBeats}
              height={drum ? DRUM_LANE * 0.42 : 1}
              rx={0.08}
              className={cls}
              opacity={dimmed ? baseOpacity * 0.5 : baseOpacity}
              onClick={
                interactive
                  ? (e) => {
                      e.stopPropagation()
                      onToggleNote(i)
                    }
                  : undefined
              }
            />
          )
        })}
        {/* playhead */}
        {isPlaying && (
          <line ref={playheadRef} x1={0} x2={0} y1={0} y2={span} className="roll-playhead" />
        )}
      </svg>
    </div>
  )
}
