import { useState } from 'react'
import type { GenerationBrief, Mode } from '../types'
import { MODES } from '../core/theory'
import { generateBatch } from '../api/generate'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function GenerationPanel() {
  const { generation, concepts } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(true)
  const [key, setKey] = useState('D')
  const [mode, setMode] = useState<Mode>('dorian')
  const [tempo, setTempo] = useState(100)
  const [bars, setBars] = useState(4)
  const [concept, setConcept] = useState('')
  const [text, setText] = useState('')
  const [allowChromatic, setAllowChromatic] = useState(false)

  const generate = async (count: number) => {
    const brief: GenerationBrief = {
      key,
      mode,
      tempo,
      bars,
      timeSig: '4/4',
      concept,
      text,
      allowChromatic,
    }
    dispatch({ type: 'GENERATION_STARTED' })
    try {
      // Two parallel calls of count/2 — faster, and independent samples add variety.
      const per = Math.ceil(count / 2)
      const results = await Promise.allSettled([generateBatch(brief, per), generateBatch(brief, per)])
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
      if (ok.length === 0) {
        const err = results[0].status === 'rejected' ? String(results[0].reason) : 'unknown error'
        dispatch({ type: 'GENERATION_FAILED', message: `Generation failed: ${err.slice(0, 120)}` })
        return
      }
      let motifs = ok.flatMap((r) => r.valid)
      const dropped = ok.reduce((s, r) => s + r.droppedCount, 0)
      const warned = ok.reduce((s, r) => s + r.scaleWarningCount, 0)

      // Attach to a concept if named: reuse an existing one or create it.
      if (concept.trim()) {
        const existing = [...concepts.values()].find(
          (c) => c.name.toLowerCase() === concept.trim().toLowerCase(),
        )
        const conceptId = existing?.id ?? newId()
        if (!existing) {
          dispatch({
            type: 'CONCEPT_CREATED',
            concept: { id: conceptId, name: concept.trim(), createdAt: Date.now() },
          })
        }
        motifs = motifs.map((m) => ({ ...m, conceptId }))
      }

      dispatch({ type: 'MOTIFS_ADDED', motifs })
      dispatch({
        type: 'GENERATION_FINISHED',
        message: `${motifs.length} added${dropped ? `, ${dropped} dropped` : ''}${warned ? `, ${warned} chromatic` : ''}${results.some((r) => r.status === 'rejected') ? ' (one batch failed)' : ''}`,
      })
    } catch (e) {
      dispatch({ type: 'GENERATION_FAILED', message: `Generation failed: ${String(e).slice(0, 120)}` })
    }
  }

  return (
    <section className={`gen-panel${open ? '' : ' collapsed'}`}>
      <div className="panel-head" onClick={() => setOpen(!open)}>
        <span>Generate</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="panel-body">
          <div className="field-row">
            <label>
              key
              <select value={key} onChange={(e) => setKey(e.target.value)}>
                {KEYS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              mode
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              tempo
              <input
                type="number"
                min={40}
                max={220}
                value={tempo}
                onChange={(e) => setTempo(Number(e.target.value))}
              />
            </label>
            <label>
              bars
              <select value={bars} onChange={(e) => setBars(Number(e.target.value))}>
                {[2, 4, 8].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={allowChromatic}
                onChange={(e) => setAllowChromatic(e.target.checked)}
              />
              chromatic ok
            </label>
          </div>
          <div className="field-row">
            <label className="grow">
              concept
              <input
                type="text"
                placeholder="e.g. event horizon"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
              />
            </label>
          </div>
          <label className="grow">
            brief
            <textarea
              rows={3}
              placeholder="Contour, rhythmic character, emotional intent… e.g. slow rise then collapse, sparse and hollow, dread that resolves too late"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="field-row">
            <button className="btn primary" disabled={generation.busy} onClick={() => void generate(20)}>
              {generation.busy ? 'generating…' : 'Generate 20'}
            </button>
            <button className="btn" disabled={generation.busy} onClick={() => void generate(10)}>
              Generate 10
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
