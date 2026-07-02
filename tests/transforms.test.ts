import { describe, expect, test } from 'vitest'
import { applyTransform, describeTransform } from '../src/core/transforms'
import { makeMotif, makeNote } from './fixtures'

describe('inversion', () => {
  test('reflects pitches around the first note', () => {
    const child = applyTransform(makeMotif(), { type: 'inversion' })
    // axis = 60: 60→60, 64→56, 67→53, 72→48
    expect(child.notes.map((n) => n.pitch)).toEqual([60, 56, 53, 48])
  })

  test('clamps reflected pitches into 36–96', () => {
    const parent = makeMotif({
      notes: [
        makeNote({ pitch: 40, startBeat: 0 }),
        makeNote({ pitch: 90, startBeat: 1 }),
        makeNote({ pitch: 45, startBeat: 2 }),
      ],
    })
    const child = applyTransform(parent, { type: 'inversion' })
    // 2*40-90 = -10 and 2*40-45 = 35, both clamped up to 36
    expect(child.notes.map((n) => n.pitch)).toEqual([40, 36, 36])
  })
})

describe('retrograde', () => {
  test('reverses note order in time within the motif length', () => {
    const child = applyTransform(makeMotif(), { type: 'retrograde' })
    // total = 8 beats; last note (start 3, dur 2) → start 8-(3+2)=3 … first note (0,1) → 7
    expect(child.notes.map((n) => [n.pitch, n.startBeat])).toEqual([
      [72, 3],
      [67, 5],
      [64, 6],
      [60, 7],
    ])
  })

  test('is an involution on timing (retrograde twice = original)', () => {
    const parent = makeMotif()
    const twice = applyTransform(applyTransform(parent, { type: 'retrograde' }), {
      type: 'retrograde',
    })
    expect(twice.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual(
      parent.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats]),
    )
  })
})

describe('retrograde-inversion', () => {
  test('applies inversion first, then retrograde', () => {
    const child = applyTransform(makeMotif(), { type: 'retrogradeInversion' })
    expect(child.notes.map((n) => [n.pitch, n.startBeat])).toEqual([
      [48, 3],
      [53, 5],
      [56, 6],
      [60, 7],
    ])
  })
})

describe('transpose', () => {
  test('shifts every pitch by the given semitones', () => {
    const up = applyTransform(makeMotif(), { type: 'transpose', semitones: 5 })
    expect(up.notes.map((n) => n.pitch)).toEqual([65, 69, 72, 77])
    const down = applyTransform(makeMotif(), { type: 'transpose', semitones: -12 })
    expect(down.notes.map((n) => n.pitch)).toEqual([48, 52, 55, 60])
  })

  test('clamps at the pitch range boundaries', () => {
    const up = applyTransform(makeMotif(), { type: 'transpose', semitones: 48 })
    expect(up.notes.every((n) => n.pitch <= 96)).toBe(true)
    const down = applyTransform(makeMotif(), { type: 'transpose', semitones: -48 })
    expect(down.notes.every((n) => n.pitch >= 36)).toBe(true)
  })
})

describe('augment / diminish', () => {
  test('augment doubles timings and bar count', () => {
    const child = applyTransform(makeMotif(), { type: 'augment' })
    expect(child.bars).toBe(4)
    expect(child.notes.map((n) => [n.startBeat, n.durationBeats])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
      [6, 4],
    ])
  })

  test('diminish halves timings and bar count, flooring bars at 1', () => {
    const child = applyTransform(makeMotif(), { type: 'diminish' })
    expect(child.bars).toBe(1)
    expect(child.notes.map((n) => [n.startBeat, n.durationBeats])).toEqual([
      [0, 0.5],
      [0.5, 0.5],
      [1, 0.5],
      [1.5, 1],
    ])
    const again = applyTransform(child, { type: 'diminish' })
    expect(again.bars).toBe(1)
  })

  test('augment then diminish restores the original timing', () => {
    const parent = makeMotif()
    const roundTrip = applyTransform(applyTransform(parent, { type: 'augment' }), {
      type: 'diminish',
    })
    expect(roundTrip.bars).toBe(parent.bars)
    expect(roundTrip.notes.map((n) => [n.startBeat, n.durationBeats])).toEqual(
      parent.notes.map((n) => [n.startBeat, n.durationBeats]),
    )
  })
})

describe('mode swap', () => {
  test('C ionian → aeolian flattens the third', () => {
    const child = applyTransform(makeMotif(), { type: 'modeSwap', targetMode: 'aeolian' })
    // C E G C → C Eb G C
    expect(child.notes.map((n) => n.pitch)).toEqual([60, 63, 67, 72])
    expect(child.mode).toBe('aeolian')
    expect(child.scaleWarning).toBe(false)
  })

  test('swapping to the same mode is the identity', () => {
    const child = applyTransform(makeMotif(), { type: 'modeSwap', targetMode: 'ionian' })
    expect(child.notes.map((n) => n.pitch)).toEqual([60, 64, 67, 72])
  })

  test('chromatic notes survive via nearest-degree-below decomposition', () => {
    const parent = makeMotif({
      notes: [
        makeNote({ pitch: 60, startBeat: 0 }), // C
        makeNote({ pitch: 61, startBeat: 1 }), // C# = degree 0 + 1
        makeNote({ pitch: 67, startBeat: 2 }), // G
      ],
    })
    const child = applyTransform(parent, { type: 'modeSwap', targetMode: 'aeolian' })
    // degree 0 is still C in aeolian, so C# stays C#
    expect(child.notes.map((n) => n.pitch)).toEqual([60, 61, 67])
  })
})

describe('octave displacement', () => {
  test('moves only the given note indices', () => {
    const child = applyTransform(makeMotif(), {
      type: 'octaveDisplace',
      noteIndices: [0, 3],
      direction: 1,
    })
    expect(child.notes.map((n) => n.pitch)).toEqual([72, 64, 67, 84])
  })

  test('clamps displaced pitches', () => {
    const parent = makeMotif({
      notes: [
        makeNote({ pitch: 90, startBeat: 0 }),
        makeNote({ pitch: 60, startBeat: 1 }),
        makeNote({ pitch: 40, startBeat: 2 }),
      ],
    })
    const up = applyTransform(parent, { type: 'octaveDisplace', noteIndices: [0], direction: 1 })
    expect(up.notes[0].pitch).toBe(96)
    const down = applyTransform(parent, { type: 'octaveDisplace', noteIndices: [2], direction: -1 })
    expect(down.notes[2].pitch).toBe(36)
  })
})

describe('child motif metadata', () => {
  test('records lineage and resets triage state', () => {
    const parent = makeMotif({ rating: 5, rationale: 'seed rationale' })
    const child = applyTransform(parent, { type: 'transpose', semitones: 2 })
    expect(child.id).not.toBe(parent.id)
    expect(child.rating).toBe(0)
    expect(child.discarded).toBe(false)
    expect(child.rationale).toBeUndefined()
    expect(child.name).toBe('Fixture (transpose +2)')
    expect(child.source).toEqual({
      kind: 'transform',
      parentId: parent.id,
      transform: 'transpose +2',
    })
  })

  test('does not mutate the parent', () => {
    const parent = makeMotif()
    const before = JSON.stringify(parent)
    applyTransform(parent, { type: 'inversion' })
    applyTransform(parent, { type: 'augment' })
    expect(JSON.stringify(parent)).toBe(before)
  })

  test('flags scaleWarning when a transform pushes notes out of scale', () => {
    // Transposing C ionian material up 1 semitone leaves nothing diatonic to C
    const child = applyTransform(makeMotif(), { type: 'transpose', semitones: 1 })
    expect(child.scaleWarning).toBe(true)
  })

  test('keeps notes sorted by startBeat then pitch', () => {
    const child = applyTransform(makeMotif(), { type: 'retrograde' })
    const sorted = [...child.notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
    expect(child.notes).toEqual(sorted)
  })
})

describe('describeTransform', () => {
  test('renders human-readable labels', () => {
    expect(describeTransform({ type: 'inversion' })).toBe('inversion')
    expect(describeTransform({ type: 'transpose', semitones: -3 })).toBe('transpose -3')
    expect(describeTransform({ type: 'modeSwap', targetMode: 'lydian' })).toBe(
      'mode swap → lydian',
    )
    expect(
      describeTransform({ type: 'octaveDisplace', noteIndices: [1, 2], direction: -1 }),
    ).toBe('octave down (2 notes)')
  })
})
