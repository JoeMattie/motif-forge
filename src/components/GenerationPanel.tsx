import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button,
  Chip,
  NumberInput,
  SegmentedControl,
  Slider,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react'
import type { GenerationBrief, Mode } from '../types'
import { MODES } from '../core/theory'
import { generateBatch } from '../api/generate'
import { generateSymbolicBatch, keepersOf, randomSeed } from '../generation/symbolic'
import {
  enableNeural,
  getNeuralSnapshot,
  removeNeuralModel,
  requestNeuralBatch,
  subscribeNeural,
} from '../generation/neural/client'
import { MODEL_TOTAL_BYTES } from '../generation/neural/manifest'
import { clearStep, getSteps, reportStep, subscribeSteps } from '../generation/activity'
import { enqueue } from '../api/queue'
import { validateBatch, type ValidationResult } from '../core/validate'
import { useAppDispatch, useAppState } from '../store/AppContext'
import type { PendingBatch } from '../store/appState'
import { newId } from '../core/ids'
import { Knob } from './hw/Knob'

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

const INSTANT_CHIP_HINT =
  'Not used by the INSTANT engine — it generates a single melodic line (no parts or drums). Play it through any sound with the transport-strip picker'

type Engine = 'instant' | 'neural' | 'claude'

/** One "run" of generation: batches queued since the queue was last empty. */
interface GenRun {
  total: number
  done: number
}

function useGenerationRun(pending: PendingBatch[]): GenRun | null {
  const seen = useRef<Set<string>>(new Set())
  const [run, setRun] = useState<GenRun | null>(null)
  useEffect(() => {
    const ids = new Set(pending.map((b) => b.id))
    const queued = pending.filter((b) => !seen.current.has(b.id)).length
    const finished = [...seen.current].filter((id) => !ids.has(id)).length
    if (queued === 0 && finished === 0) return
    seen.current = ids
    setRun((prev) => {
      // Batches queued after the previous run drained start a fresh run.
      const base = prev !== null && prev.done < prev.total ? prev : { total: 0, done: 0 }
      return { total: base.total + queued, done: base.done + finished }
    })
  }, [pending])
  return run
}

/** LCD progress strip docked under the module: batch progress while generating
 *  (showing the engine's live technical step from the activity channel when
 *  one is reported), the result message once the run drains. Hidden until the
 *  first run. */
function GenProgress({
  run,
  pending,
  message,
}: {
  run: GenRun | null
  pending: PendingBatch[]
  message: string | null
}) {
  const steps = useSyncExternalStore(subscribeSteps, getSteps)
  if (!run) return null
  const running = run.done < run.total
  const failed = !running && message !== null && /failed|not ready/i.test(message)
  const width = running ? Math.max(8, Math.round((run.done / run.total) * 100)) : 100
  const current = pending[0]
  const step = current ? steps[current.id] : undefined
  // Formatted explicitly (no CSS uppercasing) so labels like "Eb dorian" keep their case.
  const text = running
    ? `GENERATING${run.total > 1 ? ` ${run.done + 1}/${run.total}` : ''} — ${step ?? current?.label ?? ''}`
    : (message ?? 'DONE')
  return (
    <div className={`gen-progress${running ? ' running' : failed ? ' failed' : ''}`}>
      <div className="gen-progress-fill" style={{ width: `${width}%` }} />
      <span className="gen-progress-text">{text}</span>
    </div>
  )
}

/** Neural tier status line shown while the NEURAL engine is selected. */
function NeuralStrip() {
  const neural = useSyncExternalStore(subscribeNeural, getNeuralSnapshot)
  const mb = Math.round(MODEL_TOTAL_BYTES / (1024 * 1024))
  return (
    <div
      className="gen-neural-strip"
      style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}
    >
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
          <span className="micro">READY — LOCAL, OFFLINE</span>
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
  const { concepts, motifs, pending, generation } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)
  // Tracked here (not inside GenProgress) so the run survives collapsing the panel.
  const run = useGenerationRun(pending)
  // The panel docks sticky to the top of the scrolling view; `stuck` adds a
  // floating shadow once anything has scrolled underneath it.
  const dockRef = useRef<HTMLElement | null>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const scroller = dockRef.current?.parentElement
    if (!scroller) return
    const onScroll = () => setStuck(scroller.scrollTop > 2)
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])
  const dockClass = `gen-dock${stuck ? ' stuck' : ''}`
  // Tier-1 offline symbolic engine is the default (spec Phase 6).
  const [engine, setEngine] = useState<Engine>('instant')
  // Symbolic motifs are partless melodic bones — the part/texture chips don't apply.
  const instant = engine === 'instant'
  const [key, setKey] = useState('D')
  const [mode, setMode] = useState<Mode>('dorian')
  const [tempo, setTempo] = useState(100)
  const [bars, setBars] = useState(4)
  const [concept, setConcept] = useState('')
  const [text, setText] = useState('')
  const [allowChromatic, setAllowChromatic] = useState(false)
  const [lead, setLead] = useState(true) // on = 'lead' texture, off = free poly
  const [includeRhythm, setIncludeRhythm] = useState(true)
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

  /** Queue one batch: placeholder appears immediately, results land when ready.
   *  `run` gets a step reporter so the engine can narrate the progress bar. */
  const queueBatch = (
    count: number,
    label: string,
    run: (onStep: (step: string) => void) => Promise<ValidationResult>,
  ) => {
    const batchId = newId()
    const conceptId = resolveConceptId()
    const step = (s: string) => reportStep(batchId, s)
    dispatch({ type: 'BATCH_QUEUED', batch: { id: batchId, count, label } })
    step('queued — waiting for an API slot (2 concurrent)')
    void enqueue(() => run(step))
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
      .finally(() => {
        clearStep(batchId)
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      })
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
    reportStep(batchId, 'tokenizing prompt rows — starting the WebGPU sampler')
    requestNeuralBatch({
      brief,
      n: count,
      keepers: keepersOf(motifs.values()),
      seed: randomSeed(),
      onProgress: (done, total, eventsPerSec) => {
        reportStep(
          batchId,
          `sampling candidate ${Math.min(done + 1, total)}/${total} — ${Math.round(eventsPerSec)} events/s on WebGPU`,
        )
      },
      onMotif: (raw, seed, parentId) => {
        // Streamed one at a time, so the validator's "Motif N" fallback would
        // name every card "Motif 1" — name them from the seed instead.
        const name = `Neural ${(seed >>> 0).toString(16).padStart(8, '0').slice(0, 4)}`
        const result = validateBatch([{ ...raw, name }], {
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
        clearStep(batchId)
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      },
      onError: (message) => {
        dispatch({ type: 'GENERATION_FAILED', message: `Neural generation failed: ${message}` })
        clearStep(batchId)
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
      queueBatch(chunk, label, (onStep) => generateBatch(brief, chunk, onStep))
    }
  }

  // Formatted explicitly (no CSS uppercasing) so flats keep their lowercase b: "Eb", not "EB".
  const enginePrefix = engine === 'instant' ? '' : `${engine.toUpperCase()} · `
  const summary = `${enginePrefix}${key} ${mode.toUpperCase()} · ${tempo} BPM · ${bars} BARS · ${lead ? 'LEAD' : 'POLY'}${extraInstruments ? '+XTRA' : ''}${includeRhythm ? '+RHYTHM' : ''}${allowChromatic ? '+CHR' : ''}`

  const actions = () => (
    <>
      <Tooltip label="Queue a single candidate matching the brief">
        <Button className="green" onClick={() => generate(1)}>
          Generate
        </Button>
      </Tooltip>
      <Tooltip label="Queue one batch of 5 candidates — builds a pool to triage">
        <Button className="dark" onClick={() => generate(5)}>
          Generate +5
        </Button>
      </Tooltip>
    </>
  )

  if (!open) {
    return (
      <section ref={dockRef} className={`module gen-strip ${dockClass}`}>
        <button type="button" className="gen-title" onClick={() => setOpen(true)}>
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
        {actions()}
      </section>
    )
  }

  return (
    <section ref={dockRef} className={`module ${dockClass}`}>
      <div className="gen-strip" style={{ paddingBottom: 0 }}>
        <button type="button" className="gen-title" onClick={() => setOpen(false)}>
          Generate <CaretDownIcon size={10} weight="bold" />
        </button>
      </div>
      <div className="gen-module">
        <div className="gen-knobs">
          <div className="gen-knob-stack">
            <div className="gen-knob-row">
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
            </div>
            <Tooltip label="BPM stored on each candidate; the transport strip can override during audition">
              <div className="gen-ctl">
                <span className="knob-label">tempo</span>
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
              </div>
            </Tooltip>
          </div>
          <Tooltip label="Phrase length in bars of 4/4 — candidates must fill it exactly">
            <div className="gen-ctl">
              <span className="knob-label">bars</span>
              <SegmentedControl
                orientation="vertical"
                value={String(bars)}
                onChange={(v) => setBars(Number(v))}
                data={BARS.map(String)}
              />
            </div>
          </Tooltip>
        </div>
        <div className="gen-divider" />
        <div className="gen-engine">
          <div className="gen-ctl">
            <span className="knob-label">engine</span>
            <SegmentedControl
              value={engine}
              onChange={(v) => setEngine(v as Engine)}
              data={[
                {
                  value: 'instant',
                  label: (
                    <Tooltip label="Offline rules + evolution of your kept motifs (★3+) — free, immediate">
                      <span>INSTANT</span>
                    </Tooltip>
                  ),
                },
                {
                  value: 'neural',
                  label: (
                    <Tooltip label="On-device model (WebGPU, one-time ~226 MB download) — offline; your keepers seed continuations">
                      <span>NEURAL</span>
                    </Tooltip>
                  ),
                },
                {
                  value: 'claude',
                  label: (
                    <Tooltip label="LLM composer — honors the brief text, textures, and drums (needs network)">
                      <span>CLAUDE</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </div>
          {engine === 'neural' && <NeuralStrip />}
        </div>
        <div className="gen-divider" />
        <div className="gen-mid">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span className="micro" style={{ letterSpacing: '.14em' }}>
              Concept · brief
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tooltip
                label={
                  instant
                    ? INSTANT_CHIP_HINT
                    : 'Lead: one clear melodic line with occasional chords (≤4 voices). Off: freely polyphonic (≤6 voices, up to 4 parts)'
                }
              >
                <span className="gen-chip">
                  <Chip checked={lead} onChange={setLead} disabled={instant}>
                    lead
                  </Chip>
                </span>
              </Tooltip>
              <Tooltip
                label={
                  instant
                    ? INSTANT_CHIP_HINT
                    : 'Every candidate includes a drum-kit part (GM percussion) grooving under the melodic material'
                }
              >
                <span className="gen-chip">
                  <Chip checked={includeRhythm} onChange={setIncludeRhythm} disabled={instant}>
                    rhythm
                  </Chip>
                </span>
              </Tooltip>
              <Tooltip
                label={
                  instant
                    ? INSTANT_CHIP_HINT
                    : 'Fuller arrangements: 4–6 parts with distinct roles (lead, counter-line, pad, bass, drums) instead of the default 1–4'
                }
              >
                <span className="gen-chip">
                  <Chip checked={extraInstruments} onChange={setExtraInstruments} disabled={instant}>
                    extra
                  </Chip>
                </span>
              </Tooltip>
              <Tooltip label="Strict: every note stays in the chosen key/mode. Chromatic: notes outside it are welcome (passing tones, color notes) — out-of-scale notes only warn, never discard">
                <SegmentedControl
                  value={allowChromatic ? 'chromatic' : 'strict'}
                  onChange={(v) => setAllowChromatic(v === 'chromatic')}
                  data={[
                    { value: 'strict', label: 'STRICT' },
                    { value: 'chromatic', label: 'CHROMATIC' },
                  ]}
                />
              </Tooltip>
            </div>
          </div>
          <Tooltip label="Song concept / leitmotif tag — candidates are grouped under it in the Concepts view">
            <TextInput
              placeholder="concept — e.g. event horizon"
              value={concept}
              onChange={(e) => setConcept(e.currentTarget.value)}
            />
          </Tooltip>
          <Tooltip label="Free-text direction: contour, rhythmic character, emotional intent, references — anything the composer should honor">
            <Textarea
              rows={2}
              placeholder="Contour, rhythmic character, emotional intent… e.g. slow rise then collapse, sparse and hollow, dread that resolves too late"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
            />
          </Tooltip>
        </div>
        <div className="gen-actions">{actions()}</div>
      </div>
      <GenProgress run={run} pending={pending} message={generation.message} />
    </section>
  )
}
