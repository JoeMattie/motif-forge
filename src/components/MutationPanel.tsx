import { useState } from 'react'
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
        <button className="btn small" onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: null })}>
          ✕ close
        </button>
      </div>

      <LineageStrip motif={motif} />

      <div className="mutation-roll">
        <PianoRoll motif={motif} height={140} selectedNotes={selectedNotes} onToggleNote={toggleNote} />
        <span className="dim hint">click notes to select them for octave displacement</span>
      </div>

      <div className="transform-grid">
        <button
          className="btn"
          onClick={() => apply({ type: 'inversion' })}
          title="Flip the contour upside down around the first note — rises become falls"
        >
          inversion
        </button>
        <button
          className="btn"
          onClick={() => apply({ type: 'retrograde' })}
          title="Play the motif backwards in time"
        >
          retrograde
        </button>
        <button
          className="btn"
          onClick={() => apply({ type: 'retrogradeInversion' })}
          title="Backwards and upside down — the most disguised transform"
        >
          retro-inversion
        </button>
        <button
          className="btn"
          onClick={() => apply({ type: 'augment' })}
          title={`Double every duration — same notes at half speed, twice the bars${augmentWarning ? ` (result will be ${motif.bars * 2} bars, beyond the 2–8 bar range)` : ''}`}
        >
          augment ×2{augmentWarning ? ' ⚠' : ''}
        </button>
        <button
          className="btn"
          onClick={() => apply({ type: 'diminish' })}
          title="Halve every duration — same notes at double speed, half the bars"
        >
          diminish ×0.5
        </button>
        <span className="transform-combo">
          <button
            className="btn"
            onClick={() => apply({ type: 'transpose', semitones: transposeBy })}
            title="Shift every pitch by the chosen number of semitones (+12 = up an octave)"
          >
            transpose
          </button>
          <input
            type="number"
            min={-12}
            max={12}
            value={transposeBy}
            onChange={(e) => setTransposeBy(Number(e.target.value))}
            title="Semitones to shift by (negative = down)"
          />
        </span>
        <span className="transform-combo">
          <button
            className="btn"
            onClick={() => apply({ type: 'modeSwap', targetMode })}
            title="Recolor the motif: keep each note's scale degree but re-spell it in the target mode (e.g. dorian → phrygian darkens it)"
          >
            mode swap
          </button>
          <select
            value={targetMode}
            onChange={(e) => setTargetMode(e.target.value as Mode)}
            title="Mode to remap into"
          >
            {MODES.filter((m) => m !== motif.mode).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </span>
        <span className="transform-combo">
          <button
            className="btn"
            disabled={selectedNotes.size === 0}
            onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: 1 })}
            title="Move the notes selected on the roll above up one octave (click notes to select them)"
          >
            8va ↑
          </button>
          <button
            className="btn"
            disabled={selectedNotes.size === 0}
            onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: -1 })}
            title="Move the notes selected on the roll above down one octave (click notes to select them)"
          >
            8vb ↓
          </button>
        </span>
      </div>

      <div className="llm-mutation">
        <textarea
          rows={2}
          placeholder='LLM mutation brief… e.g. "keep the first bar intact but resolve differently", "add a drum groove", "make it more syncopated"'
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <label className="check dim" title="Children keep the parent's exact note timings — only pitches (and velocities) change">
          <input
            type="checkbox"
            checked={lockRhythm}
            onChange={(e) => setLockRhythm(e.target.checked)}
          />
          lock rhythm
        </label>
        <div className="field-row">
          <button
            className="btn primary"
            disabled={busy || !brief.trim()}
            onClick={() => void runLlmMutation(brief)}
          >
            {busy ? 'mutating…' : '5 LLM variations'}
          </button>
          <button
            className="btn surprise"
            disabled={busy}
            onClick={() => void runLlmMutation(SURPRISE_MUTATION_BRIEF)}
            title="Free rein: reinterpret texture, instrumentation, rhythm, or mood while keeping a recognizable kernel"
          >
            🎲 Surprise me
          </button>
        </div>
        {message && <span className="dim">{message}</span>}
      </div>

      {children.length > 0 && (
        <div className="children">
          <div className="dim">children</div>
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
