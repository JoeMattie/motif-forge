import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, NumberInput, SegmentedControl, Select, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { CaretDownIcon, CaretRightIcon, MicrophoneIcon } from '@phosphor-icons/react'
import type { Mode, Note } from '../types'
import { MODES } from '../core/theory'
import { engine } from '../audio/engine'
import { buildMotif, hex4, randomSeed } from '../generation/symbolic'
import { useAppDispatch } from '../store/AppContext'
import {
  useNoodleBpMinLenMs,
  useNoodleBpNoteSens,
  useNoodleBpSplitSens,
  useNoodleCountIn,
  useNoodleGrid,
  useNoodleLatencyMs,
  useNoodleLock,
  useNoodleMicMode,
  useNoodleMidiDevice,
  useNoodleOctave,
  useNoodleSnap,
} from '../uiPrefs'
import {
  canUndo,
  clearNotes,
  getTake,
  NOODLE_TAKE_ID,
  pushUndo,
  replaceMaterial,
  setNotes,
  setTakeMeta,
  subscribeTake,
  takeMotif,
  takeTotalBeats,
  undo,
  type MicMethod,
} from '../noodle/takeStore'
import {
  GRIDS,
  gridBeats,
  lockNotesToScale,
  quantizeNotes,
  type GridId,
} from '../noodle/quantize'
import {
  armRecorder,
  getRecorderSnapshot,
  stopRecorder,
  subscribeRecorder,
} from '../noodle/recorder'
import {
  ensureMidiAccess,
  getMidiSnapshot,
  selectMidiDevice,
  subscribeMidi,
} from '../noodle/midiInput'
import {
  cancelMicCapture,
  captureMic,
  getMicSnapshot,
  micDone,
  subscribeMic,
} from '../noodle/micCapture'
import { transcribeVoice } from '../noodle/transcribe/voice'
import { transcribeBeats } from '../noodle/transcribe/beats'
import {
  enableBasicPitch,
  getBasicPitchSnapshot,
  getLastPosteriograms,
  initBasicPitch,
  posteriogramsToNotes,
  removeBasicPitchModel,
  subscribeBasicPitch,
  transcribeBasicPitch,
} from '../noodle/transcribe/basicPitch/client'
import { BP_ANNOTATIONS_FPS } from '../noodle/transcribe/basicPitch/postprocess'
import { usePlayOptions } from './hooks/usePlayOptions'
import { CircleOfFifths } from './hw/CircleOfFifths'
import { HardToggle } from './hw/HardToggle'
import { Knob } from './hw/Knob'
import { PlayRound } from './hw/PlayRound'
import { NoodleRoll, type NoodleTool } from './NoodleRoll'

const MODE_SHORT: Record<Mode, string> = {
  ionian: 'ION',
  dorian: 'DOR',
  phrygian: 'PHR',
  lydian: 'LYD',
  mixolydian: 'MIX',
  aeolian: 'AEO',
  locrian: 'LOC',
}

const BARS = [2, 4, 8]
const TIME_SIGS = ['4/4', '3/4', '6/8']

function originLabel(input: string, method?: string): string {
  if (input === 'midi') return 'played on MIDI'
  if (input === 'keys') return 'played on musical typing'
  if (input === 'mic') return `sung/played into the mic (${method ?? 'voice'})`
  return 'penciled into the roll'
}

/** Basic Pitch model strip: enable/remove + NeuralNote-style knobs. */
function InstStrip() {
  const bp = useSyncExternalStore(subscribeBasicPitch, getBasicPitchSnapshot)
  const [noteSens, setNoteSens] = useNoodleBpNoteSens()
  const [splitSens, setSplitSens] = useNoodleBpSplitSens()
  const [minLenMs, setMinLenMs] = useNoodleBpMinLenMs()
  const kb = Math.round(bp.totalBytes / 1024)

  // Knob turns re-run the post-processing on the cached posteriograms — the
  // inference already happened, so retuning a take is instant. Skips the
  // mount run so remounting the strip never clobbers manual edits.
  const applied = useRef(`${noteSens}|${splitSens}|${minLenMs}`)
  useEffect(() => {
    const key = `${noteSens}|${splitSens}|${minLenMs}`
    if (applied.current === key) return
    applied.current = key
    const p = getLastPosteriograms()
    const t = getTake()
    if (!p || t.method !== 'basic-pitch') return
    const notes = posteriogramsToNotes(
      p,
      {
        frameThresh: noteSens,
        onsetThresh: splitSens,
        minNoteLen: Math.max(1, Math.round((minLenMs / 1000) * BP_ANNOTATIONS_FPS)),
      },
      { tempo: t.tempo, totalBeats: takeTotalBeats(t) },
    )
    setNotes(notes)
  }, [noteSens, splitSens, minLenMs])

  return (
    <div className="noodle-inst-strip">
      {bp.state === 'idle' && (
        <>
          <span className="micro">BASIC PITCH · {kb} KB</span>
          <Tooltip label="One-time download of Spotify's Basic Pitch transcription model (Apache-2.0, ~225 KB), cached in browser storage. Runs locally on every mic take after that">
            <Button className="green" onClick={() => void enableBasicPitch()}>
              Enable
            </Button>
          </Tooltip>
        </>
      )}
      {bp.state === 'downloading' && (
        <span className="micro">DOWNLOADING… {Math.round(bp.progress * 100)}%</span>
      )}
      {bp.state === 'loading' && <span className="micro">LOADING MODEL…</span>}
      {bp.state === 'error' && (
        <>
          <span className="micro" style={{ color: 'var(--danger)' }}>
            {bp.error?.toUpperCase().slice(0, 80)}
          </span>
          <Button onClick={() => void enableBasicPitch()}>Retry</Button>
        </>
      )}
      {bp.state === 'ready' && (
        <>
          <Tooltip label="Frame threshold: how easily a pitch keeps sounding. Higher = fewer, cleaner notes; lower = more notes survive. Retunes the last mic take instantly">
            <div>
              <Knob
                label="note sens"
                value={`${Math.round(noteSens * 100)}`}
                position={(noteSens - 0.05) / 0.9}
                onPosition={(p) => setNoteSens(Math.round((0.05 + p * 0.9) * 100) / 100)}
                detents={19}
                variant="light"
              />
            </div>
          </Tooltip>
          <Tooltip label="Onset threshold: how eagerly repeated notes split. Higher = fewer splits (legato); lower = every re-attack is its own note">
            <div>
              <Knob
                label="split"
                value={`${Math.round(splitSens * 100)}`}
                position={(splitSens - 0.05) / 0.9}
                onPosition={(p) => setSplitSens(Math.round((0.05 + p * 0.9) * 100) / 100)}
                detents={19}
                variant="light"
              />
            </div>
          </Tooltip>
          <Tooltip label="Minimum note length — transcription shorter than this is dropped as noise">
            <div>
              <Knob
                label="min len"
                value={`${minLenMs}ms`}
                position={(minLenMs - 20) / 280}
                onPosition={(p) => setMinLenMs(Math.round((20 + p * 280) / 20) * 20)}
                detents={15}
                variant="light"
              />
            </div>
          </Tooltip>
          <Tooltip label="Delete the downloaded Basic Pitch model from browser storage">
            <Button className="danger-text" onClick={() => void removeBasicPitchModel()}>
              Remove
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  )
}

export function NoodlePanel() {
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const [open, setOpen] = useState(false)

  const take = useSyncExternalStore(subscribeTake, getTake)
  const recorder = useSyncExternalStore(subscribeRecorder, getRecorderSnapshot)
  const midi = useSyncExternalStore(subscribeMidi, getMidiSnapshot)
  const mic = useSyncExternalStore(subscribeMic, getMicSnapshot)
  const bp = useSyncExternalStore(subscribeBasicPitch, getBasicPitchSnapshot)
  const playingId = useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().playingMotifId)
  const loading = useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().loading)
  const playing = playingId === NOODLE_TAKE_ID

  const [snap, setSnap] = useNoodleSnap()
  const [gridId, setGridId] = useNoodleGrid()
  const [lock, setLock] = useNoodleLock()
  const [micMode, setMicMode] = useNoodleMicMode()
  const [octave, setOctave] = useNoodleOctave()
  const [midiPref, setMidiPref] = useNoodleMidiDevice()
  const [latencyMs, setLatencyMs] = useNoodleLatencyMs()
  const [countIn, setCountIn] = useNoodleCountIn()
  const [noteSens] = useNoodleBpNoteSens()
  const [splitSens] = useNoodleBpSplitSens()
  const [minLenMs] = useNoodleBpMinLenMs()
  const [tool, setTool] = useState<NoodleTool>('pencil')
  const [keysInput, setKeysInput] = useState(!midi.supported)

  const grid = gridBeats(gridId as GridId)
  const totalBeats = takeTotalBeats(take)
  const captureActive = recorder.state !== 'idle' || mic.state !== 'idle'

  // Live capture prefs + typing octave for the recorder (registered once per
  // arm — read through refs so panel flips apply mid-take).
  const latest = useRef({ lock, snap, grid, octave })
  useEffect(() => {
    latest.current = { lock, snap, grid, octave }
  })

  // Request MIDI access when the panel opens (device list + statechange).
  useEffect(() => {
    if (open && midi.supported) void ensureMidiAccess(midiPref || undefined)
  }, [open, midi.supported, midiPref])
  useEffect(() => {
    if (midiPref) selectMidiDevice(midiPref)
  }, [midiPref])

  // Probe the Basic Pitch cache as soon as INST is the chosen mic mode.
  useEffect(() => {
    if (micMode === 'inst') void initBasicPitch()
  }, [micMode])

  // Edits while the loop plays swap in on the same beat grid (bay-mix style).
  // biome-ignore lint/correctness/useExhaustiveDependencies: note edits are the swap trigger; playback state is read from the engine snapshot
  useEffect(() => {
    const snap = engine.getSnapshot()
    if (snap.playingMotifId !== NOODLE_TAKE_ID || snap.loading) return
    const m = takeMotif()
    engine.swap(m, playOpts(m, { loop: true }))
  }, [take.notes])

  const stopCapture = () => {
    stopRecorder()
    cancelMicCapture()
  }

  const toggleLoop = () => {
    if (playing) {
      engine.stop()
      return
    }
    stopCapture()
    const m = takeMotif()
    if (m.notes.length === 0) return
    engine.play(m, playOpts(m, { loop: true }))
  }

  const toggleRec = () => {
    if (recorder.state !== 'idle') {
      stopRecorder()
      return
    }
    cancelMicCapture()
    armRecorder({
      input: keysInput ? 'keys' : 'midi',
      prefs: () => latest.current,
      getOctave: () => latest.current.octave,
      onOctaveShift: (delta) => setOctave((o) => Math.max(1, Math.min(7, (o ?? 4) + delta))),
    })
  }

  const recordMic = () => {
    if (mic.state !== 'idle') {
      cancelMicCapture()
      return
    }
    stopRecorder()
    engine.stop()
    if (micMode === 'inst' && bp.state !== 'ready') {
      notifications.show({
        message: 'INST needs the Basic Pitch model — press ENABLE in the Noodle panel first',
        color: 'red',
      })
      return
    }
    const t = getTake()
    void (async () => {
      try {
        const { samples, sampleRate } = await captureMic({
          tempo: t.tempo,
          bars: t.bars,
          timeSig: t.timeSig,
          countInBars: countIn,
          latencyMs,
        })
        const beats = takeTotalBeats(t)
        let notes: Note[]
        let method: MicMethod
        let drums = false
        if (micMode === 'voice') {
          notes = transcribeVoice(samples, sampleRate, { tempo: t.tempo, totalBeats: beats })
          method = 'voice'
        } else if (micMode === 'beats') {
          notes = transcribeBeats(samples, sampleRate, { tempo: t.tempo, totalBeats: beats })
          method = 'beats'
          drums = true
        } else {
          const p = await transcribeBasicPitch(samples, sampleRate)
          notes = posteriogramsToNotes(
            p,
            {
              frameThresh: noteSens,
              onsetThresh: splitSens,
              minNoteLen: Math.max(1, Math.round((minLenMs / 1000) * BP_ANNOTATIONS_FPS)),
            },
            { tempo: t.tempo, totalBeats: beats },
          )
          method = 'basic-pitch'
        }
        const { lock: lockNow, snap: snapNow, grid: gridNow } = latest.current
        if (lockNow && !drums) notes = lockNotesToScale(notes, t.key, t.mode)
        if (snapNow) notes = quantizeNotes(notes, { grid: gridNow, totalBeats: beats, drums })
        replaceMaterial(notes, { input: 'mic', method, drums })
        notifications.show({
          message:
            notes.length === 0
              ? 'Nothing transcribed — try closer to the mic, or a longer count-in'
              : `${notes.length} note${notes.length === 1 ? '' : 's'} transcribed (${method})`,
          color: notes.length === 0 ? 'red' : 'forge',
        })
      } catch (e) {
        if (!String(e).includes('cancelled')) {
          notifications.show({
            message: `Mic capture failed: ${String(e).slice(0, 120)}`,
            color: 'red',
          })
        }
      } finally {
        micDone()
      }
    })()
  }

  const applyQuantize = () => {
    pushUndo()
    setNotes(quantizeNotes([...getTake().notes], { grid, totalBeats, drums: take.drums }))
  }

  const applyToKey = () => {
    pushUndo()
    const t = getTake()
    setNotes(lockNotesToScale([...t.notes], t.key, t.mode))
  }

  const addToPool = () => {
    const t = getTake()
    if (t.notes.length === 0) return
    const seed = randomSeed()
    const motif = buildMotif({
      name: `Noodle ${hex4(seed)}`,
      notes: [...t.notes]
        .map((n) => ({ ...n, part: 0 }))
        .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
      parts: t.drums ? [{ name: 'kit', instrument: 'drums' }] : undefined,
      key: t.key,
      mode: t.mode,
      bars: t.bars,
      timeSig: t.timeSig,
      tempo: t.tempo,
      conceptId: null,
      rationale: `your own material — ${originLabel(t.input, t.method)}`,
      source: { kind: 'recorded', input: t.input, method: t.method },
    })
    dispatch({ type: 'MOTIFS_ADDED', motifs: [motif] })
    notifications.show({ message: `“${motif.name}” added to the pool`, color: 'forge' })
  }

  const status = captureActive
    ? recorder.state === 'armed'
      ? `ARMED (${recorder.input?.toUpperCase()}) — play a note to start · loops ${take.bars} bars`
      : recorder.state === 'recording'
        ? 'RECORDING — loop overdubbing · REC again to stop'
        : mic.status
    : playing
      ? 'LOOPING TAKE'
      : ''

  const summary = `${take.key} ${take.mode.toUpperCase()} · ${take.tempo} BPM · ${take.bars} BARS · ${take.notes.length} NOTES${take.drums ? ' · KIT' : ''}`

  if (!open) {
    return (
      <section className="module gen-strip noodle-strip">
        <button type="button" className="gen-title" onClick={() => setOpen(true)}>
          Noodle <CaretRightIcon size={10} />
        </button>
        <span className="gen-summary">{summary}</span>
        <span className="spacer" />
        <PlayRound size="md" playing={playing} loading={playing && loading} onClick={toggleLoop} />
        <Tooltip label="Commit the staged take to the triage pool as a fresh family">
          <Button className="green" disabled={take.notes.length === 0} onClick={addToPool}>
            Add to pool
          </Button>
        </Tooltip>
      </section>
    )
  }

  return (
    <section className="module noodle-panel">
      <div className="gen-strip" style={{ paddingBottom: 0 }}>
        <button type="button" className="gen-title" onClick={() => setOpen(false)}>
          Noodle <CaretDownIcon size={10} />
        </button>
        <span className="gen-summary">{summary}</span>
        {status && <span className={`noodle-status${captureActive ? ' live' : ''}`}>{status}</span>}
      </div>
      <div className="noodle-module">
        <div className="noodle-controls">
          <div className="gen-ctl">
            <span className="knob-label">input</span>
            <div className="noodle-input-row">
              {midi.supported && (
                <Tooltip label="Web MIDI input device — notes you play arm and overdub into the loop">
                  <Select
                    w={150}
                    placeholder={midi.status === 'denied' ? 'MIDI blocked' : 'MIDI device'}
                    data={midi.devices.map((d) => ({ value: d.id, label: d.name }))}
                    value={midi.selectedId}
                    onChange={(id) => {
                      if (id) setMidiPref(id)
                      selectMidiDevice(id)
                    }}
                    disabled={keysInput || midi.devices.length === 0}
                  />
                </Tooltip>
              )}
              <Tooltip label="Musical typing: a w s e d f t g y h u j k play an octave from C, z/x shift octaves — active while capture is armed">
                <HardToggle on={keysInput} onChange={setKeysInput} label={<span>KEYS</span>} />
              </Tooltip>
              {keysInput && (
                <span className="micro noodle-oct">
                  OCT <b>C{octave}</b> (z/x)
                </span>
              )}
              <Tooltip
                label={
                  recorder.state === 'idle'
                    ? 'Arm loop-overdub recording: the click starts now, recording starts at the bar line of your first note, and every pass layers on top'
                    : 'Stop recording'
                }
              >
                <Button
                  data-danger={recorder.state !== 'idle'}
                  className="danger-text"
                  disabled={!keysInput && (!midi.supported || midi.devices.length === 0)}
                  onClick={toggleRec}
                >
                  {recorder.state === 'idle' ? 'Rec' : recorder.state === 'armed' ? 'Armed…' : 'Stop rec'}
                </Button>
              </Tooltip>
            </div>
            <div className="noodle-input-row">
              <Tooltip label="How mic audio becomes notes: VOICE = hand-rolled YIN pitch tracking (hum/whistle/sing), INST = Spotify Basic Pitch (polyphonic instruments, tiny on-device model), BEATS = onset heuristics (beatbox → kick/snare/hat)">
                <SegmentedControl
                  value={micMode}
                  onChange={(v) => setMicMode(v as typeof micMode)}
                  data={[
                    { value: 'voice', label: 'VOICE' },
                    { value: 'inst', label: 'INST' },
                    { value: 'beats', label: 'BEATS' },
                  ]}
                />
              </Tooltip>
              <Tooltip
                label={
                  mic.state === 'idle'
                    ? `Record ${take.bars} bars from the microphone after a ${countIn}-bar count-in, then transcribe onto the roll`
                    : 'Cancel the mic recording'
                }
              >
                <Button
                  data-danger={mic.state !== 'idle'}
                  leftSection={<MicrophoneIcon size={12} />}
                  onClick={recordMic}
                >
                  {mic.state === 'idle' ? 'Record' : 'Cancel'}
                </Button>
              </Tooltip>
              <Tooltip label="Count-in bars of click before the mic window opens">
                <NumberInput
                  w={54}
                  size="xs"
                  min={1}
                  max={2}
                  value={countIn}
                  onChange={(v) => {
                    const n = Number(v)
                    if (n === 1 || n === 2) setCountIn(n)
                  }}
                />
              </Tooltip>
              <Tooltip label="Latency compensation (ms): shifts the transcription earlier to cancel the output-click + mic-input delay. Raise it if takes land late against the click">
                <NumberInput
                  w={64}
                  size="xs"
                  min={0}
                  max={400}
                  step={10}
                  value={latencyMs}
                  onChange={(v) => {
                    const n = Number(v)
                    if (Number.isFinite(n) && n >= 0) setLatencyMs(Math.round(n))
                  }}
                />
              </Tooltip>
            </div>
          </div>
          <div className="gen-divider" />
          <div className="gen-ctl">
            <span className="knob-label">
              key <b>{take.key}</b>
            </span>
            <Tooltip label="The take's tonal center — LOCK snaps incoming notes into it">
              <div>
                <CircleOfFifths size={108} value={take.key} onChange={(key) => setTakeMeta({ key })} />
              </div>
            </Tooltip>
          </div>
          <div className="gen-ctl">
            <span className="knob-label">mode</span>
            <Tooltip label="Scale flavor for LOCK / in-scale row shading">
              <SegmentedControl
                orientation="vertical"
                value={take.mode}
                onChange={(v) => setTakeMeta({ mode: v as Mode })}
                data={MODES.map((m) => ({ value: m, label: MODE_SHORT[m] }))}
              />
            </Tooltip>
          </div>
          <div className="gen-divider" />
          <div className="gen-ctl">
            <span className="knob-label">grid</span>
            <Tooltip label="LOCK: incoming pitches (MIDI, typing, mic) snap into the key/mode as they land; the roll shades the in-scale rows">
              <HardToggle color="accent" on={lock} onChange={setLock} label={<span>LOCK</span>} />
            </Tooltip>
            <Tooltip label="SNAP: captured and penciled note starts quantize to the grid as they land — QUANTIZE applies it to what's already there">
              <HardToggle color="yellow" on={snap} onChange={setSnap} label={<span>SNAP</span>} />
            </Tooltip>
            <Tooltip label="Grid resolution for SNAP, QUANTIZE, and the roll's sub-grid (1/8T = eighth-note triplets)">
              <SegmentedControl
                value={gridId}
                onChange={setGridId}
                data={GRIDS.map((g) => ({ value: g.id, label: g.id }))}
              />
            </Tooltip>
            <Tooltip label="PENCIL draws notes on empty grid; SELECT drags a marquee. Notes always drag/resize; alt-click deletes">
              <SegmentedControl
                value={tool}
                onChange={(v) => setTool(v as NoodleTool)}
                data={[
                  { value: 'pencil', label: 'PENCIL' },
                  { value: 'select', label: 'SELECT' },
                ]}
              />
            </Tooltip>
          </div>
          <div className="gen-divider" />
          <div className="gen-ctl">
            <span className="knob-label">timing</span>
            <Tooltip label="Take tempo — the click, the loop, and mic-window math all follow it">
              <NumberInput
                w={72}
                size="xs"
                min={40}
                max={220}
                value={take.tempo}
                disabled={captureActive}
                onChange={(v) => {
                  const n = Number(v)
                  if (Number.isFinite(n) && n >= 40 && n <= 220) setTakeMeta({ tempo: Math.round(n) })
                }}
              />
            </Tooltip>
            <Tooltip label="Loop length in bars">
              <SegmentedControl
                value={String(take.bars)}
                disabled={captureActive}
                onChange={(v) => setTakeMeta({ bars: Number(v) })}
                data={BARS.map(String)}
              />
            </Tooltip>
            <Tooltip label="Time signature of the click grid">
              <SegmentedControl
                value={take.timeSig}
                disabled={captureActive}
                onChange={(v) => setTakeMeta({ timeSig: v })}
                data={TIME_SIGS}
              />
            </Tooltip>
          </div>
        </div>
        {micMode === 'inst' && <InstStrip />}
        <NoodleRoll tool={tool} snap={snap} grid={grid} lock={lock} />
        <div className="noodle-transport">
          <Tooltip label="Loop the staged take (edits swap in without dropping the beat)">
            <PlayRound playing={playing} loading={playing && loading} onClick={toggleLoop} />
          </Tooltip>
          <Tooltip label="Round every note start (and melodic duration) to the grid">
            <Button disabled={take.notes.length === 0} onClick={applyQuantize}>
              Quantize
            </Button>
          </Tooltip>
          {!take.drums && (
            <Tooltip label="Snap every note into the selected key/mode (chromatic notes move to the nearest scale tone)">
              <Button disabled={take.notes.length === 0} onClick={applyToKey}>
                To key
              </Button>
            </Tooltip>
          )}
          <Tooltip label="Undo the last edit / recording pass / transcription">
            <Button disabled={!canUndo()} onClick={undo}>
              Undo
            </Button>
          </Tooltip>
          <Tooltip label="Clear the roll (undoable)">
            <Button className="danger-text" disabled={take.notes.length === 0} onClick={clearNotes}>
              Clear
            </Button>
          </Tooltip>
          <span className="spacer" />
          <Tooltip label="Commit the staged take to the triage pool as a fresh family — the panel keeps the take so you can commit variants">
            <Button className="green" disabled={take.notes.length === 0} onClick={addToPool}>
              Add to pool
            </Button>
          </Tooltip>
        </div>
      </div>
    </section>
  )
}
