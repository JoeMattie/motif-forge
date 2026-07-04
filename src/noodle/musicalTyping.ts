/**
 * Ableton-style musical typing: the computer keyboard as a one-octave piano.
 * a w s e d f t g y h u j k walk C, C#, D … up to the next C; z/x shift the
 * base octave. Active only while the panel's KEYS capture is armed — the
 * window listeners attach in armTyping and detach on the returned disarm
 * (the triage keydown listener is disabled while capture is armed, so the
 * two never fight over letters).
 */
import { isTypingTarget } from '../components/hooks/useKeyboardTriage'
import type { NoodleNoteEvent } from './midiInput'
import { NOODLE_PITCH_MAX, NOODLE_PITCH_MIN } from './quantize'

const KEY_SEMITONE: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
}

export const TYPING_VELOCITY = 96

export interface TypingHandlers {
  /** Base octave (pitch of `a` = C<octave>), read per keystroke. */
  getOctave(): number
  /** z / x pressed: -1 / +1. */
  onOctaveShift(delta: number): void
  onNote(e: NoodleNoteEvent): void
}

/** Pitch of the typing key at the given base octave (C4 = 60), or null. */
export function typingPitch(key: string, octave: number): number | null {
  const semitone = KEY_SEMITONE[key]
  if (semitone === undefined) return null
  const pitch = 12 * (octave + 1) + semitone
  return pitch >= NOODLE_PITCH_MIN && pitch <= NOODLE_PITCH_MAX ? pitch : null
}

/** Attach the typing listeners; returns the disarm (releases held notes). */
export function armTyping(handlers: TypingHandlers): () => void {
  // key -> sounding pitch, so an octave shift mid-hold still releases cleanly
  const held = new Map<string, number>()

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    if (isTypingTarget(e.target)) return
    const key = e.key.toLowerCase()
    if (key === 'z' || key === 'x') {
      e.preventDefault()
      handlers.onOctaveShift(key === 'z' ? -1 : 1)
      return
    }
    if (held.has(key)) return
    const pitch = typingPitch(key, handlers.getOctave())
    if (pitch === null) return
    e.preventDefault()
    held.set(key, pitch)
    handlers.onNote({ type: 'on', pitch, velocity: TYPING_VELOCITY })
  }

  const onKeyUp = (e: KeyboardEvent) => {
    const pitch = held.get(e.key.toLowerCase())
    if (pitch === undefined) return
    held.delete(e.key.toLowerCase())
    handlers.onNote({ type: 'off', pitch, velocity: 0 })
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    for (const pitch of held.values()) handlers.onNote({ type: 'off', pitch, velocity: 0 })
    held.clear()
  }
}
