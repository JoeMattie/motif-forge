import type { Motif } from '../types'
import { beatsPerBar } from './theory'

const TPQN = 480

/** Variable-length quantity: 7 bits per byte, MSB group first, continuation bit on all but last. */
export function writeVLQ(value: number): number[] {
  let v = Math.max(0, Math.round(value))
  const bytes = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    bytes.push((v & 0x7f) | 0x80)
    v >>= 7
  }
  return bytes.reverse()
}

interface MidiEvent {
  tick: number
  order: number // tie-break: note-off (0) before note-on (1) at equal ticks
  bytes: number[]
}

export function motifToMidi(motif: Motif, tempo: number): Uint8Array {
  const events: MidiEvent[] = []

  // Tempo meta: microseconds per quarter note
  const uspq = Math.round(60_000_000 / tempo)
  events.push({
    tick: 0,
    order: -1,
    bytes: [0xff, 0x51, 0x03, (uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff],
  })

  // Time signature meta
  const [numStr, denStr] = motif.timeSig.split('/')
  const num = parseInt(numStr, 10) || 4
  const den = parseInt(denStr, 10) || 4
  events.push({
    tick: 0,
    order: -1,
    bytes: [0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8],
  })

  for (const n of motif.notes) {
    const onTick = Math.round(n.startBeat * TPQN)
    const offTick = Math.round((n.startBeat + n.durationBeats) * TPQN)
    events.push({ tick: onTick, order: 1, bytes: [0x90, n.pitch, n.velocity] })
    events.push({ tick: offTick, order: 0, bytes: [0x80, n.pitch, 0x40] })
  }

  const endTick = Math.round(motif.bars * beatsPerBar(motif.timeSig) * TPQN)
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)

  const track: number[] = []
  let lastTick = 0
  for (const e of events) {
    track.push(...writeVLQ(e.tick - lastTick), ...e.bytes)
    lastTick = e.tick
  }
  const finalTick = Math.max(lastTick, endTick)
  track.push(...writeVLQ(finalTick - lastTick), 0xff, 0x2f, 0x00)

  const header = [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0, 0, 0, 6, // header length
    0, 0, // format 0
    0, 1, // one track
    (TPQN >> 8) & 0xff, TPQN & 0xff,
  ]
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (track.length >> 24) & 0xff,
    (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff,
    track.length & 0xff,
  ]
  return new Uint8Array([...header, ...trackHeader, ...track])
}

export function midiFilename(motif: Motif, tempo: number): string {
  const slug = motif.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'motif'
  return `${slug}_${motif.key}-${motif.mode}_${Math.round(tempo)}bpm.mid`
}
