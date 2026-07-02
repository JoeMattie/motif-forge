import { useState } from 'react'
import type { GenerationBrief, Mode, Texture } from '../types'
import { MODES } from '../core/theory'
import { generateBatch, generateSurpriseBatch } from '../api/generate'
import { enqueue } from '../api/queue'
import type { ValidationResult } from '../core/validate'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function GenerationPanel() {
  const { concepts } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(true)
  const [key, setKey] = useState('D')
  const [mode, setMode] = useState<Mode>('dorian')
  const [tempo, setTempo] = useState(100)
  const [bars, setBars] = useState(4)
  const [concept, setConcept] = useState('')
  const [text, setText] = useState('')
  const [allowChromatic, setAllowChromatic] = useState(false)
  const [texture, setTexture] = useState<Texture>('lead')
  const [includeRhythm, setIncludeRhythm] = useState(false)

  /** Reuse or create the named concept; returns its id (or null when unnamed). */
  const resolveConceptId = (): string | null => {
    const name = concept.trim()
    if (!name) return null
    const existing = [...concepts.values()].find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing.id
    const id = newId()
    dispatch({ type: 'CONCEPT_CREATED', concept: { id, name, createdAt: Date.now() } })
    return id
  }

  /** Queue one batch: placeholder appears immediately, results land when ready. */
  const queueBatch = (count: number, label: string, run: () => Promise<ValidationResult>) => {
    const batchId = newId()
    const conceptId = resolveConceptId()
    dispatch({ type: 'BATCH_QUEUED', batch: { id: batchId, count, label } })
    void enqueue(run)
      .then((result) => {
        const motifs = conceptId
          ? result.valid.map((m) => ({ ...m, conceptId }))
          : result.valid
        dispatch({ type: 'MOTIFS_ADDED', motifs })
        dispatch({
          type: 'GENERATION_FINISHED',
          message: `${motifs.length} added${result.droppedCount ? `, ${result.droppedCount} dropped` : ''}${result.scaleWarningCount ? `, ${result.scaleWarningCount} chromatic` : ''}`,
        })
      })
      .catch((e) => {
        dispatch({ type: 'GENERATION_FAILED', message: `Generation failed: ${String(e).slice(0, 120)}` })
      })
      .finally(() => dispatch({ type: 'BATCH_FINISHED', id: batchId }))
  }

  const generate = (count: number) => {
    const brief: GenerationBrief = {
      key,
      mode,
      tempo,
      bars,
      timeSig: '4/4',
      concept,
      text,
      allowChromatic,
      texture,
      includeRhythm,
    }
    const label = concept.trim() || `${key} ${mode}`
    // Single call for small batches; split above 10 so JSON fits max_tokens.
    const chunks = count <= 10 ? [count] : [Math.ceil(count / 2), Math.floor(count / 2)]
    for (const chunk of chunks) {
      queueBatch(chunk, label, () => generateBatch(brief, chunk))
    }
  }

  const surprise = () => {
    queueBatch(5, 'surprise', () => generateSurpriseBatch(5))
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
            <label>
              texture
              <select value={texture} onChange={(e) => setTexture(e.target.value as Texture)}>
                <option value="lead">lead + light harmony</option>
                <option value="poly">freely polyphonic</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={includeRhythm}
                onChange={(e) => setIncludeRhythm(e.target.checked)}
              />
              rhythm part
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
            <button className="btn primary" onClick={() => generate(5)}>
              Generate 5
            </button>
            <button className="btn" onClick={() => generate(20)}>
              Generate 20
            </button>
            <span className="spacer" />
            <button className="btn surprise" onClick={surprise} title="Free rein: the model picks key, mode, tempo, texture, and instrumentation">
              🎲 Surprise me
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
