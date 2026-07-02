import { describe, expect, test } from 'vitest'
import { writeVLQ, motifToMidi, midiFilename } from '../src/core/midi'
import { makeMotif, makeNote } from './fixtures'

describe('writeVLQ', () => {
  test('encodes 7-bit groups MSB-first with continuation bits', () => {
    expect(writeVLQ(0)).toEqual([0x00])
    expect(writeVLQ(0x40)).toEqual([0x40])
    expect(writeVLQ(0x7f)).toEqual([0x7f])
    expect(writeVLQ(0x80)).toEqual([0x81, 0x00])
    expect(writeVLQ(480)).toEqual([0x83, 0x60])
    expect(writeVLQ(0x2000)).toEqual([0xc0, 0x00])
    expect(writeVLQ(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f])
  })

  test('rounds fractional ticks and clamps negatives to zero', () => {
    expect(writeVLQ(1.4)).toEqual([0x01])
    expect(writeVLQ(-5)).toEqual([0x00])
  })
})

// --- minimal SMF format-0 reader used to assert on decoded events ---

interface Ev {
  tick: number
  bytes: number[]
}

function readVLQ(data: Uint8Array, pos: number): [number, number] {
  let v = 0
  for (;;) {
    const b = data[pos++]
    v = (v << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) return [v, pos]
  }
}

function parseSMF(data: Uint8Array): { division: number; format: number; ntrks: number; events: Ev[] } {
  const str = (o: number, n: number) => String.fromCharCode(...data.slice(o, o + n))
  const u16 = (o: number) => (data[o] << 8) | data[o + 1]
  const u32 = (o: number) => (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]
  expect(str(0, 4)).toBe('MThd')
  expect(u32(4)).toBe(6)
  expect(str(14, 4)).toBe('MTrk')
  const trackLen = u32(18)
  expect(22 + trackLen).toBe(data.length) // track length matches the actual bytes

  const events: Ev[] = []
  let pos = 22
  let tick = 0
  while (pos < data.length) {
    let delta: number
    ;[delta, pos] = readVLQ(data, pos)
    tick += delta
    const status = data[pos]
    expect(status & 0x80, `expected a status byte at ${pos} (writer never uses running status)`).toBe(0x80)
    let end: number
    if (status === 0xff) {
      let len: number
      ;[len, end] = readVLQ(data, pos + 2)
      end += len
    } else {
      const hi = status & 0xf0
      end = pos + (hi === 0xc0 || hi === 0xd0 ? 2 : 3)
    }
    events.push({ tick, bytes: [...data.slice(pos, end)] })
    pos = end
  }
  return { division: u16(12), format: u16(8), ntrks: u16(10), events }
}

const noteOns = (evs: Ev[]) => evs.filter((e) => (e.bytes[0] & 0xf0) === 0x90)
const noteOffs = (evs: Ev[]) => evs.filter((e) => (e.bytes[0] & 0xf0) === 0x80)

describe('motifToMidi', () => {
  test('writes a format-0 single-track file at 480 TPQN', () => {
    const smf = parseSMF(motifToMidi(makeMotif(), 120))
    expect(smf.format).toBe(0)
    expect(smf.ntrks).toBe(1)
    expect(smf.division).toBe(480)
  })

  test('emits the tempo meta in microseconds per quarter', () => {
    const { events } = parseSMF(motifToMidi(makeMotif(), 120))
    // 60_000_000 / 120 = 500_000 = 0x07 0xA1 0x20
    expect(events[0]).toEqual({ tick: 0, bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] })
  })

  test('emits the time signature meta with a power-of-two denominator', () => {
    const { events } = parseSMF(motifToMidi(makeMotif({ timeSig: '3/8' }), 120))
    expect(events[1]).toEqual({ tick: 0, bytes: [0xff, 0x58, 0x04, 3, 3, 24, 8] })
  })

  test('converts beats to ticks and pairs every note-on with a note-off', () => {
    const { events } = parseSMF(motifToMidi(makeMotif(), 120))
    const ons = noteOns(events)
    const offs = noteOffs(events)
    expect(ons.map((e) => [e.tick, e.bytes[1], e.bytes[2]])).toEqual([
      [0, 60, 96],
      [480, 64, 96],
      [960, 67, 96],
      [1440, 72, 96],
    ])
    expect(offs.map((e) => [e.tick, e.bytes[1]])).toEqual([
      [480, 60],
      [960, 64],
      [1440, 67],
      [2400, 72],
    ])
  })

  test('sorts note-off before note-on at the same tick', () => {
    const motif = makeMotif({
      notes: [
        makeNote({ pitch: 60, startBeat: 0, durationBeats: 1 }),
        makeNote({ pitch: 60, startBeat: 1, durationBeats: 1 }),
        makeNote({ pitch: 62, startBeat: 2, durationBeats: 1 }),
      ],
    })
    const { events } = parseSMF(motifToMidi(motif, 120))
    const atTick480 = events.filter((e) => e.tick === 480 && (e.bytes[0] & 0xf0) !== 0xf0)
    expect(atTick480.map((e) => e.bytes[0] & 0xf0)).toEqual([0x80, 0x90])
  })

  test('partless motifs play on channel 0 with no program change', () => {
    const { events } = parseSMF(motifToMidi(makeMotif(), 120))
    expect(events.some((e) => (e.bytes[0] & 0xf0) === 0xc0)).toBe(false)
    for (const e of [...noteOns(events), ...noteOffs(events)]) {
      expect(e.bytes[0] & 0x0f).toBe(0)
    }
  })

  test('maps parts to channels with GM programs; drums go to channel 9', () => {
    const motif = makeMotif({
      parts: [
        { name: 'keys', instrument: 'piano' },
        { name: 'kit', instrument: 'drums' },
        { name: 'pad', instrument: 'strings' },
      ],
      notes: [
        makeNote({ pitch: 60, startBeat: 0, part: 0 }),
        makeNote({ pitch: 36, startBeat: 1, part: 1 }),
        makeNote({ pitch: 55, startBeat: 2, part: 2 }),
      ],
    })
    const { events } = parseSMF(motifToMidi(motif, 120))
    const programs = events.filter((e) => (e.bytes[0] & 0xf0) === 0xc0)
    // piano on ch0 (program 0), strings on ch1 (program 48); no program for drums
    expect(programs.map((e) => [e.bytes[0] & 0x0f, e.bytes[1]])).toEqual([
      [0, 0],
      [1, 48],
    ])
    expect(noteOns(events).map((e) => [e.bytes[0] & 0x0f, e.bytes[1]])).toEqual([
      [0, 60],
      [9, 36],
      [1, 55],
    ])
  })

  test('pads the end-of-track marker out to the full bar count', () => {
    // 2 bars of 4/4 = 8 beats = 3840 ticks; last note ends at 2400
    const { events } = parseSMF(motifToMidi(makeMotif(), 120))
    const eot = events[events.length - 1]
    expect(eot.bytes).toEqual([0xff, 0x2f, 0x00])
    expect(eot.tick).toBe(3840)
  })

  test('uses the passed tempo, not the motif tempo', () => {
    const { events } = parseSMF(motifToMidi(makeMotif({ tempo: 120 }), 100))
    // 60_000_000 / 100 = 600_000 = 0x09 0x27 0xC0
    expect(events[0].bytes).toEqual([0xff, 0x51, 0x03, 0x09, 0x27, 0xc0])
  })
})

describe('midiFilename', () => {
  test('slugs the name and appends key, mode, and tempo', () => {
    const motif = makeMotif({ name: 'My Cool Motif!', key: 'F#', mode: 'lydian' })
    expect(midiFilename(motif, 132.4)).toBe('my-cool-motif_F#-lydian_132bpm.mid')
  })

  test('falls back to "motif" when the name has no usable characters', () => {
    expect(midiFilename(makeMotif({ name: '!!!' }), 120)).toBe('motif_C-ionian_120bpm.mid')
  })
})
