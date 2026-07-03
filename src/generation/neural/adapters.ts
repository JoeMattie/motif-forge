/**
 * Adapters between the app's Motif shape and the neural tier's tokenizer:
 *   motifToEvents(motif)  — Motif -> token rows (priming / continuation)
 *   eventsToMotif(rows)   — token rows -> a raw motif object shaped like the
 *                           LLM JSON, so neural output funnels through the
 *                           SAME validateBatch path as Claude batches.
 * Plus buildPromptRows(), the from-scratch prompt used by generation
 * (mirrors app_onnx.py's "custom prompt" tab).
 */
import type { Mode, Motif, Note, Part, PartInstrument } from '../../types'
import { beatsPerBar, keyToPitchClass } from '../../core/theory'
import { MidiTokenizerV2, type MidiScore, type ScoreEvent } from './tokenizer'

/** Semitone offset from a mode's tonic down to its relative ionian root. */
const RELATIVE_IONIAN_OFFSET: Record<Mode, number> = {
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
  locrian: 11,
}

/** Key-signature sf (-7..7) whose pitch set matches (key, mode). */
export function modeToSf(key: string, mode: Mode): number {
  const majorRoot = (((keyToPitchClass(key) - RELATIVE_IONIAN_OFFSET[mode]) % 12) + 12) % 12
  return MidiTokenizerV2.key2sf(majorRoot, 0)
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Key-signature (sf, mi) -> the app's (key, mode). */
export function sfToKeyMode(sf: number, mi: number): { key: string; mode: Mode } {
  const majorPc = (((sf * 7) % 12) + 12) % 12
  const pc = mi === 1 ? (majorPc + 9) % 12 : majorPc
  const names = sf < 0 ? FLAT_NAMES : SHARP_NAMES
  return { key: names[pc], mode: mi === 1 ? 'aeolian' : 'ionian' }
}

/** GM program for each app instrument (what a part sounds closest to). */
const INSTRUMENT_PATCH: Record<Exclude<PartInstrument, 'drums'>, number> = {
  piano: 0, // acoustic grand
  epiano: 4, // electric piano 1
  marimba: 12,
  strings: 48, // string ensemble 1
  synth: 80, // lead 1 (square)
}

/** Coarse GM program -> app instrument for decoded output. */
export function patchToInstrument(patch: number): Exclude<PartInstrument, 'drums'> {
  if (patch >= 40 && patch <= 55) return 'strings'
  if (patch >= 8 && patch <= 15) return 'marimba'
  if (patch >= 4 && patch <= 7) return 'epiano'
  if (patch >= 16 && patch <= 23) return 'epiano' // organs
  if (patch < 8) return 'piano'
  return 'synth'
}

const TIME_SIG_DD: Record<string, number> = { '2': 1, '4': 2, '8': 3 }

/** Ticks per beat for motif scores: the tokenizer grid itself, so the
 * round(16 * t / tpb) quantization is exact. */
const MOTIF_TPB = 16

/**
 * Motif -> MIDI.py-shaped score. Non-drum parts map to channels 0.. (9
 * skipped), drums to channel 9; one track per part after the meta track.
 */
export function motifToScore(motif: Motif): MidiScore {
  const [nnRaw, ddRaw] = motif.timeSig.split('/')
  const nn = Math.min(16, Math.max(1, parseInt(nnRaw, 10) || 4))
  const dd = TIME_SIG_DD[ddRaw] ?? 2
  const meta: ScoreEvent[] = [
    ['set_tempo', 0, MidiTokenizerV2.bpm2tempo(motif.tempo)],
    ['time_signature', 0, nn, dd],
    ['key_signature', 0, modeToSf(motif.key, motif.mode), 0],
  ]

  const parts: Part[] = motif.parts.length > 0 ? motif.parts : [{ name: 'lead', instrument: 'synth' }]
  const channelOf: number[] = []
  let nextChannel = 0
  for (const part of parts) {
    if (part.instrument === 'drums') {
      channelOf.push(9)
    } else {
      if (nextChannel === 9) nextChannel = 10
      channelOf.push(nextChannel++)
    }
  }

  const trackFor = (i: number): ScoreEvent[] => {
    const part = parts[i]
    const c = channelOf[i]
    const track: ScoreEvent[] = []
    if (part.instrument !== 'drums') {
      track.push(['patch_change', 0, c, INSTRUMENT_PATCH[part.instrument]])
    }
    return track
  }

  const tracks = parts.map((_, i) => trackFor(i))
  for (const n of motif.notes) {
    const pi = Math.min(n.part ?? 0, parts.length - 1)
    tracks[pi].push([
      'note',
      Math.round(n.startBeat * MOTIF_TPB),
      Math.max(1, Math.round(n.durationBeats * MOTIF_TPB)),
      channelOf[pi],
      Math.round(n.pitch),
      Math.min(127, Math.max(1, Math.round(n.velocity))),
    ])
  }
  return [MOTIF_TPB, meta, ...tracks]
}

/** Motif -> token rows (BOS + events + EOS unless trimmed by the caller). */
export function motifToEvents(motif: Motif, tokenizer: MidiTokenizerV2): number[][] {
  return tokenizer.tokenize(motifToScore(motif))
}

/** The raw motif-JSON shape validateBatch consumes. */
export interface RawMotif {
  name?: string
  notes: Note[]
  parts: Part[]
  key: string
  mode: Mode
  bars: number
  timeSig: string
  tempo: number
}

/**
 * Token rows -> raw motif object (validated later by validateBatch, exactly
 * like an LLM response). Control changes are ignored; unknown channels get a
 * synth part; channel 9 becomes a drums part. Polyphony passes through.
 */
export function eventsToMotif(rows: number[][], tokenizer: MidiTokenizerV2): RawMotif {
  const score = tokenizer.detokenize(rows)
  const tpb = score[0] as number
  const tracks = score.slice(1) as ScoreEvent[][]

  let tempo = 120
  let timeSig = '4/4'
  let key = 'C'
  let mode: Mode = 'ionian'
  const channelPatch = new Map<number, number>()
  interface RawNote {
    startBeat: number
    durationBeats: number
    channel: number
    pitch: number
    velocity: number
  }
  const rawNotes: RawNote[] = []

  for (const track of tracks) {
    for (const e of track) {
      const name = e[0] as string
      if (name === 'note') {
        const [, t, d, c, p, v] = e as [string, number, number, number, number, number]
        rawNotes.push({
          startBeat: t / tpb,
          durationBeats: d / tpb,
          channel: c,
          pitch: p,
          velocity: v,
        })
      } else if (name === 'set_tempo') {
        tempo = Math.round(MidiTokenizerV2.tempo2bpm(e[2] as number))
      } else if (name === 'time_signature') {
        timeSig = `${e[2]}/${2 ** (e[3] as number)}`
      } else if (name === 'key_signature') {
        const derived = sfToKeyMode(e[2] as number, e[3] as number)
        key = derived.key
        mode = derived.mode
      } else if (name === 'patch_change') {
        const c = e[2] as number
        if (!channelPatch.has(c)) channelPatch.set(c, e[3] as number)
      }
    }
  }

  const channels = [...new Set(rawNotes.map((n) => n.channel))].sort((a, b) => a - b)
  const parts: Part[] = channels.map((c, i) =>
    c === 9
      ? { name: 'drums', instrument: 'drums' }
      : { name: `part ${i + 1}`, instrument: patchToInstrument(channelPatch.get(c) ?? 0) },
  )
  const partOf = new Map(channels.map((c, i) => [c, i]))

  const notes: Note[] = rawNotes
    .map((n) => ({
      pitch: n.pitch,
      startBeat: n.startBeat,
      durationBeats: n.durationBeats,
      velocity: n.velocity,
      ...(parts.length > 1 ? { part: partOf.get(n.channel)! } : {}),
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)

  const bpb = beatsPerBar(timeSig)
  const maxEnd = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0)
  const bars = Math.max(1, Math.ceil(maxEnd / bpb))

  return {
    notes,
    parts: parts.length > 1 ? parts : [],
    key,
    mode,
    bars,
    timeSig,
    tempo,
  }
}

/**
 * Trim a decoded motif to the requested window: drop prompt-material notes
 * before `fromBeat`, rebase the rest to beat 0, clamp everything into `bars`.
 * Used for continuations, where the keeper's own notes ride along in the
 * decoded rows.
 */
export function trimRawMotif(raw: RawMotif, fromBeat: number, bars: number): RawMotif {
  const totalBeats = bars * beatsPerBar(raw.timeSig)
  const notes = raw.notes
    .filter((n) => n.startBeat >= fromBeat - 1e-6)
    .map((n) => ({ ...n, startBeat: n.startBeat - fromBeat }))
    .filter((n) => n.startBeat < totalBeats - 1e-6)
    .map((n) => ({
      ...n,
      durationBeats: Math.min(n.durationBeats, totalBeats - n.startBeat),
    }))
  return { ...raw, notes, bars }
}

export interface PromptSpec {
  bpm: number
  timeSig: string // "4/4"
  key: string
  mode: Mode
  /** channel -> GM program; channel 9 = drum kit number. */
  patches: Map<number, number>
}

/**
 * From-scratch generation prompt, mirroring app_onnx.py's custom-prompt tab:
 * BOS, time_signature, key_signature, set_tempo, then one patch_change per
 * instrument on tracks 1..n.
 */
export function buildPromptRows(spec: PromptSpec, tokenizer: MidiTokenizerV2): number[][] {
  const [nnRaw, ddRaw] = spec.timeSig.split('/')
  const nn = Math.min(16, Math.max(1, parseInt(nnRaw, 10) || 4))
  const dd = TIME_SIG_DD[ddRaw] ?? 2
  const rows: number[][] = [
    [tokenizer.bosId, ...Array(tokenizer.maxTokenSeq - 1).fill(tokenizer.padId)],
    tokenizer.event2tokens(['time_signature', 0, 0, 0, nn - 1, dd - 1]),
    tokenizer.event2tokens(['key_signature', 0, 0, 0, modeToSf(spec.key, spec.mode) + 7, 0]),
    tokenizer.event2tokens(['set_tempo', 0, 0, 0, Math.min(383, Math.max(1, Math.round(spec.bpm)))]),
  ]
  let i = 0
  for (const [c, p] of spec.patches) {
    rows.push(tokenizer.event2tokens(['patch_change', 0, 0, i + 1, c, p]))
    i++
  }
  return rows
}
