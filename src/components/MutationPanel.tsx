import { useState } from 'react'
import {
  Button,
  Checkbox,
  CloseButton,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import type { Mode, Motif } from '../types'
import { MODES } from '../core/theory'
import { applyTransform, type Transform } from '../core/transforms'
import { mutateBatch } from '../api/generate'
import { enqueue } from '../api/queue'
import { SURPRISE_MUTATION_BRIEF } from '../api/prompts'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { PianoRoll } from './PianoRoll'
import { MotifCard } from './MotifCard'
import { LineageStrip } from './LineageStrip'
import { parentIdOf } from '../types'

export function MutationPanel({ motif }: { motif: Motif }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set())
  const [transposeBy, setTransposeBy] = useState(2)
  const [targetMode, setTargetMode] = useState<Mode>(motif.mode === 'dorian' ? 'phrygian' : 'dorian')
  const [brief, setBrief] = useState('')
  const [lockRhythm, setLockRhythm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const apply = (t: Transform) => {
    const child = applyTransform(motif, t)
    dispatch({ type: 'MOTIFS_ADDED', motifs: [child] })
    if (t.type === 'octaveDisplace') setSelectedNotes(new Set())
  }

  const toggleNote = (i: number) => {
    setSelectedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const runLlmMutation = async (mutationBrief: string) => {
    if (!mutationBrief.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await enqueue(() =>
        mutateBatch(motif, mutationBrief.trim(), 5, { lockRhythm }),
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

  const children = [...state.motifs.values()]
    .filter((m) => parentIdOf(m) === motif.id && !m.discarded)
    .sort((a, b) => a.createdAt - b.createdAt)

  const augmentWarning = motif.bars * 2 > 8

  return (
    <aside className="mutation-panel">
      <div className="panel-head">
        <span>
          Mutate — <b>{motif.name}</b>
        </span>
        <Tooltip label="Close the mutation panel">
          <CloseButton
            size="sm"
            onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: null })}
          />
        </Tooltip>
      </div>

      <LineageStrip motif={motif} />

      <Stack gap={4}>
        <PianoRoll motif={motif} height={140} selectedNotes={selectedNotes} onToggleNote={toggleNote} />
        <Text size="xs" c="dimmed">
          click notes to select them for octave displacement
        </Text>
      </Stack>

      <Group gap="0.45rem">
        <Tooltip label="Flip the contour upside down around the first note — rises become falls">
          <Button onClick={() => apply({ type: 'inversion' })}>inversion</Button>
        </Tooltip>
        <Tooltip label="Play the motif backwards in time">
          <Button onClick={() => apply({ type: 'retrograde' })}>retrograde</Button>
        </Tooltip>
        <Tooltip label="Backwards and upside down — the most disguised transform">
          <Button onClick={() => apply({ type: 'retrogradeInversion' })}>retro-inversion</Button>
        </Tooltip>
        <Tooltip
          label={`Double every duration — same notes at half speed, twice the bars${augmentWarning ? ` (result will be ${motif.bars * 2} bars, beyond the 2–8 bar range)` : ''}`}
        >
          <Button onClick={() => apply({ type: 'augment' })}>
            augment ×2{augmentWarning ? ' ⚠' : ''}
          </Button>
        </Tooltip>
        <Tooltip label="Halve every duration — same notes at double speed, half the bars">
          <Button onClick={() => apply({ type: 'diminish' })}>diminish ×0.5</Button>
        </Tooltip>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Shift every pitch by the chosen number of semitones (+12 = up an octave)">
            <Button onClick={() => apply({ type: 'transpose', semitones: transposeBy })}>
              transpose
            </Button>
          </Tooltip>
          <Tooltip label="Semitones to shift by (negative = down)">
            <NumberInput
              w={64}
              min={-12}
              max={12}
              value={transposeBy}
              onChange={(v) => setTransposeBy(Number(v) || 0)}
            />
          </Tooltip>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Recolor the motif: keep each note's scale degree but re-spell it in the target mode (e.g. dorian → phrygian darkens it)">
            <Button onClick={() => apply({ type: 'modeSwap', targetMode })}>mode swap</Button>
          </Tooltip>
          <Tooltip label="Mode to remap into">
            <Select
              w={120}
              value={targetMode}
              onChange={(v) => v && setTargetMode(v as Mode)}
              data={MODES.filter((m) => m !== motif.mode)}
            />
          </Tooltip>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Move the notes selected on the roll above up one octave (click notes to select them)">
            <Button
              disabled={selectedNotes.size === 0}
              onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: 1 })}
            >
              8va ↑
            </Button>
          </Tooltip>
          <Tooltip label="Move the notes selected on the roll above down one octave (click notes to select them)">
            <Button
              disabled={selectedNotes.size === 0}
              onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: -1 })}
            >
              8vb ↓
            </Button>
          </Tooltip>
        </Group>
      </Group>

      <Stack gap="0.45rem">
        <Textarea
          rows={2}
          placeholder='LLM mutation brief… e.g. "keep the first bar intact but resolve differently", "add a drum groove", "make it more syncopated"'
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
        />
        <Tooltip label="Children keep the parent's exact note timings — only pitches (and velocities) change">
          <Checkbox
            label="lock rhythm"
            checked={lockRhythm}
            onChange={(e) => setLockRhythm(e.currentTarget.checked)}
          />
        </Tooltip>
        <Group gap="0.75rem">
          <Button
            variant="filled"
            disabled={busy || !brief.trim()}
            onClick={() => void runLlmMutation(brief)}
          >
            {busy ? 'mutating…' : '5 LLM variations'}
          </Button>
          <Tooltip label="Free rein: reinterpret texture, instrumentation, rhythm, or mood while keeping a recognizable kernel">
            <Button
              variant="outline"
              color="yellow"
              disabled={busy}
              onClick={() => void runLlmMutation(SURPRISE_MUTATION_BRIEF)}
            >
              🎲 Surprise me
            </Button>
          </Tooltip>
        </Group>
        {message && (
          <Text size="sm" c="dimmed">
            {message}
          </Text>
        )}
      </Stack>

      {children.length > 0 && (
        <div className="children">
          <Text size="sm" c="dimmed">
            children
          </Text>
          <div className="children-grid">
            {children.map((c) => (
              <MotifCard key={c.id} motif={c} selected={c.id === state.selectedId} />
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
