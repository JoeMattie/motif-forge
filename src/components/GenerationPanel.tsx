import { useState } from 'react'
import {
  Button,
  Checkbox,
  Chip,
  Collapse,
  Fieldset,
  Group,
  NumberInput,
  Select,
  Stack,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
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
    // Polyphonic motif JSON is bulky — cap each call at 5 motifs so the
    // response fits max_tokens; the queue runs chunks concurrently.
    const chunks: number[] = []
    for (let left = count; left > 0; left -= 5) chunks.push(Math.min(5, left))
    for (const chunk of chunks) {
      queueBatch(chunk, label, () => generateBatch(brief, chunk))
    }
  }

  const surprise = () => {
    queueBatch(5, 'surprise', () => generateSurpriseBatch(5))
  }

  return (
    <section className="gen-panel">
      <div className="panel-head" onClick={() => setOpen(!open)}>
        <span>Generate</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </div>
      <Collapse expanded={open}>
        <Stack gap="0.6rem" px="0.8rem" pb="0.8rem">
          <Group gap="0.75rem" align="flex-end">
            <Tooltip label="Tonal center all candidates are written in">
              <Select label="key" w={72} value={key} onChange={(v) => v && setKey(v)} data={KEYS} />
            </Tooltip>
            <Tooltip label="Scale flavor: ionian = major, aeolian = natural minor; dorian/mixolydian sit between, phrygian/locrian are darker, lydian brighter">
              <Select
                label="mode"
                w={120}
                value={mode}
                onChange={(v) => v && setMode(v as Mode)}
                data={MODES}
              />
            </Tooltip>
            <Tooltip label="BPM stored on each candidate; the transport bar can override during audition">
              <NumberInput
                label="tempo"
                w={80}
                min={40}
                max={220}
                value={tempo}
                onChange={(v) => setTempo(Number(v) || 100)}
              />
            </Tooltip>
            <Tooltip label="Phrase length in bars of 4/4 — candidates must fill it exactly">
              <Select
                label="bars"
                w={64}
                value={String(bars)}
                onChange={(v) => v && setBars(Number(v))}
                data={['2', '4', '8']}
              />
            </Tooltip>
            <Tooltip label="Lead: one clear melodic line with occasional chords (≤4 voices). Poly: chords, pads, and counterpoint welcome (≤6 voices, up to 4 parts)">
              <Fieldset legend="texture">
                <Chip.Group
                  multiple={false}
                  value={texture}
                  onChange={(v) => v && setTexture(v as Texture)}
                >
                  <Group gap="0.4rem" wrap="nowrap">
                    <Chip value="lead">lead + light harmony</Chip>
                    <Chip value="poly">freely polyphonic</Chip>
                  </Group>
                </Chip.Group>
              </Fieldset>
            </Tooltip>
            <Tooltip label="Every candidate includes a drum-kit part (GM percussion) grooving under the melodic material">
              <Checkbox
                className="check"
                label="rhythm part"
                checked={includeRhythm}
                onChange={(e) => setIncludeRhythm(e.currentTarget.checked)}
              />
            </Tooltip>
            <Tooltip label="Allow notes outside the chosen key/mode (passing tones, color notes). Off = strictly in-scale; out-of-scale notes only warn, never discard">
              <Checkbox
                className="check"
                label="chromatic ok"
                checked={allowChromatic}
                onChange={(e) => setAllowChromatic(e.currentTarget.checked)}
              />
            </Tooltip>
          </Group>
          <Tooltip label="Song concept / leitmotif tag — candidates are grouped under it in the Concepts view">
            <TextInput
              label="concept"
              placeholder="e.g. event horizon"
              value={concept}
              onChange={(e) => setConcept(e.currentTarget.value)}
            />
          </Tooltip>
          <Tooltip label="Free-text direction: contour, rhythmic character, emotional intent, references — anything the composer should honor">
            <Textarea
              label="brief"
              rows={3}
              placeholder="Contour, rhythmic character, emotional intent… e.g. slow rise then collapse, sparse and hollow, dread that resolves too late"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
            />
          </Tooltip>
          <Group gap="0.75rem">
            <Tooltip label="Queue one batch of 5 candidates matching the brief">
              <Button variant="filled" onClick={() => generate(5)}>
                Generate 5
              </Button>
            </Tooltip>
            <Tooltip label="Queue four batches of 5 — builds toward a big pool to triage">
              <Button onClick={() => generate(20)}>Generate 20</Button>
            </Tooltip>
            <span className="spacer" />
            <Tooltip label="Free rein: the model picks key, mode, tempo, texture, and instrumentation">
              <Button variant="outline" color="yellow" onClick={surprise}>
                🎲 Surprise me
              </Button>
            </Tooltip>
          </Group>
        </Stack>
      </Collapse>
    </section>
  )
}
