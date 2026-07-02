import type { Motif, Note } from '../src/types'

export function makeNote(partial: Partial<Note> & Pick<Note, 'pitch' | 'startBeat'>): Note {
  return { durationBeats: 1, velocity: 96, ...partial }
}

/** A C-ionian, 2-bar, 4/4 motif; override any field per test. */
export function makeMotif(partial: Partial<Motif> = {}): Motif {
  return {
    id: 'fixture-1',
    name: 'Fixture',
    notes: [
      makeNote({ pitch: 60, startBeat: 0 }), // C4
      makeNote({ pitch: 64, startBeat: 1 }), // E4
      makeNote({ pitch: 67, startBeat: 2 }), // G4
      makeNote({ pitch: 72, startBeat: 3, durationBeats: 2 }), // C5
    ],
    parts: [],
    key: 'C',
    mode: 'ionian',
    bars: 2,
    timeSig: '4/4',
    tempo: 120,
    conceptId: null,
    rating: 3,
    discarded: false,
    scaleWarning: false,
    createdAt: 0,
    source: { kind: 'seed' },
    ...partial,
  }
}
