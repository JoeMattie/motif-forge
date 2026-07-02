import { useState } from 'react'
import type { Mode, Motif } from '../types'
import { MODES } from '../core/theory'
import { applyTransform, type Transform } from '../core/transforms'
import { mutateBatch } from '../api/generate'
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

  const runLlmMutation = async () => {
    if (!brief.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await mutateBatch(motif, brief.trim(), 10)
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
        <button className="btn" onClick={() => apply({ type: 'inversion' })}>inversion</button>
        <button className="btn" onClick={() => apply({ type: 'retrograde' })}>retrograde</button>
        <button className="btn" onClick={() => apply({ type: 'retrogradeInversion' })}>retro-inversion</button>
        <button
          className="btn"
          onClick={() => apply({ type: 'augment' })}
          title={augmentWarning ? `Result will be ${motif.bars * 2} bars (beyond the 2–8 bar range)` : undefined}
        >
          augment ×2{augmentWarning ? ' ⚠' : ''}
        </button>
        <button className="btn" onClick={() => apply({ type: 'diminish' })}>diminish ×0.5</button>
        <span className="transform-combo">
          <button className="btn" onClick={() => apply({ type: 'transpose', semitones: transposeBy })}>
            transpose
          </button>
          <input
            type="number"
            min={-12}
            max={12}
            value={transposeBy}
            onChange={(e) => setTransposeBy(Number(e.target.value))}
          />
        </span>
        <span className="transform-combo">
          <button className="btn" onClick={() => apply({ type: 'modeSwap', targetMode })}>
            mode swap
          </button>
          <select value={targetMode} onChange={(e) => setTargetMode(e.target.value as Mode)}>
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
          >
            8va ↑
          </button>
          <button
            className="btn"
            disabled={selectedNotes.size === 0}
            onClick={() => apply({ type: 'octaveDisplace', noteIndices: [...selectedNotes], direction: -1 })}
          >
            8vb ↓
          </button>
        </span>
      </div>

      <div className="llm-mutation">
        <textarea
          rows={2}
          placeholder='LLM mutation brief… e.g. "keep the first bar intact but resolve differently", "make it more syncopated"'
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !brief.trim()} onClick={() => void runLlmMutation()}>
          {busy ? 'mutating…' : '10 LLM variations'}
        </button>
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
