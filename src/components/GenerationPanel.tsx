import { useState, useSyncExternalStore } from 'react'
import {
  Button,
  NumberInput,
  SegmentedControl,
  Slider,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { CaretDownIcon, CaretRightIcon, DiceFiveIcon } from '@phosphor-icons/react'
import type { GenerationBrief, Mode } from '../types'
import { MODES } from '../core/theory'
import { generateBatch, generateSurpriseBatch } from '../api/generate'
import {
  generateSymbolicBatch,
  generateSymbolicSurprise,
  keepersOf,
  randomSeed,
} from '../generation/symbolic'
import {
  enableNeural,
  getNeuralSnapshot,
  removeNeuralModel,
  requestNeuralBatch,
  subscribeNeural,
} from '../generation/neural/client'
import { MODEL_TOTAL_BYTES } from '../generation/neural/manifest'
import { enqueue } from '../api/queue'
import { validateBatch, type ValidationResult } from '../core/validate'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { Knob } from './hw/Knob'
import { HardToggle } from './hw/HardToggle'

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const BARS = [2, 4, 8]
/** Tick marks at common tempos (ballad → house → d&b). */
const TEMPO_MARKS = [60, 80, 96, 100, 120, 128, 140, 150, 174].map((value) => ({ value }))
const MODE_SHORT: Record<Mode, string> = {
  ionian: 'ION',
  dorian: 'DOR',
  phrygian: 'PHR',
  lydian: 'LYD',
  mixolydian: 'MIX',
  aeolian: 'AEO',
  locrian: 'LOC',
}

const atPosition = <T,>(list: readonly T[], position: number): T =>
  list[Math.max(0, Math.min(list.length - 1, Math.round(position * (list.length - 1))))]

type Engine = 'instant' | 'neural' | 'claude'

/** Neural tier status line shown while the NEURAL engine is selected. */
function NeuralStrip() {
  const neural = useSyncExternalStore(subscribeNeural, getNeuralSnapshot)
  const mb = Math.round(MODEL_TOTAL_BYTES / (1024 * 1024))
  return (
    <div className="gen-neural-strip" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span className="micro" style={{ letterSpacing: '.14em' }}>
        Neural
      </span>
      {neural.state === 'unsupported' && (
        <span className="micro">WEBGPU UNAVAILABLE — INSTANT + CLAUDE ONLY</span>
      )}
      {neural.state === 'idle' && (
        <Tooltip label={`One-time download of the on-device model (~${mb} MB), cached in browser storage. Everything runs locally after that`}>
          <Button className="green" onClick={() => void enableNeural()}>
            <span>Enable · {mb} MB</span>
          </Button>
        </Tooltip>
      )}
      {neural.state === 'downloading' && (
        <span className="micro">DOWNLOADING… {Math.round(neural.progress * 100)}%</span>
      )}
      {neural.state === 'loading' && <span className="micro">LOADING MODEL…</span>}
      {neural.state === 'ready' && (
        <>
          <span className="micro">READY — ON-DEVICE, OFFLINE</span>
          <Tooltip label="Delete the downloaded model from browser storage">
            <Button className="danger-text" onClick={() => void removeNeuralModel()}>
              Remove
            </Button>
          </Tooltip>
        </>
      )}
      {neural.state === 'error' && (
        <>
          <span className="micro" style={{ color: 'var(--danger, #c33)' }}>
            {neural.error?.toUpperCase().slice(0, 80)}
          </span>
          <Button onClick={() => void enableNeural()}>Retry</Button>
        </>
      )}
    </div>
  )
}

export function GenerationPanel() {
  const { concepts, motifs } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)
  // Tier-1 offline source vs the LLM. Claude stays the default until the
  // neural tier lands (spec Phase 6 flips this to 'instant').
  const [engine, setEngine] = useState<Engine>('claude')
  const [key, setKey] = useState('D')
  const [mode, setMode] = useState<Mode>('dorian')
  const [tempo, setTempo] = useState(100)
  const [bars, setBars] = useState(4)
  const [concept, setConcept] = useState('')
  const [text, setText] = useState('')
  const [allowChromatic, setAllowChromatic] = useState(false)
  const [lead, setLead] = useState(true) // on = 'lead' texture, off = free poly
  const [includeRhythm, setIncludeRhythm] = useState(false)
  const [extraInstruments, setExtraInstruments] = useState(false)

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
        const motifs = conceptId ? result.valid.map((m) => ({ ...m, conceptId })) : result.valid
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

  /** Neural batch: candidates stream in one by one as the worker decodes them. */
  const queueNeuralBatch = (count: number, label: string, brief: GenerationBrief) => {
    if (getNeuralSnapshot().state !== 'ready') {
      dispatch({
        type: 'GENERATION_FAILED',
        message: 'Neural model not ready — enable it in the generation panel',
      })
      return
    }
    const batchId = newId()
    const conceptId = resolveConceptId()
    dispatch({ type: 'BATCH_QUEUED', batch: { id: batchId, count, label } })
    let added = 0
    let dropped = 0
    let chromatic = 0
    requestNeuralBatch({
      brief,
      n: count,
      keepers: keepersOf(motifs.values()),
      seed: randomSeed(),
      onMotif: (raw, seed, parentId) => {
        const result = validateBatch([raw], {
          key: brief.key,
          mode: brief.mode,
          bars: brief.bars,
          timeSig: brief.timeSig,
          tempo: brief.tempo,
          allowChromatic: true,
          conceptId,
          source: () => ({ kind: 'neural', batchId, seed, ...(parentId ? { parentId } : {}) }),
        })
        added += result.valid.length
        dropped += result.droppedCount
        chromatic += result.scaleWarningCount
        if (result.valid.length > 0) dispatch({ type: 'MOTIFS_ADDED', motifs: result.valid })
      },
      onDone: () => {
        dispatch({
          type: 'GENERATION_FINISHED',
          message: `${added} added${dropped ? `, ${dropped} dropped` : ''}${chromatic ? `, ${chromatic} chromatic` : ''}`,
        })
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      },
      onError: (message) => {
        dispatch({ type: 'GENERATION_FAILED', message: `Neural generation failed: ${message}` })
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      },
    })
  }

  const buildBrief = (): GenerationBrief => ({
    key,
    mode,
    tempo: Math.max(40, Math.min(220, Math.round(tempo))),
    bars,
    timeSig: '4/4',
    concept,
    text,
    allowChromatic,
    texture: lead ? 'lead' : 'poly',
    includeRhythm,
    extraInstruments,
  })

  const generate = (count: number) => {
    const brief = buildBrief()
    const label = concept.trim() || `${key} ${mode}`
    if (engine === 'instant') {
      // Offline symbolic tier: one deterministic batch, evolved from keepers.
      const keepers = keepersOf(motifs.values())
      queueBatch(count, label, async () => generateSymbolicBatch(brief, count, keepers, randomSeed()))
      return
    }
    if (engine === 'neural') {
      queueNeuralBatch(count, label, brief)
      return
    }
    // Polyphonic motif JSON is bulky — cap each call at 5 motifs so the
    // response fits max_tokens; the queue runs chunks concurrently.
    const chunks: number[] = []
    for (let left = count; left > 0; left -= 5) chunks.push(Math.min(5, left))
    for (const chunk of chunks) {
      queueBatch(chunk, label, () => generateBatch(brief, chunk))
    }
  }

  const surprise = () => {
    if (engine === 'instant') {
      queueBatch(5, 'surprise', async () => generateSymbolicSurprise(5, randomSeed()))
      return
    }
    if (engine === 'neural') {
      // Free rein, neural style: roll the musical frame, let the model play.
      const rolled: GenerationBrief = {
        ...buildBrief(),
        key: KEYS[Math.floor(Math.random() * KEYS.length)],
        mode: MODES[Math.floor(Math.random() * MODES.length)],
        tempo: 70 + Math.floor(Math.random() * 101),
        bars: [2, 4, 8][Math.floor(Math.random() * 3)],
      }
      queueNeuralBatch(5, 'surprise', rolled)
      return
    }
    queueBatch(5, 'surprise', () => generateSurpriseBatch(5))
  }

  // Formatted explicitly (no CSS uppercasing) so flats keep their lowercase b: "Eb", not "EB".
  const enginePrefix = engine === 'claude' ? '' : `${engine.toUpperCase()} · `
  const summary = `${enginePrefix}${key} ${mode.toUpperCase()} · ${tempo} BPM · ${bars} BARS · ${lead ? 'LEAD' : 'POLY'}${extraInstruments ? '+XTRA' : ''}${includeRhythm ? '+RHYTHM' : ''}${allowChromatic ? '+CHR' : ''}`

  const actions = (compact: boolean) => (
    <>
      <Tooltip label="Queue one batch of 5 candidates matching the brief">
        <Button className="green" onClick={() => generate(5)}>
          + 5
        </Button>
      </Tooltip>
      <Tooltip label="Queue four batches of 5 — builds toward a big pool to triage">
        <Button className="dark" onClick={() => generate(20)}>
          + 20
        </Button>
      </Tooltip>
      <Tooltip label="Free rein: the model picks key, mode, tempo, texture, and instrumentation">
        <Button
          onClick={surprise}
          leftSection={compact ? undefined : <DiceFiveIcon size={13} weight="fill" />}
        >
          {compact ? <DiceFiveIcon size={13} weight="fill" /> : 'Surprise'}
        </Button>
      </Tooltip>
    </>
  )

  if (!open) {
    return (
      <section className="module gen-strip">
        <button className="gen-title" onClick={() => setOpen(true)}>
          Generate <CaretRightIcon size={10} weight="bold" />
        </button>
        <span className="gen-summary">
          {summary}
          {concept.trim() && (
            <>
              {' · '}
              <b>{concept.trim()}</b>
            </>
          )}
        </span>
        {text.trim() && <span className="gen-brief-preview">“{text.trim()}”</span>}
        <span className="spacer" />
        {actions(true)}
      </section>
    )
  }

  return (
    <section className="module">
      <div className="gen-strip" style={{ paddingBottom: 0 }}>
        <button className="gen-title" onClick={() => setOpen(false)}>
          Generate <CaretDownIcon size={10} weight="bold" />
        </button>
      </div>
      <div className="gen-module">
        <div className="gen-knobs">
          <Tooltip label="Tonal center all candidates are written in">
            <div>
              <Knob
                label="key"
                value={key}
                position={KEYS.indexOf(key) / (KEYS.length - 1)}
                detents={KEYS.length}
                onPosition={(p) => setKey(atPosition(KEYS, p))}
              />
            </div>
          </Tooltip>
          <Tooltip label="Scale flavor: ionian = major, aeolian = natural minor; dorian/mixolydian sit between, phrygian/locrian are darker, lydian brighter">
            <div>
              <Knob
                label="mode"
                value={MODE_SHORT[mode]}
                position={MODES.indexOf(mode) / (MODES.length - 1)}
                detents={MODES.length}
                onPosition={(p) => setMode(atPosition(MODES, p))}
              />
            </div>
          </Tooltip>
          <Tooltip label="BPM stored on each candidate; the transport strip can override during audition">
            <div className="gen-ctl">
              <div className="gen-tempo-row">
                <Slider
                  w={130}
                  size="sm"
                  min={40}
                  max={220}
                  label={null}
                  marks={TEMPO_MARKS}
                  // dragging snaps to the common tempos; the number input is free-form
                  restrictToMarks
                  value={Math.max(40, Math.min(220, tempo))}
                  onChange={setTempo}
                />
                <NumberInput
                  w={64}
                  size="xs"
                  min={40}
                  max={220}
                  clampBehavior="blur"
                  value={tempo}
                  onChange={(v) => {
                    const n = Number(v)
                    if (Number.isFinite(n) && n > 0) setTempo(Math.round(n))
                  }}
                />
              </div>
              <span className="knob-label">tempo</span>
            </div>
          </Tooltip>
          <Tooltip label="Phrase length in bars of 4/4 — candidates must fill it exactly">
            <div className="gen-ctl">
              <SegmentedControl
                value={String(bars)}
                onChange={(v) => setBars(Number(v))}
                data={BARS.map(String)}
              />
              <span className="knob-label">bars</span>
            </div>
          </Tooltip>
          <Tooltip label="INSTANT: offline rules + evolution of your kept motifs (★3+) — free, immediate. NEURAL: on-device model (WebGPU, one-time ~226 MB download) — offline, keepers seed continuations. CLAUDE: LLM composer (uses brief text, textures, drums)">
            <div className="gen-ctl">
              <SegmentedControl
                value={engine}
                onChange={(v) => setEngine(v as Engine)}
                data={[
                  { value: 'instant', label: 'INSTANT' },
                  { value: 'neural', label: 'NEURAL' },
                  { value: 'claude', label: 'CLAUDE' },
                ]}
              />
              <span className="knob-label">engine</span>
            </div>
          </Tooltip>
        </div>
        {engine === 'neural' && <NeuralStrip />}
        <div className="gen-divider" />
        <div className="gen-mid">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span className="micro" style={{ letterSpacing: '.14em' }}>
              Brief · concept
            </span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Tooltip label="Lead: one clear melodic line with occasional chords (≤4 voices). Off: freely polyphonic (≤6 voices, up to 4 parts)">
                <HardToggle on={lead} label="lead" onChange={setLead} />
              </Tooltip>
              <Tooltip label="Fuller arrangements: 4–6 parts with distinct roles (lead, counter-line, pad, bass, drums) instead of the default 1–4">
                <HardToggle on={extraInstruments} label="extra" onChange={setExtraInstruments} />
              </Tooltip>
              <Tooltip label="Every candidate includes a drum-kit part (GM percussion) grooving under the melodic material">
                <HardToggle on={includeRhythm} label="rhythm" onChange={setIncludeRhythm} />
              </Tooltip>
              <Tooltip label="Allow notes outside the chosen key/mode (passing tones, color notes). Off = strictly in-scale; out-of-scale notes only warn, never discard">
                <HardToggle on={allowChromatic} label="chromatic" onChange={setAllowChromatic} />
              </Tooltip>
            </div>
          </div>
          <Tooltip label="Free-text direction: contour, rhythmic character, emotional intent, references — anything the composer should honor">
            <Textarea
              rows={2}
              placeholder="Contour, rhythmic character, emotional intent… e.g. slow rise then collapse, sparse and hollow, dread that resolves too late"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
            />
          </Tooltip>
          <Tooltip label="Song concept / leitmotif tag — candidates are grouped under it in the Concepts view">
            <TextInput
              placeholder="concept — e.g. event horizon"
              value={concept}
              onChange={(e) => setConcept(e.currentTarget.value)}
            />
          </Tooltip>
        </div>
        <div className="gen-actions">{actions(false)}</div>
      </div>
    </section>
  )
}
