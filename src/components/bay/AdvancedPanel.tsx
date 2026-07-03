import { useState } from 'react'
import { Button, NumberInput, Select, Textarea, Tooltip } from '@mantine/core'
import { CaretRightIcon } from '@phosphor-icons/react'
import type { Mode, Motif, Note } from '../../types'
import { MODES } from '../../core/theory'
import type { Transform } from '../../core/transforms'
import { HardToggle } from '../hw/HardToggle'
import { LcdRoll } from '../LcdRoll'

/**
 * Per-part advanced controls: deterministic transforms + a custom LLM brief,
 * all scoped to the row's focused take. Results become tree nodes like
 * everything else. Aug/Dim are omitted on purpose — they change the bar count
 * of one part, which would break the composite's alignment.
 */
export function AdvancedPanel({
  source,
  partIndex,
  isDrums,
  baseTake,
  focusLabel,
  busy,
  onApplyTransform,
  onRunBrief,
}: {
  source: Motif
  partIndex: number
  isDrums: boolean
  /** Notes of the focused take this panel operates on (origin or a tree node). */
  baseTake: Note[]
  /** Where results will branch from, for the header ("origin" or a node label). */
  focusLabel: string
  busy: boolean
  onApplyTransform: (t: Transform) => void
  onRunBrief: (brief: string, lockRhythm: boolean) => void
}) {
  const [brief, setBrief] = useState('')
  const [lockRhythm, setLockRhythm] = useState(false)
  const [transposeBy, setTransposeBy] = useState(2)
  const [targetMode, setTargetMode] = useState<Mode>(
    source.mode === 'dorian' ? 'phrygian' : 'dorian',
  )
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set())

  const toggleNote = (i: number) =>
    setSelectedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const apply = (t: Transform) => {
    onApplyTransform(t)
    if (t.type === 'octaveDisplace') setSelectedNotes(new Set())
  }

  const pitchTip = isDrums ? 'Pitch transforms are disabled on drum parts' : undefined

  return (
    <div className="advanced-panel">
      <div className="bay-head-row">
        <span className="micro-head">Advanced — branches from {focusLabel}</span>
        <span className="micro-dim">transforms are instant · brief runs 5 LLM takes</span>
      </div>
      <LcdRoll
        motif={{ ...source, id: `adv:${source.id}:${partIndex}`, notes: baseTake }}
        height={84}
        selectedNotes={selectedNotes}
        onToggleNote={toggleNote}
      />
      <div className="transform-aux">
        <Tooltip label={pitchTip ?? 'Flip the contour upside down around the first note'}>
          <Button disabled={isDrums} onClick={() => apply({ type: 'inversion' })}>
            Invert
          </Button>
        </Tooltip>
        <Tooltip label="Play the take backwards in time">
          <Button onClick={() => apply({ type: 'retrograde' })}>Retro</Button>
        </Tooltip>
        <Tooltip label={pitchTip ?? 'Backwards and upside down — the most disguised transform'}>
          <Button disabled={isDrums} onClick={() => apply({ type: 'retrogradeInversion' })}>
            R-Inv
          </Button>
        </Tooltip>
        <Tooltip label={pitchTip ?? 'Shift every pitch by the chosen number of semitones'}>
          <Button disabled={isDrums} onClick={() => apply({ type: 'transpose', semitones: transposeBy })}>
            Transpose
          </Button>
        </Tooltip>
        <NumberInput
          w={62}
          size="xs"
          min={-12}
          max={12}
          value={transposeBy}
          onChange={(v) => setTransposeBy(Number(v) || 0)}
        />
        <Tooltip label={pitchTip ?? "Keep each note's scale degree but re-spell it in the target mode"}>
          <Button disabled={isDrums} onClick={() => apply({ type: 'modeSwap', targetMode })}>
            Mode swap
          </Button>
        </Tooltip>
        <Select
          w={110}
          size="xs"
          value={targetMode}
          onChange={(v) => v && setTargetMode(v as Mode)}
          data={MODES.filter((m) => m !== source.mode)}
        />
        <Tooltip label={pitchTip ?? 'Move the notes selected on the LCD up an octave (click notes to select)'}>
          <Button
            disabled={isDrums || selectedNotes.size === 0}
            onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: 1 })}
          >
            8va ↑
          </Button>
        </Tooltip>
        <Tooltip label={pitchTip ?? 'Move the notes selected on the LCD down an octave'}>
          <Button
            disabled={isDrums || selectedNotes.size === 0}
            onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: -1 })}
          >
            8vb ↓
          </Button>
        </Tooltip>
      </div>
      <div className="llm-section">
        <Textarea
          rows={2}
          placeholder={`e.g. "make the ${isDrums ? 'groove sparser, half-time feel' : 'line more syncopated, land phrase ends on the 5th'}"`}
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
        />
        <div className="transform-aux">
          <Tooltip label="Takes keep this take's exact note timings — only pitches (and velocities) change">
            <HardToggle on={lockRhythm} label="lock rhythm" onChange={setLockRhythm} />
          </Tooltip>
          <span className="spacer" />
          <Tooltip label="Run 5 LLM takes on this part with your brief — every other part locked">
            <Button
              className="accent"
              disabled={busy || !brief.trim()}
              onClick={() => onRunBrief(brief.trim(), lockRhythm)}
              rightSection={busy ? undefined : <CaretRightIcon size={10} weight="fill" />}
            >
              {busy ? 'Running…' : 'Run'}
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
