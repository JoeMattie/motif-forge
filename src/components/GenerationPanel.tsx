import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ActionIcon,
  Autocomplete,
  Button,
  Chip,
  NumberInput,
  SegmentedControl,
  Slider,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { CaretDownIcon, CaretRightIcon, DiceFiveIcon } from '@phosphor-icons/react'
import type { GenerationBrief, Mode, Motif, SynthPreset, Voicing } from '../types'
import { MODES } from '../core/theory'
import { generateBatch } from '../api/generate'
import {
  fitnessScore,
  generateSymbolicBatch,
  keepersOf,
  melodicLine,
  randomSeed,
} from '../generation/symbolic'
import {
  generateGeneticBatch,
  type GeneticPresetChoice,
  RIFF_PRESET_NAMES,
} from '../generation/genetic'
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
import { getAnthropicKey, useClaudeReady } from '../uiPrefs'
import { CircleOfFifths, KeySignature } from './hw/CircleOfFifths'

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

/** Brief parameters that can be re-rolled per generation via the dice toggles.
 * 'parts' covers the lead/rhythm/extra toggles together with one dice. */
type DiceParam = 'key' | 'mode' | 'bars' | 'tempo' | 'groove' | 'parts' | 'voicing' | 'chromatic'

const NO_DICE: Record<DiceParam, boolean> = {
  key: false,
  mode: false,
  bars: false,
  tempo: false,
  groove: false,
  parts: false,
  voicing: false,
  chromatic: false,
}

// Dice rolls happen at the call site, like randomSeed() — the seeded-PRNG rule
// only binds inside generators, and every rolled value lands in the brief, so
// motifs stay reproducible from their stored metadata.
const rollFrom = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]
const coin = () => Math.random() < 0.5

/** A plausible synth patch rolled per candidate: never the plain default wave,
 * envelope biased snappy with the occasional slow pad. */
const rollSynthPreset = (): SynthPreset => ({
  oscillator: rollFrom(['triangle', 'sawtooth', 'square'] as const),
  envelope: {
    attack: 0.002 + Math.random() ** 2 * 0.25,
    decay: 0.05 + Math.random() * 0.35,
    sustain: 0.15 + Math.random() * 0.65,
    release: 0.08 + Math.random() * 0.8,
  },
})

/** Attach a rolled patch to every synth part; partless bones gain a synth lead
 * so the patch has somewhere to live (notes without a part index play part 0). */
const withRandomSound = (m: Motif): Motif =>
  m.parts.length === 0
    ? { ...m, parts: [{ name: 'lead', instrument: 'synth', preset: rollSynthPreset() }] }
    : {
        ...m,
        parts: m.parts.map((p) =>
          p.instrument === 'synth' ? { ...p, preset: rollSynthPreset() } : p,
        ),
      }

/** Small dice tickbox: ticked = re-roll this parameter on every generation. */
function DiceToggle({
  what,
  on,
  onToggle,
  disabled,
}: {
  what: string
  on: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip
      label={
        on
          ? `Rolling ${what} per generation — click to use the set value again`
          : `Roll ${what} randomly on each generation`
      }
    >
      {/* wrapper span so the tooltip still hovers when the button is disabled */}
      <span className="gen-dice-wrap">
        <ActionIcon
          className="gen-dice"
          data-on={on || undefined}
          disabled={disabled}
          onClick={onToggle}
          aria-label={`randomize ${what}`}
          aria-pressed={on}
        >
          <DiceFiveIcon size={13} />
        </ActionIcon>
      </span>
    </Tooltip>
  )
}

const PARTLESS_CHIP_HINT =
  'Not used by this engine — INSTANT and GENETIC generate a single melodic line (INSTANT can still add drums via RHYTHM). Play melodic bones through any sound with the transport-strip picker'

const NEURAL_VOICING_HINT =
  'The on-device model composes freely — it can’t be steered to chords. Use INSTANT or CLAUDE.'

/** Engine-legal voicing values (NEURAL can't be steered; GENETIC's single
 * rhythm genome has no separate accompaniment to carry BOTH). */
const legalVoicings = (engine: Engine): readonly Voicing[] =>
  engine === 'neural' ? ['line'] : engine === 'genetic' ? ['line', 'chords'] : ['line', 'chords', 'both']

type Engine = 'instant' | 'genetic' | 'neural' | 'claude'

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
    <div className="gen-ctl">
      <span className="knob-label">model</span>
      <div
        className="gen-neural-strip"
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'flex-start' }}
      >
        {neural.state === 'unsupported' && (
          <span className="micro">WEBGPU UNAVAILABLE — INSTANT + CLAUDE ONLY</span>
        )}
        {neural.state === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <span className="micro">{mb} MB</span>
            <Tooltip label={`One-time download of the on-device model (~${mb} MB), cached in browser storage. Everything runs locally after that`}>
              <Button className="green" onClick={() => void enableNeural()}>
                Enable
              </Button>
            </Tooltip>
          </div>
        )}
        {neural.state === 'downloading' && (
          <span className="micro">DOWNLOADING… {Math.round(neural.progress * 100)}%</span>
        )}
        {neural.state === 'loading' && <span className="micro">LOADING MODEL…</span>}
        {neural.state === 'ready' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <span className="micro">READY</span>
            <Tooltip label="Delete the downloaded model from browser storage">
              <Button className="danger-text" onClick={() => void removeNeuralModel()}>
                Remove model
              </Button>
            </Tooltip>
          </div>
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
    </div>
  )
}

export function GenerationPanel() {
  const { concepts, motifs, pending, generation } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(true)
  // Tracked here (not inside GenProgress) so the run survives collapsing the panel.
  const run = useGenerationRun(pending)
  // The panel docks sticky to the top of the scrolling view; `stuck` adds a
  // floating shadow once anything has scrolled underneath it.
  const dockRef = useRef<HTMLElement | null>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    // The panel sits inside a display:contents keep-alive wrapper (App.tsx),
    // so walk up to the scrolling .view container rather than parentElement.
    const scroller = dockRef.current?.closest('.view')
    if (!scroller) return
    const onScroll = () => setStuck(scroller.scrollTop > 2)
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])
  const dockClass = `gen-dock${stuck ? ' stuck' : ''}`
  // Tier-1 offline symbolic engine is the default (spec Phase 6).
  const [engine, setEngine] = useState<Engine>('instant')
  const claudeReady = useClaudeReady()
  // If the key disappears while CLAUDE is selected, fall back to the default.
  useEffect(() => {
    if (!claudeReady && engine === 'claude') setEngine('instant')
  }, [claudeReady, engine])
  const [riffPreset, setRiffPreset] = useState<GeneticPresetChoice>('techno')
  const [dice, setDice] = useState(NO_DICE)
  const toggleDice = (p: DiceParam) => setDice((d) => ({ ...d, [p]: !d[p] }))
  // Symbolic and genetic motifs are melodic bones — the lead/extra texture
  // chips don't apply. RHYTHM does apply to INSTANT (it lays a seeded offline
  // drum part under the line); only GENETIC ignores it.
  const noTextures = engine === 'instant' || engine === 'genetic'
  const noRhythm = engine === 'genetic'
  // Only the LLM composer reads the free-text brief (the concept field is a
  // category tag and applies to every engine).
  const briefApplies = engine === 'claude'
  const [key, setKey] = useState('D')
  const [mode, setMode] = useState<Mode>('dorian')
  const [tempo, setTempo] = useState(100)
  const [bars, setBars] = useState(4)
  const [concept, setConcept] = useState('')
  const [text, setText] = useState('')
  const [allowChromatic, setAllowChromatic] = useState(false)
  const [lead, setLead] = useState(true) // on = 'lead' texture, off = free poly
  const [voicing, setVoicing] = useState<Voicing>('line')
  // An engine switch can make the current voicing illegal (NEURAL: line only;
  // GENETIC: no BOTH) — snap back to LINE, mirroring the claude fallback above.
  useEffect(() => {
    if (!legalVoicings(engine).includes(voicing)) setVoicing('line')
  }, [engine, voicing])
  const [includeRhythm, setIncludeRhythm] = useState(true)
  const [extraInstruments, setExtraInstruments] = useState(false)
  // Latched = every offline candidate gets a rolled synth patch instead of the
  // deliberately plain default voice (CLAUDE sound-designs its own parts).
  const [randomSound, setRandomSound] = useState(false)

  /** Restore every panel field to its initial value (the useState defaults above). */
  const resetBrief = () => {
    setEngine('instant')
    setRiffPreset('techno')
    setDice(NO_DICE)
    setKey('D')
    setMode('dorian')
    setTempo(100)
    setBars(4)
    setConcept('')
    setText('')
    setAllowChromatic(false)
    setLead(true)
    setVoicing('line')
    setIncludeRhythm(true)
    setExtraInstruments(false)
    setRandomSound(false)
  }

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

  /** Land a run's outcome in both places it surfaces: the reducer (the LCD
   *  progress strip reads `generation.message`) and a corner notification. */
  const reportOutcome = (message: string, failed = false) => {
    dispatch({ type: failed ? 'GENERATION_FAILED' : 'GENERATION_FINISHED', message })
    notifications.show({
      message,
      color: failed ? 'red' : 'forge',
      autoClose: failed ? 8000 : 4000,
    })
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
        reportOutcome(
          `${motifs.length} added${result.droppedCount ? `, ${result.droppedCount} dropped` : ''}${result.scaleWarningCount ? `, ${result.scaleWarningCount} chromatic` : ''}`,
        )
      })
      .catch((e) => {
        reportOutcome(`Generation failed: ${String(e).slice(0, 120)}`, true)
      })
      .finally(() => {
        clearStep(batchId)
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      })
  }

  /** Neural batch: candidates stream in one by one as the worker decodes them. */
  const queueNeuralBatch = (count: number, label: string, brief: GenerationBrief) => {
    if (getNeuralSnapshot().state !== 'ready') {
      reportOutcome('Neural model not ready — enable it in the generation panel', true)
      return
    }
    const batchId = newId()
    const conceptId = resolveConceptId()
    dispatch({ type: 'BATCH_QUEUED', batch: { id: batchId, count, label } })
    let added = 0
    let dropped = 0
    let chromatic = 0
    // Accumulated for the end-of-batch fitness reorder (streamed candidates
    // land in decode order; onDone re-ranks them best-first).
    const batchMotifs: Motif[] = []
    reportStep(batchId, 'queued for the WebGPU sampler (batches run one at a time)')
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
        // Score each candidate's melodic line so the finished batch can be
        // ranked best-first in the grid (order, don't filter — candidates are
        // too expensive to over-generate on WebGPU).
        const scored = result.valid.map((m) => {
          const fitness = fitnessScore(melodicLine(m), m)
          const fit = m.source.kind === 'neural' ? { ...m, source: { ...m.source, fitness } } : m
          return randomSound ? withRandomSound(fit) : fit
        })
        batchMotifs.push(...scored)
        if (scored.length > 0) dispatch({ type: 'MOTIFS_ADDED', motifs: scored })
      },
      onDone: () => {
        if (batchMotifs.length > 1) {
          // Re-stamp createdAt in fitness order: MOTIFS_ADDED upserts by id and
          // the grid sorts families by root createdAt, so the batch reshuffles
          // best-first once, staying in its own time neighborhood.
          const fitnessOf = (m: Motif) =>
            m.source.kind === 'neural' ? (m.source.fitness ?? 0) : 0
          const minCreated = Math.min(...batchMotifs.map((m) => m.createdAt))
          const ranked = [...batchMotifs]
            .sort((a, b) => fitnessOf(b) - fitnessOf(a))
            .map((m, rank) => ({ ...m, createdAt: minCreated + rank }))
          dispatch({ type: 'MOTIFS_ADDED', motifs: ranked })
        }
        reportOutcome(
          `${added} added${dropped ? `, ${dropped} dropped` : ''}${chromatic ? `, ${chromatic} chromatic` : ''}`,
        )
        clearStep(batchId)
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      },
      onError: (message) => {
        reportOutcome(`Neural generation failed: ${message}`, true)
        clearStep(batchId)
        dispatch({ type: 'BATCH_FINISHED', id: batchId })
      },
    })
  }

  /** The brief for one generation press: diced parameters re-roll on every
   * press, and the rolled values are written back into the (disabled)
   * controls so the panel shows exactly what was just used. */
  const buildBrief = (): GenerationBrief => {
    const rolledKey = dice.key ? rollFrom(KEYS) : key
    const rolledMode = dice.mode ? rollFrom(MODES) : mode
    const rolledTempo = dice.tempo
      ? 70 + Math.floor(Math.random() * 101)
      : Math.max(40, Math.min(220, Math.round(tempo)))
    const rolledBars = dice.bars ? rollFrom(BARS) : bars
    const rolledLead = dice.parts ? coin() : lead
    const rolledRhythm = dice.parts ? coin() : includeRhythm
    const rolledExtra = dice.parts ? coin() : extraInstruments
    const rolledChromatic = dice.chromatic ? coin() : allowChromatic
    // Voicing rolls from (and always clamps to) the engine-legal set:
    // NEURAL coerces to line, GENETIC never gets both.
    const legal = legalVoicings(engine)
    const diced = dice.voicing ? rollFrom(legal) : voicing
    const rolledVoicing: Voicing = legal.includes(diced) ? diced : 'line'
    if (dice.key) setKey(rolledKey)
    if (dice.mode) setMode(rolledMode)
    if (dice.tempo) setTempo(rolledTempo)
    if (dice.bars) setBars(rolledBars)
    if (dice.parts) {
      setLead(rolledLead)
      setIncludeRhythm(rolledRhythm)
      setExtraInstruments(rolledExtra)
    }
    if (dice.voicing) setVoicing(rolledVoicing)
    if (dice.chromatic) setAllowChromatic(rolledChromatic)
    return {
      key: rolledKey,
      mode: rolledMode,
      tempo: rolledTempo,
      bars: rolledBars,
      timeSig: '4/4',
      concept,
      text,
      allowChromatic: rolledChromatic,
      texture: rolledLead ? 'lead' : 'poly',
      voicing: rolledVoicing,
      includeRhythm: rolledRhythm,
      extraInstruments: rolledExtra,
    }
  }

  const generate = (count: number) => {
    const brief = buildBrief()
    const label = concept.trim() || `${brief.key} ${brief.mode}`
    // SOUND latch: patch the finished batch (a UI concern — the engines stay
    // deterministic from their seeds; the rolled patch persists on the motif).
    const patch = (r: ValidationResult): ValidationResult =>
      randomSound ? { ...r, valid: r.valid.map(withRandomSound) } : r
    if (engine === 'instant') {
      // Offline symbolic tier: one deterministic batch, evolved from keepers.
      const keepers = keepersOf(motifs.values())
      queueBatch(count, label, async () =>
        patch(generateSymbolicBatch(brief, count, keepers, randomSeed())),
      )
      return
    }
    if (engine === 'genetic') {
      // Offline genetic-riff tier (ga-riffs port): one GA run per motif.
      // A diced groove rolls per press and lands in the control like the rest.
      const preset = dice.groove ? rollFrom(RIFF_PRESET_NAMES) : riffPreset
      if (dice.groove) setRiffPreset(preset)
      queueBatch(count, label, async () =>
        patch(generateGeneticBatch(brief, count, preset, randomSeed())),
      )
      return
    }
    if (engine === 'neural') {
      queueNeuralBatch(count, label, brief)
      return
    }
    if (!getAnthropicKey() && !import.meta.env.DEV) {
      reportOutcome('CLAUDE needs your Anthropic API key — set it under KEY in the header', true)
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
  const enginePrefix =
    engine === 'instant'
      ? ''
      : engine === 'genetic'
        ? `GENETIC/${dice.groove ? '?' : riffPreset.toUpperCase()} · `
        : `${engine.toUpperCase()} · `
  // Diced parameters read as '?' — they re-roll on every generation press.
  // Engines that ignore the texture chips summarize as a bare LINE (+RHYTHM
  // when INSTANT will lay its drum part). Voicing folds into the texture
  // token: CHORDS replaces it (no melody to voice), BOTH appends +CHORDS.
  const texToken = dice.parts
    ? 'PARTS?'
    : noTextures
      ? 'LINE'
      : `${lead ? 'LEAD' : 'POLY'}${extraInstruments ? '+XTRA' : ''}`
  const rhythmSuffix = dice.parts ? '' : !noRhythm && includeRhythm ? '+RHYTHM' : ''
  const partsSummary = dice.voicing
    ? `${texToken}+VOICE?${rhythmSuffix}`
    : voicing === 'chords'
      ? `CHORDS${dice.parts ? '+PARTS?' : rhythmSuffix}`
      : voicing === 'both'
        ? `${texToken}+CHORDS${rhythmSuffix}`
        : `${texToken}${rhythmSuffix}`
  const summary = `${enginePrefix}${dice.key ? '?' : key} ${dice.mode ? '?' : mode.toUpperCase()} · ${dice.tempo ? '?' : tempo} BPM · ${dice.bars ? '?' : bars} BARS · ${partsSummary}${dice.chromatic ? '+CHR?' : allowChromatic ? '+CHR' : ''}`

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
          Generate <CaretRightIcon size={10} />
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
        {briefApplies && text.trim() && <span className="gen-brief-preview">“{text.trim()}”</span>}
        <span className="spacer" />
        {actions()}
      </section>
    )
  }

  return (
    <section ref={dockRef} className={`module ${dockClass}`}>
      <div className="gen-strip" style={{ paddingBottom: 0 }}>
        <button type="button" className="gen-title" onClick={() => setOpen(false)}>
          Generate <CaretDownIcon size={10} />
        </button>
        <Tooltip label="Reset every field on this panel to its default">
          <Button onClick={resetBrief}>Default</Button>
        </Tooltip>
        <GenProgress run={run} pending={pending} message={generation.message} />
      </div>
      <div className="gen-module">
        <div className="gen-knobs">
          <div className="gen-ctl">
            <span className="knob-label gen-label-dice">
              mode
              <DiceToggle what="the mode" on={dice.mode} onToggle={() => toggleDice('mode')} />
            </span>
            <Tooltip label="Scale flavor: ionian = major, aeolian = natural minor; dorian/mixolydian sit between, phrygian/locrian are darker, lydian brighter">
              <SegmentedControl
                orientation="vertical"
                disabled={dice.mode}
                value={mode}
                onChange={(v) => setMode(v as Mode)}
                data={MODES.map((m) => ({ value: m, label: MODE_SHORT[m] }))}
              />
            </Tooltip>
          </div>
          <div className="gen-ctl">
            <span className="knob-label gen-label-dice">
              key <b>{key}</b>
              <DiceToggle what="the key" on={dice.key} onToggle={() => toggleDice('key')} />
            </span>
            <div className="gen-key-row">
              <Tooltip label="Tonal center all candidates are written in — majors around the dial, relative minors inside">
                <div>
                  <CircleOfFifths disabled={dice.key} value={key} onChange={setKey} />
                </div>
              </Tooltip>
              <Tooltip label="Key signature of the selected key + mode — the accidentals candidates will actually use">
                <div>
                  <KeySignature musicKey={key} mode={mode} />
                </div>
              </Tooltip>
            </div>
          </div>
          <div className="gen-stack">
            <div className="gen-ctl">
              <span className="knob-label gen-label-dice">
                tempo
                <DiceToggle what="the tempo" on={dice.tempo} onToggle={() => toggleDice('tempo')} />
              </span>
              <Tooltip label="BPM stored on each candidate; the transport strip can override during audition">
                <div className="gen-tempo-col">
                  <Slider
                    w={160}
                    size="sm"
                    min={40}
                    max={220}
                    label={null}
                    marks={TEMPO_MARKS}
                    // dragging snaps to the common tempos; the number input is free-form
                    restrictToMarks
                    disabled={dice.tempo}
                    value={Math.max(40, Math.min(220, tempo))}
                    onChange={setTempo}
                  />
                  <NumberInput
                    w={64}
                    size="xs"
                    min={40}
                    max={220}
                    clampBehavior="blur"
                    disabled={dice.tempo}
                    value={tempo}
                    onChange={(v) => {
                      const n = Number(v)
                      if (Number.isFinite(n) && n > 0) setTempo(Math.round(n))
                    }}
                  />
                </div>
              </Tooltip>
            </div>
            <div className="gen-ctl">
              <span className="knob-label gen-label-dice">
                bars
                <DiceToggle what="the bar count" on={dice.bars} onToggle={() => toggleDice('bars')} />
              </span>
              <Tooltip label="Phrase length in bars of 4/4 — candidates must fill it exactly">
                <SegmentedControl
                  disabled={dice.bars}
                  value={String(bars)}
                  onChange={(v) => setBars(Number(v))}
                  data={BARS.map(String)}
                />
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="gen-divider" />
        <div className="gen-engine">
          <div className="gen-ctl">
            <span className="knob-label">engine</span>
            <SegmentedControl
              orientation="vertical"
              value={engine}
              onChange={(v) => setEngine(v as Engine)}
              data={[
                {
                  value: 'instant',
                  label: (
                    <Tooltip label="Offline evolution: your kept motifs (★3+) and fresh walks bred against a musical fitness, best survivors only — free, immediate. RHYTHM adds a seeded drum part">
                      <span>INSTANT</span>
                    </Tooltip>
                  ),
                },
                {
                  value: 'genetic',
                  label: (
                    <Tooltip label="Offline genetic algorithm — evolves rhythm genomes into pitched riffs (techno / organic / tribal)">
                      <span>GENETIC</span>
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
                  disabled: !claudeReady,
                  label: (
                    <Tooltip
                      label={
                        claudeReady
                          ? 'LLM composer — honors the brief text, textures, and drums'
                          : 'Needs your Anthropic API key — set it under KEY in the header'
                      }
                    >
                      <span>CLAUDE</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </div>
          {engine === 'neural' && <NeuralStrip />}
          {engine === 'genetic' && (
            <div className="gen-ctl">
              <span className="knob-label gen-label-dice">
                groove
                <DiceToggle
                  what="the groove preset"
                  on={dice.groove}
                  onToggle={() => toggleDice('groove')}
                />
              </span>
              <Tooltip label="Fitness preset: accent grid, density target, and syncopation appetite. SURPRISE synthesizes a new preset per riff — Euclidean accent skeleton, rolled weights, and a loopiness reward">
                <SegmentedControl
                  orientation="vertical"
                  disabled={dice.groove}
                  value={riffPreset}
                  onChange={(v) => setRiffPreset(v as GeneticPresetChoice)}
                  data={[
                    { value: 'techno', label: 'TECHNO' },
                    { value: 'organic', label: 'ORGANIC' },
                    { value: 'tribal', label: 'TRIBAL' },
                    { value: 'surprise', label: <span className="wb-seg-accent">SURPRISE</span> },
                  ]}
                />
              </Tooltip>
            </div>
          )}
        </div>
        <div className="gen-divider" />
        <div className="gen-mid">
          <span className="micro" style={{ letterSpacing: '.14em' }}>
            Concept · brief
          </span>
          <Tooltip label="Song concept / leitmotif tag — candidates are grouped under it in the Concepts view. Pick an existing concept from the dropdown or type a new name">
            <Autocomplete
              placeholder="concept — e.g. event horizon"
              value={concept}
              onChange={setConcept}
              data={[...concepts.values()].map((c) => c.name)}
            />
          </Tooltip>
          <Tooltip
            label={
              briefApplies
                ? 'Free-text direction: contour, rhythmic character, emotional intent, references — anything the composer should honor'
                : 'Only the CLAUDE composer reads free-text direction — the offline engines steer by key/mode/bars (and GROOVE for GENETIC)'
            }
          >
            <Textarea
              rows={2}
              placeholder="Contour, rhythmic character, emotional intent… e.g. slow rise then collapse, sparse and hollow, dread that resolves too late"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              disabled={!briefApplies}
            />
          </Tooltip>
        </div>
        <div className="gen-divider" />
        <div className="gen-parts">
          <span className="micro gen-label-dice" style={{ letterSpacing: '.14em' }}>
            Voicing
            <DiceToggle
              what="the voicing"
              on={dice.voicing}
              onToggle={() => toggleDice('voicing')}
              disabled={engine === 'neural'}
            />
          </span>
          <Tooltip
            label={
              engine === 'neural'
                ? NEURAL_VOICING_HINT
                : 'LINE: melodic material (today’s behavior). CHORDS: the motif IS a diatonic chord progression. BOTH: melody plus a harmonized chord accompaniment part'
            }
          >
            <SegmentedControl
              disabled={dice.voicing || engine === 'neural'}
              value={voicing}
              onChange={(v) => setVoicing(v as Voicing)}
              data={[
                { value: 'line', label: 'LINE' },
                { value: 'chords', label: 'CHORDS' },
                {
                  value: 'both',
                  disabled: engine === 'genetic',
                  label: (
                    <Tooltip
                      label={
                        engine === 'genetic'
                          ? 'GENETIC riffs are one evolved rhythm genome — no separate accompaniment. Use INSTANT or CLAUDE for BOTH'
                          : 'Melody plus a harmonized chord accompaniment voiced below it'
                      }
                    >
                      <span>BOTH</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </Tooltip>
          <span className="micro gen-label-dice" style={{ letterSpacing: '.14em' }}>
            Parts
            <DiceToggle
              what="the lead/rhythm/extra toggles (all three re-roll together)"
              on={dice.parts}
              onToggle={() => toggleDice('parts')}
              disabled={noRhythm}
            />
          </span>
          <div className="gen-part-chips">
            <Tooltip
              label={
                noTextures
                  ? PARTLESS_CHIP_HINT
                  : voicing === 'chords' && !dice.voicing
                    ? 'CHORDS voicing has no melody — the lead/poly texture doesn’t apply'
                    : 'Lead: one clear melodic line with occasional chords (≤4 voices). Off: freely polyphonic (≤6 voices, up to 4 parts)'
              }
            >
              <span className="gen-chip">
                <Chip
                  checked={lead}
                  onChange={setLead}
                  disabled={noTextures || dice.parts || (voicing === 'chords' && !dice.voicing)}
                >
                  lead
                </Chip>
              </span>
            </Tooltip>
            <Tooltip
              label={
                noRhythm
                  ? PARTLESS_CHIP_HINT
                  : 'Every candidate includes a drum-kit part (GM percussion) grooving under the melodic material — composed by CLAUDE/NEURAL, laid as a seeded probabilistic groove by INSTANT'
              }
            >
              <span className="gen-chip">
                <Chip
                  checked={includeRhythm}
                  onChange={setIncludeRhythm}
                  disabled={noRhythm || dice.parts}
                >
                  rhythm
                </Chip>
              </span>
            </Tooltip>
            <Tooltip
              label={
                noTextures
                  ? PARTLESS_CHIP_HINT
                  : 'Fuller arrangements: 4–6 parts with distinct roles (lead, counter-line, pad, bass, drums) instead of the default 1–4'
              }
            >
              <span className="gen-chip">
                <Chip
                  checked={extraInstruments}
                  onChange={setExtraInstruments}
                  disabled={noTextures || dice.parts}
                >
                  extra
                </Chip>
              </span>
            </Tooltip>
          </div>
          <span className="micro gen-label-dice" style={{ letterSpacing: '.14em' }}>
            Scale
            <DiceToggle
              what="strict vs chromatic"
              on={dice.chromatic}
              onToggle={() => toggleDice('chromatic')}
            />
          </span>
          <Tooltip label="Strict: every note stays in the chosen key/mode. Chromatic: notes outside it are welcome (passing tones, color notes) — out-of-scale notes only warn, never discard">
            <SegmentedControl
              disabled={dice.chromatic}
              value={allowChromatic ? 'chromatic' : 'strict'}
              onChange={(v) => setAllowChromatic(v === 'chromatic')}
              data={[
                { value: 'strict', label: 'STRICT' },
                { value: 'chromatic', label: 'CHROMATIC' },
              ]}
            />
          </Tooltip>
          <span className="micro" style={{ letterSpacing: '.14em' }}>
            Sound
          </span>
          <Tooltip
            label={
              engine === 'claude'
                ? 'CLAUDE sound-designs its own synth parts — this latch only shapes the offline engines'
                : 'Roll each candidate a synth patch (waveform + envelope) instead of the deliberately plain default voice — so a batch doesn’t all sound alike'
            }
          >
            <Button
              data-latched={randomSound}
              disabled={engine === 'claude'}
              onClick={() => setRandomSound((v) => !v)}
            >
              Random patch
            </Button>
          </Tooltip>
        </div>
        <div className="gen-actions">{actions()}</div>
      </div>
    </section>
  )
}
