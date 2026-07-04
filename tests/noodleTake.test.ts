/**
 * Take store behavior + take → Motif conversion. The store is a module-level
 * singleton (localStorage is absent under node, so it opens on defaults) —
 * tests share it sequentially, resetting via clear/replace.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addNote,
  canUndo,
  getTake,
  NOODLE_TAKE_ID,
  pushUndo,
  removeNotes,
  replaceMaterial,
  setNotes,
  setTakeMeta,
  takeMotif,
  takeTotalBeats,
  undo,
} from '../src/noodle/takeStore'
import { typingPitch } from '../src/noodle/musicalTyping'
import type { Note } from '../src/types'

const note = (pitch: number, startBeat: number): Note => ({
  pitch,
  startBeat,
  durationBeats: 1,
  velocity: 96,
  part: 0,
})

beforeEach(() => {
  setNotes([])
  setTakeMeta({ key: 'D', mode: 'dorian', tempo: 100, bars: 4, timeSig: '4/4' })
  replaceMaterial([], { input: 'pencil' }, false)
})

describe('take store', () => {
  it('adds notes and undoes per gesture', () => {
    addNote(note(60, 0))
    addNote(note(62, 1))
    expect(getTake().notes).toHaveLength(2)
    expect(canUndo()).toBe(true)
    undo()
    expect(getTake().notes).toHaveLength(1)
    undo()
    expect(getTake().notes).toHaveLength(0)
  })

  it('removeNotes drops exactly the given indices', () => {
    addNote(note(60, 0))
    addNote(note(62, 1))
    addNote(note(64, 2))
    removeNotes(new Set([1]))
    expect(getTake().notes.map((n) => n.pitch)).toEqual([60, 64])
    undo()
    expect(getTake().notes).toHaveLength(3)
  })

  it('mid-gesture setNotes does not grow the undo stack', () => {
    addNote(note(60, 0))
    pushUndo()
    setNotes([note(61, 0)])
    setNotes([note(63, 0)])
    undo() // one undo returns to the pre-gesture state
    expect(getTake().notes.map((n) => n.pitch)).toEqual([60])
  })

  it('replaceMaterial stamps the origin', () => {
    replaceMaterial([note(38, 0)], { input: 'mic', method: 'beats', drums: true })
    const t = getTake()
    expect(t.input).toBe('mic')
    expect(t.method).toBe('beats')
    expect(t.drums).toBe(true)
  })
})

describe('takeMotif conversion', () => {
  it('builds a partless melodic motif with recorded lineage', () => {
    replaceMaterial([note(64, 2), note(60, 0)], { input: 'midi' })
    const m = takeMotif()
    expect(m.id).toBe(NOODLE_TAKE_ID)
    expect(m.parts).toEqual([])
    // sorted by startBeat for the engine
    expect(m.notes.map((n) => n.pitch)).toEqual([60, 64])
    expect(m.source).toEqual({ kind: 'recorded', input: 'midi', method: undefined })
    expect(m.key).toBe('D')
    expect(m.tempo).toBe(100)
  })

  it('drum takes carry a drums part', () => {
    replaceMaterial([note(36, 0)], { input: 'mic', method: 'beats', drums: true })
    const m = takeMotif()
    expect(m.parts).toEqual([{ name: 'kit', instrument: 'drums' }])
    expect(m.notes[0].part).toBe(0)
  })

  it('takeTotalBeats follows bars × timeSig', () => {
    setTakeMeta({ bars: 2, timeSig: '3/4' })
    expect(takeTotalBeats()).toBe(6)
    setTakeMeta({ bars: 4, timeSig: '4/4' })
    expect(takeTotalBeats()).toBe(16)
  })
})

describe('musical typing layout', () => {
  it('walks a chromatic octave from C', () => {
    expect(typingPitch('a', 4)).toBe(60)
    expect(typingPitch('w', 4)).toBe(61)
    expect(typingPitch('s', 4)).toBe(62)
    expect(typingPitch('j', 4)).toBe(71)
    expect(typingPitch('k', 4)).toBe(72) // the next C
  })

  it('shifts with the octave and clamps to the editable range', () => {
    expect(typingPitch('a', 2)).toBe(36)
    expect(typingPitch('a', 1)).toBeNull() // below MIDI 36
    expect(typingPitch('k', 7)).toBeNull() // above MIDI 96
    expect(typingPitch('q', 4)).toBeNull() // unmapped key
  })
})
