import { describe, expect, test } from 'vitest'
import { validateBatch, type ValidationContext } from '../src/core/validate'

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    key: 'C',
    mode: 'ionian',
    bars: 2,
    timeSig: '4/4',
    tempo: 120,
    allowChromatic: false,
    source: (i) => ({ kind: 'generated', brief: 'test brief', batchId: `batch-${i}` }),
    ...overrides,
  }
}

/** A minimal valid raw motif (3 in-scale notes in 2 bars of 4/4). */
function rawMotif(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test',
    notes: [
      { pitch: 60, startBeat: 0, durationBeats: 1, velocity: 96 },
      { pitch: 64, startBeat: 1, durationBeats: 1, velocity: 96 },
      { pitch: 67, startBeat: 2, durationBeats: 1, velocity: 96 },
    ],
    ...overrides,
  }
}

describe('batch shapes', () => {
  test('accepts a {motifs: [...]} envelope', () => {
    const r = validateBatch({ motifs: [rawMotif()] }, ctx())
    expect(r.valid).toHaveLength(1)
    expect(r.droppedCount).toBe(0)
  })

  test('accepts a bare array', () => {
    const r = validateBatch([rawMotif(), rawMotif()], ctx())
    expect(r.valid).toHaveLength(2)
  })

  test('rejects anything else without throwing', () => {
    for (const bad of ['nope', 42, null, { foo: [] }]) {
      const r = validateBatch(bad, ctx())
      expect(r.valid).toHaveLength(0)
      expect(r.errors).toEqual(['response is not a motif batch'])
    }
  })

  test('one bad motif does not sink the batch', () => {
    const r = validateBatch({ motifs: [rawMotif(), 'garbage', rawMotif()] }, ctx())
    expect(r.valid).toHaveLength(2)
    expect(r.droppedCount).toBe(1)
    expect(r.errors[0]).toMatch(/motif 2/)
  })
})

describe('note validation', () => {
  test('drops motifs with fewer than 3 notes', () => {
    const r = validateBatch(
      { motifs: [rawMotif({ notes: [{ pitch: 60, startBeat: 0, durationBeats: 1 }] })] },
      ctx(),
    )
    expect(r.droppedCount).toBe(1)
    expect(r.errors[0]).toMatch(/min 3/)
  })

  test('drops malformed notes (missing pitch/start/duration)', () => {
    const notes = [{ startBeat: 0, durationBeats: 1 }, { pitch: 60, startBeat: 1, durationBeats: 1 }]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.errors[0]).toMatch(/malformed note/)
  })

  test('drops out-of-range pitches, negative starts, non-positive durations', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ pitch: 97, startBeat: 0, durationBeats: 1 }, /out of range/],
      [{ pitch: 35, startBeat: 0, durationBeats: 1 }, /out of range/], // 35 needs a drum part
      [{ pitch: 60, startBeat: -0.5, durationBeats: 1 }, /negative startBeat/],
      [{ pitch: 60, startBeat: 0, durationBeats: 0 }, /non-positive duration/],
    ]
    for (const [badNote, msg] of cases) {
      const notes = [...(rawMotif().notes as unknown[]), badNote]
      const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
      expect(r.droppedCount, JSON.stringify(badNote)).toBe(1)
      expect(r.errors[0]).toMatch(msg)
    }
  })

  test('drops notes that run past the end of the motif', () => {
    const notes = [...(rawMotif().notes as unknown[]), { pitch: 60, startBeat: 7.5, durationBeats: 1 }]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.errors[0]).toMatch(/beyond 8 beats/)
  })

  test('a note ending exactly on the last beat is fine (EPS tolerance)', () => {
    const notes = [...(rawMotif().notes as unknown[]), { pitch: 60, startBeat: 7, durationBeats: 1.0000001 }]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.valid).toHaveLength(1)
  })

  test('coerces string numbers and rounds pitch, clamps velocity', () => {
    const notes = [
      { pitch: '60.4', startBeat: '0', durationBeats: '1', velocity: 300 },
      { pitch: 64, startBeat: 1, durationBeats: 1, velocity: 0 },
      { pitch: 67, startBeat: 2, durationBeats: 1 }, // velocity omitted
    ]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.valid).toHaveLength(1)
    const [a, b, c] = r.valid[0].notes
    expect(a.pitch).toBe(60)
    expect(a.velocity).toBe(127)
    expect(b.velocity).toBe(1)
    expect(c.velocity).toBe(96)
  })

  test('sorts notes by startBeat then pitch', () => {
    const notes = [
      { pitch: 67, startBeat: 2, durationBeats: 1 },
      { pitch: 64, startBeat: 0, durationBeats: 1 },
      { pitch: 60, startBeat: 0, durationBeats: 1 },
    ]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.valid[0].notes.map((n) => [n.startBeat, n.pitch])).toEqual([
      [0, 60],
      [0, 64],
      [2, 67],
    ])
  })
})

describe('polyphony cap', () => {
  const chord = (voices: number) =>
    Array.from({ length: voices }, (_, i) => ({
      pitch: 60 + i,
      startBeat: 0,
      durationBeats: 4,
    }))

  test('allows exactly 8 simultaneous voices', () => {
    const r = validateBatch({ motifs: [rawMotif({ notes: chord(8) })] }, ctx())
    expect(r.valid).toHaveLength(1)
  })

  test('drops 9 simultaneous voices', () => {
    const r = validateBatch({ motifs: [rawMotif({ notes: chord(9) })] }, ctx())
    expect(r.droppedCount).toBe(1)
    expect(r.errors[0]).toMatch(/simultaneous voices/)
  })

  test('back-to-back notes do not count as overlapping (note-off before note-on)', () => {
    // 8 voices ending at beat 4, 8 more starting at beat 4
    const notes = [...chord(8), ...chord(8).map((n) => ({ ...n, startBeat: 4 }))]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.valid).toHaveLength(1)
  })
})

describe('scale checking', () => {
  test('out-of-scale notes warn but never drop', () => {
    const notes = [...(rawMotif().notes as unknown[]), { pitch: 61, startBeat: 3, durationBeats: 1 }]
    const r = validateBatch({ motifs: [rawMotif({ notes })] }, ctx())
    expect(r.valid).toHaveLength(1)
    expect(r.droppedCount).toBe(0)
    expect(r.scaleWarningCount).toBe(1)
    expect(r.valid[0].scaleWarning).toBe(true)
  })

  test('in-scale motifs carry no warning', () => {
    const r = validateBatch({ motifs: [rawMotif()] }, ctx())
    expect(r.scaleWarningCount).toBe(0)
    expect(r.valid[0].scaleWarning).toBe(false)
  })
})

describe('drum parts', () => {
  const drumMotif = (pitch: number) =>
    rawMotif({
      parts: [{ name: 'kit', instrument: 'drums' }],
      notes: [
        { pitch, startBeat: 0, durationBeats: 0.5, part: 0 },
        { pitch: 38, startBeat: 1, durationBeats: 0.5, part: 0 },
        { pitch: 42, startBeat: 2, durationBeats: 0.5, part: 0 },
      ],
    })

  test('allows pitch 35 (GM acoustic kick) on a drum part', () => {
    const r = validateBatch({ motifs: [drumMotif(35)] }, ctx())
    expect(r.valid).toHaveLength(1)
  })

  test('still rejects pitch 34 on a drum part', () => {
    const r = validateBatch({ motifs: [drumMotif(34)] }, ctx())
    expect(r.droppedCount).toBe(1)
  })

  test('drum notes are exempt from the scale check', () => {
    // 42 (F#) is chromatic in C ionian but sits on a drum part
    const r = validateBatch({ motifs: [drumMotif(36)] }, ctx())
    expect(r.valid[0].scaleWarning).toBe(false)
  })
})

describe('parts parsing', () => {
  test('caps parts at 4 and clamps note part indices into range', () => {
    const motif = rawMotif({
      parts: Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, instrument: 'piano' })),
      notes: [
        { pitch: 60, startBeat: 0, durationBeats: 1, part: 5 },
        { pitch: 64, startBeat: 1, durationBeats: 1, part: -2 },
        { pitch: 67, startBeat: 2, durationBeats: 1 },
      ],
    })
    const r = validateBatch({ motifs: [motif] }, ctx())
    const m = r.valid[0]
    expect(m.parts).toHaveLength(4)
    expect(m.notes[0].part).toBe(3)
    expect(m.notes[1].part).toBe(0)
    expect(m.notes[2].part).toBeUndefined()
  })

  test('unknown instruments fall back to synth; missing names get defaults', () => {
    const motif = rawMotif({ parts: [{ instrument: 'theremin' }, { name: '  ' }] })
    const r = validateBatch({ motifs: [motif] }, ctx())
    expect(r.valid[0].parts).toEqual([
      { name: 'part 1', instrument: 'synth' },
      { name: 'part 2', instrument: 'synth' },
    ])
  })

  test('synth presets are clamped; presets on sampled instruments are ignored', () => {
    const motif = rawMotif({
      parts: [
        {
          name: 'lead',
          instrument: 'synth',
          preset: {
            oscillator: 'sawtooth',
            envelope: { attack: 99, decay: -1, sustain: 2, release: 0 },
          },
        },
        { name: 'keys', instrument: 'piano', preset: { oscillator: 'square' } },
      ],
    })
    const r = validateBatch({ motifs: [motif] }, ctx())
    const [lead, keys] = r.valid[0].parts
    expect(lead.preset).toEqual({
      oscillator: 'sawtooth',
      envelope: { attack: 2, decay: 0.01, sustain: 1, release: 0.01 },
    })
    expect(keys.preset).toBeUndefined()
  })

  test('a bogus oscillator falls back to triangle', () => {
    const motif = rawMotif({
      parts: [{ name: 'lead', instrument: 'synth', preset: { oscillator: 'formant' } }],
    })
    const r = validateBatch({ motifs: [motif] }, ctx())
    expect(r.valid[0].parts[0].preset?.oscillator).toBe('triangle')
  })
})

describe('metadata and context fallbacks', () => {
  test('motif-level key/mode/bars/timeSig/tempo override the context', () => {
    const motif = rawMotif({
      key: 'Eb',
      mode: 'AEOLIAN',
      bars: 4,
      timeSig: '3/4',
      tempo: 90,
      notes: [
        { pitch: 63, startBeat: 0, durationBeats: 1 },
        { pitch: 67, startBeat: 4, durationBeats: 1 },
        { pitch: 70, startBeat: 11, durationBeats: 1 },
      ],
    })
    const r = validateBatch({ motifs: [motif] }, ctx())
    const m = r.valid[0]
    expect(m.key).toBe('Eb')
    expect(m.mode).toBe('aeolian')
    expect(m.bars).toBe(4)
    expect(m.timeSig).toBe('3/4')
    expect(m.tempo).toBe(90)
  })

  test('missing or invalid metadata falls back to the context', () => {
    const r = validateBatch({ motifs: [rawMotif({ mode: 'superlocrian' })] }, ctx())
    const m = r.valid[0]
    expect(m.key).toBe('C')
    expect(m.mode).toBe('ionian')
    expect(m.bars).toBe(2)
    expect(m.tempo).toBe(120)
  })

  test('per-motif tempo is clamped to 40–220', () => {
    const r = validateBatch({ motifs: [rawMotif({ tempo: 500 }), rawMotif({ tempo: 5 })] }, ctx())
    expect(r.valid[0].tempo).toBe(220)
    expect(r.valid[1].tempo).toBe(40)
  })

  test('blank names fall back to an indexed default', () => {
    const r = validateBatch({ motifs: [rawMotif({ name: '   ' }), rawMotif({ name: 7 })] }, ctx())
    expect(r.valid[0].name).toBe('Motif 1')
    expect(r.valid[1].name).toBe('Motif 2')
  })

  test('records source per index, conceptId, and fresh triage state', () => {
    const r = validateBatch(
      { motifs: [rawMotif(), rawMotif()] },
      ctx({ conceptId: 'concept-9' }),
    )
    expect(r.valid[0].source).toEqual({ kind: 'generated', brief: 'test brief', batchId: 'batch-0' })
    expect(r.valid[1].source).toEqual({ kind: 'generated', brief: 'test brief', batchId: 'batch-1' })
    for (const m of r.valid) {
      expect(m.conceptId).toBe('concept-9')
      expect(m.rating).toBe(0)
      expect(m.discarded).toBe(false)
      expect(m.id).toBeTruthy()
    }
    expect(r.valid[0].id).not.toBe(r.valid[1].id)
  })
})
