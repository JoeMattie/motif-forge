/**
 * The staged noodle take — a singleton outside React (same pattern as
 * audio/engine.ts and generation/activity.ts); components subscribe via
 * useSyncExternalStore. Nothing here touches the library: ADD TO POOL builds
 * a Motif from the snapshot and dispatches MOTIFS_ADDED from the panel.
 *
 * Persisted to localStorage so a take survives reloads.
 */
import type { Mode, Motif, Note } from '../types'
import { beatsPerBar } from '../core/theory'

export type NoodleInput = 'midi' | 'keys' | 'mic' | 'pencil'
export type MicMethod = 'voice' | 'beats' | 'basic-pitch'

export interface NoodleTake {
  notes: readonly Note[]
  tempo: number
  bars: number
  timeSig: string
  key: string
  mode: Mode
  /** BEATS transcriptions: notes are GM kit hits; commits carry a drums part. */
  drums: boolean
  /** Where the current material came from (last capture wins; manual = pencil). */
  input: NoodleInput
  method?: MicMethod
}

/** Playback id of the staged take — the transport strips `::` suffixes. */
export const NOODLE_TAKE_ID = 'noodle::take'

const STORAGE_KEY = 'motif-forge:noodle-take'
const MAX_UNDO = 64

const DEFAULT_TAKE: NoodleTake = {
  notes: [],
  tempo: 100,
  bars: 4,
  timeSig: '4/4',
  key: 'D',
  mode: 'dorian',
  drums: false,
  input: 'pencil',
}

function load(): NoodleTake {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TAKE
    const parsed = JSON.parse(raw) as Partial<NoodleTake>
    if (!Array.isArray(parsed.notes)) return DEFAULT_TAKE
    return { ...DEFAULT_TAKE, ...parsed }
  } catch {
    return DEFAULT_TAKE
  }
}

let take: NoodleTake = load()
const undoStack: (readonly Note[])[] = []
const listeners = new Set<() => void>()

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(take))
  } catch {
    // storage full/unavailable — the take just won't survive a reload
  }
}

function set(patch: Partial<NoodleTake>): void {
  take = { ...take, ...patch }
  save()
  for (const l of listeners) l()
}

export function subscribeTake(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getTake(): NoodleTake {
  return take
}

/** Snapshot the current notes for undo — call once at the start of a gesture
 * (drag, recording pass, quantize, transcription), not per intermediate move. */
export function pushUndo(): void {
  undoStack.push(take.notes)
  if (undoStack.length > MAX_UNDO) undoStack.shift()
}

export function canUndo(): boolean {
  return undoStack.length > 0
}

export function undo(): void {
  const prev = undoStack.pop()
  if (prev) set({ notes: prev })
}

/** Replace the notes without pushing undo — mid-gesture updates. Callers own
 * the pushUndo() at gesture start. */
export function setNotes(notes: readonly Note[]): void {
  set({ notes })
}

/** Undoable single-note append (pencil create, captured note). Returns index. */
export function addNote(note: Note, undoable = true): number {
  if (undoable) pushUndo()
  set({ notes: [...take.notes, note] })
  return take.notes.length - 1
}

export function removeNotes(indices: ReadonlySet<number>): void {
  if (indices.size === 0) return
  pushUndo()
  set({ notes: take.notes.filter((_, i) => !indices.has(i)) })
}

export function clearNotes(): void {
  if (take.notes.length === 0) return
  pushUndo()
  set({ notes: [] })
}

/** Meta edits (key/tempo/bars/…) — not undoable; undo covers note material. */
export function setTakeMeta(
  patch: Partial<Pick<NoodleTake, 'tempo' | 'bars' | 'timeSig' | 'key' | 'mode'>>,
): void {
  set(patch)
}

/** Replace the whole material (recording pass merge, transcription result). */
export function replaceMaterial(
  notes: readonly Note[],
  origin: { input: NoodleInput; method?: MicMethod; drums?: boolean },
  undoable = true,
): void {
  if (undoable) pushUndo()
  set({
    notes,
    input: origin.input,
    method: origin.method,
    drums: origin.drums ?? false,
  })
}

/** The take as an ephemeral Motif for loop audition / the roll's coordinate
 * math. Never enters the store — ADD TO POOL builds a fresh persistent one. */
export function takeMotif(t: NoodleTake = take): Motif {
  return {
    id: NOODLE_TAKE_ID,
    name: 'Noodle take',
    notes: [...t.notes]
      .map((n) => ({ ...n, part: 0 }))
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
    parts: t.drums ? [{ name: 'kit', instrument: 'drums' }] : [],
    key: t.key,
    mode: t.mode,
    bars: t.bars,
    timeSig: t.timeSig,
    tempo: t.tempo,
    conceptId: null,
    rating: 0,
    discarded: false,
    scaleWarning: false,
    createdAt: 0,
    source: { kind: 'recorded', input: t.input, method: t.method },
  }
}

export function takeTotalBeats(t: NoodleTake = take): number {
  return t.bars * beatsPerBar(t.timeSig)
}
