/**
 * Faithful TypeScript port of SkyTNT midi-model's MIDITokenizerV2 with
 * optimise_midi=true ("tv2o"), the tokenizer of skytnt/midi-model-tv2o-medium.
 * See docs/model-notes.md for the verified vocab layout and semantics.
 *
 * The port mirrors the Python reference (midi_tokenizer.py) block-for-block —
 * variable names, iteration order, and even its quirks (banker's rounding,
 * time compared as t1+t2 in the setup pass) are preserved on purpose: the
 * golden test in tests/neuralTokenizer.test.ts requires byte-identical token
 * output, and structural parallelism is what keeps drift auditable.
 *
 * Scores use the Python MIDI.py shape kept as raw arrays:
 *   score = [ticksPerBeat, track, track, ...]; track = ScoreEvent[]
 *   ["note", startTicks, durTicks, channel, pitch, velocity]
 *   ["patch_change", t, channel, patch]
 *   ["control_change", t, channel, controller, value]
 *   ["set_tempo", t, microsecondsPerBeat]
 *   ["time_signature", t, nn, dd, ...]        (dd: 1=/2, 2=/4, 3=/8)
 *   ["key_signature", t, sf, mi]
 */

export type ScoreEvent = (string | number)[]
export type MidiScore = (number | ScoreEvent[])[]

/** Python round(): half rounds to the nearest EVEN integer. */
export function pyRound(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

const EVENTS: Record<string, string[]> = {
  note: ['time1', 'time2', 'track', 'channel', 'pitch', 'velocity', 'duration'],
  patch_change: ['time1', 'time2', 'track', 'channel', 'patch'],
  control_change: ['time1', 'time2', 'track', 'channel', 'controller', 'value'],
  set_tempo: ['time1', 'time2', 'track', 'bpm'],
  time_signature: ['time1', 'time2', 'track', 'nn', 'dd'],
  key_signature: ['time1', 'time2', 'track', 'sf', 'mi'],
}

const EVENT_PARAMETERS: Record<string, number> = {
  time1: 128, time2: 16, duration: 2048, track: 128, channel: 16, pitch: 128, velocity: 128,
  patch: 128, controller: 128, value: 128, bpm: 384, nn: 16, dd: 4, sf: 15, mi: 2,
}

export interface TokenizeOptions {
  addBosEos?: boolean
  ccEps?: number
  tempoEps?: number
  remapTrackChannel?: boolean
  addDefaultInstr?: boolean
  removeEmptyChannels?: boolean
}

export class MidiTokenizerV2 {
  readonly version = 'v2'
  readonly optimiseMidi = true // tv2o
  readonly vocabSize: number
  readonly padId: number
  readonly bosId: number
  readonly eosId: number
  readonly events = EVENTS
  readonly eventParameters = EVENT_PARAMETERS
  readonly eventIds: Record<string, number> = {}
  readonly idEvents: Record<number, string> = {}
  readonly parameterIds: Record<string, number[]> = {}
  readonly maxTokenSeq: number

  constructor() {
    let vocab = 0
    const allocate = (size: number) => {
      const ids = Array.from({ length: size }, (_, i) => vocab + i)
      vocab += size
      return ids
    }
    this.padId = allocate(1)[0]
    this.bosId = allocate(1)[0]
    this.eosId = allocate(1)[0]
    for (const name of Object.keys(EVENTS)) {
      this.eventIds[name] = allocate(1)[0]
      this.idEvents[this.eventIds[name]] = name
    }
    for (const [p, size] of Object.entries(EVENT_PARAMETERS)) {
      this.parameterIds[p] = allocate(size)
    }
    this.vocabSize = vocab
    this.maxTokenSeq = Math.max(...Object.values(EVENTS).map((ps) => ps.length)) + 1
  }

  static tempo2bpm(tempo: number): number {
    return 60 / (tempo / 1e6)
  }

  static bpm2tempo(bpm: number): number {
    if (bpm === 0) bpm = 1
    return Math.floor((60 / bpm) * 1e6)
  }

  static key2sf(k: number, mi: number): number {
    let sf = (k * 7) % 12
    if (sf > 6 || (mi === 1 && sf >= 5)) sf -= 12
    return sf
  }

  static detectKeySignature(keyHist: number[], threshold = 0.7): number | null {
    if (keyHist.length !== 12) return null
    const total = keyHist.reduce((a, b) => a + b, 0)
    if (total === 0) return null
    const sorted = [...keyHist].sort((a, b) => b - a)
    const p = sorted.slice(0, 7).reduce((a, b) => a + b, 0) / total
    if (p < threshold) return null
    // Python: top-7 pitch classes by count (stable on ties by ascending pc,
    // because sorted() is stable and zip pairs carry the pc as tiebreak-free
    // payload), then sorted ascending.
    const keys = keyHist
      .map((count, pc) => [count, pc] as const)
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .slice(0, 7)
      .map(([, pc]) => pc)
      .sort((a, b) => a - b)
    const semitones: number[] = []
    for (let i = 0; i < keys.length; i++) {
      const prev = keys[(i - 1 + keys.length) % keys.length]
      const dis = keys[i] - prev
      if (dis === 1 || dis === -11) semitones.push(keys[i])
    }
    if (semitones.length !== 2) return null
    const dis = semitones[1] - semitones[0]
    if (dis === 5) return semitones[0]
    if (dis === 7) return semitones[1]
    return null
  }

  event2tokens(event: (string | number)[]): number[] {
    const name = event[0] as string
    const params = event.slice(1) as number[]
    const fields = this.events[name]
    for (let i = 0; i < fields.length; i++) {
      if (!(params[i] >= 0 && params[i] < this.eventParameters[fields[i]])) return []
    }
    const tokens = [this.eventIds[name], ...fields.map((p, i) => this.parameterIds[p][params[i]])]
    while (tokens.length < this.maxTokenSeq) tokens.push(this.padId)
    return tokens
  }

  tokens2event(tokens: number[]): (string | number)[] {
    const name = this.idEvents[tokens[0]]
    if (name === undefined) return []
    const fields = this.events[name]
    if (tokens.length <= fields.length) return []
    const params = fields.map((p, i) => tokens[1 + i] - this.parameterIds[p][0])
    for (let i = 0; i < fields.length; i++) {
      if (!(params[i] >= 0 && params[i] < this.eventParameters[fields[i]])) return []
    }
    return [name, ...params]
  }

  /**
   * MIDI score -> token rows. A block-for-block port of
   * MIDITokenizerV2.tokenize; see the file header for the score shape.
   */
  tokenize(midiScore: MidiScore, opts: TokenizeOptions = {}): number[][] {
    const addBosEos = opts.addBosEos ?? true
    const ccEps = opts.ccEps ?? 4
    const tempoEps = opts.tempoEps ?? 4
    const remapTrackChannel = opts.remapTrackChannel ?? this.optimiseMidi
    const addDefaultInstr = opts.addDefaultInstr ?? this.optimiseMidi
    const removeEmptyChannels = opts.removeEmptyChannels ?? this.optimiseMidi

    type Ev = (string | number)[]
    const ticksPerBeat = midiScore[0] as number
    const eventList = new Map<string, Ev>()
    const trackIdxMap: Map<number, Map<number, number>> = new Map(
      Array.from({ length: 16 }, (_, i) => [i, new Map<number, number>()]),
    )
    let trackIdxDict = new Map<number, number>()
    let channels: number[] = []
    let patchChannels: number[] = []
    const emptyChannelFlags: boolean[] = Array(16).fill(true)
    const channelNoteTracks = new Map<number, number[]>(
      Array.from({ length: 16 }, (_, i) => [i, [] as number[]]),
    )
    const noteKeyHist = Array(12).fill(0)
    let keySigs: Ev[] = []
    let trackToChannels = new Map<number, number[]>()

    const tracks = midiScore.slice(1, 129) as ScoreEvent[][]
    for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
      const track = tracks[trackIdx]
      const lastNotes = new Map<string, [string, Ev]>()
      const patchDict = new Map<number, number | null>()
      const controlDict = new Map<string, number>()
      let lastBpm = 0
      const trackChannels: number[] = []
      if (!trackToChannels.has(trackIdx)) trackToChannels.set(trackIdx, trackChannels)
      for (const event of track) {
        const name = event[0] as string
        if (!(name in this.events)) continue
        let c = -1
        const t = pyRound((16 * (event[1] as number)) / ticksPerBeat) // quantization
        const newEvent: Ev = [name, Math.floor(t / 16), t % 16, trackIdx]
        if (name === 'note') {
          let d = event[2] as number
          const p = event[4] as number
          const v = event[5] as number
          c = event[3] as number
          if (!(c >= 0 && c <= 15)) continue
          d = Math.max(1, pyRound((16 * d) / ticksPerBeat))
          newEvent.push(c, p, v, d)
          emptyChannelFlags[c] = false
          if (!trackIdxDict.has(c)) trackIdxDict.set(c, trackIdx)
          const noteTracks = channelNoteTracks.get(c)!
          if (!noteTracks.includes(trackIdx)) noteTracks.push(trackIdx)
          if (c !== 9) noteKeyHist[p % 12]++
          if (!trackChannels.includes(c)) trackChannels.push(c)
        } else if (name === 'patch_change') {
          c = event[2] as number
          const p = event[3] as number
          if (!(c >= 0 && c <= 15)) continue
          newEvent.push(c, p)
          const lastP = patchDict.has(c) ? patchDict.get(c)! : null
          if (!patchDict.has(c)) patchDict.set(c, null)
          if (lastP === p) continue
          patchDict.set(c, p)
          if (!patchChannels.includes(c)) patchChannels.push(c)
        } else if (name === 'control_change') {
          c = event[2] as number
          const cc = event[3] as number
          const v = event[4] as number
          if (!(c >= 0 && c <= 15)) continue
          newEvent.push(c, cc, v)
          const ccKey = `${c},${cc}`
          const lastV = controlDict.get(ccKey) ?? 0
          if (!controlDict.has(ccKey)) controlDict.set(ccKey, 0)
          if (Math.abs(lastV - v) < ccEps) continue
          controlDict.set(ccKey, v)
        } else if (name === 'set_tempo') {
          const tempo = event[2] as number
          if (tempo === 0) continue // invalid tempo
          const bpm = Math.min(Math.floor(MidiTokenizerV2.tempo2bpm(tempo)), 383)
          newEvent.push(bpm)
          if (Math.abs(lastBpm - bpm) < tempoEps) continue
          lastBpm = bpm
        } else if (name === 'time_signature') {
          let nn = event[2] as number
          let dd = event[3] as number
          if (!(nn >= 1 && nn <= 16 && dd >= 1 && dd <= 4)) continue // invalid
          nn -= 1 // make it start from 0
          dd -= 1
          newEvent.push(nn, dd)
        } else if (name === 'key_signature') {
          let sf = event[2] as number
          const mi = event[3] as number
          if (!(sf >= -7 && sf <= 7 && mi >= 0 && mi <= 1)) continue // invalid
          sf += 7
          newEvent.push(sf, mi)
          keySigs.push(newEvent)
        }

        const keyLen =
          name === 'note' || name === 'time_signature' || name === 'key_signature'
            ? newEvent.length - 2
            : newEvent.length - 1
        const key = JSON.stringify(newEvent.slice(0, keyLen))

        if (c !== -1) {
          if (!channels.includes(c)) channels.push(c)
          const trMap = trackIdxMap.get(c)!
          if (!trMap.has(trackIdx)) trMap.set(trackIdx, 0)
        }

        if (name === 'note') {
          // to eliminate note overlap due to quantization
          const cp = JSON.stringify(newEvent.slice(4, 6)) // channel pitch
          const prev = lastNotes.get(cp)
          if (prev !== undefined) {
            const [lastNoteKey, lastNote] = prev
            const lastT = (lastNote[1] as number) * 16 + (lastNote[2] as number)
            lastNote[lastNote.length - 1] = Math.max(
              0,
              Math.min(lastNote[lastNote.length - 1] as number, t - lastT),
            )
            if (lastNote[lastNote.length - 1] === 0) eventList.delete(lastNoteKey)
          }
          lastNotes.set(cp, [key, newEvent])
        }
        // JS Map, like a Python dict, keeps the original insertion position on
        // key replacement.
        eventList.set(key, newEvent)
      }
    }
    let evList = [...eventList.values()]

    let emptyChannels = channels.filter((c) => emptyChannelFlags[c])

    if (remapTrackChannel) {
      patchChannels = []
      let channelsCount = 0
      const channelsMap = new Map<number, number>(channels.includes(9) ? [[9, 9]] : [])
      if (removeEmptyChannels) {
        // stable: empties last
        channels = [...channels].sort(
          (a, b) => (emptyChannels.includes(a) ? 1 : 0) - (emptyChannels.includes(b) ? 1 : 0),
        )
      }
      for (const c of channels) {
        if (c === 9) continue
        channelsMap.set(c, channelsCount)
        channelsCount++
        if (channelsCount === 9) channelsCount = 10
      }
      channels = [...channelsMap.values()]

      let trackCount = 0
      const trackIdxMapOrder = [...channelsMap.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => k)
      for (const c of trackIdxMapOrder) {
        // tracks not to remove
        if (removeEmptyChannels && emptyChannels.includes(c)) continue
        const trMap = trackIdxMap.get(c)!
        for (const trackIdx of trMap.keys()) {
          const noteTracks = channelNoteTracks.get(c)!
          if (noteTracks.length !== 0 && !noteTracks.includes(trackIdx)) continue
          trackCount++
          trMap.set(trackIdx, trackCount)
        }
      }
      for (const c of trackIdxMapOrder) {
        // tracks to remove
        if (!(removeEmptyChannels && emptyChannels.includes(c))) continue
        const trMap = trackIdxMap.get(c)!
        for (const trackIdx of trMap.keys()) {
          const noteTracks = channelNoteTracks.get(c)!
          if (!(noteTracks.length !== 0 && !noteTracks.includes(trackIdx))) continue
          trackCount++
          trMap.set(trackIdx, trackCount)
        }
      }

      emptyChannels = emptyChannels.map((c) => channelsMap.get(c)!)
      trackIdxDict = new Map()
      keySigs = []
      const keySignatureToAdd: Ev[] = []
      const keySignatureToRemove: Ev[] = []
      for (const event of evList) {
        const name = event[0] as string
        const trackIdx = event[3] as number
        if (name === 'note') {
          const c = event[4] as number
          event[4] = channelsMap.get(c)! // channel
          event[3] = trackIdxMap.get(c)!.get(trackIdx)! // track
          if (!trackIdxDict.has(event[4] as number)) {
            trackIdxDict.set(event[4] as number, event[3] as number)
          }
        } else if (name === 'set_tempo' || name === 'time_signature') {
          event[3] = 0 // set track 0 for meta events
        } else if (name === 'key_signature') {
          const newChannelTrackIdxs: [number, number][] = []
          for (const [c, trMap] of trackIdxMap) {
            if (trMap.has(trackIdx)) {
              const newTrackIdx = trMap.get(trackIdx)!
              const mapped = channelsMap.get(c)!
              if (newTrackIdx === 0) continue
              if (!newChannelTrackIdxs.some(([mc, mt]) => mc === mapped && mt === newTrackIdx)) {
                newChannelTrackIdxs.push([mapped, newTrackIdx])
              }
            }
          }
          if (newChannelTrackIdxs.length === 0) {
            if (event[3] === 0) {
              // keep key_signature on track 0 (meta)
              keySigs.push(event)
              continue
            }
            event[3] = -1 // avoid remove same event
            keySignatureToRemove.push(event) // empty track
            continue
          }
          const [c0, nt0] = newChannelTrackIdxs[0]
          event[3] = nt0
          keySigs.push(event)
          if (c0 === 9) event[4] = 7 // sf=0
          for (const [c, nt] of newChannelTrackIdxs.slice(1)) {
            const newEvent: Ev = [...event]
            newEvent[3] = nt
            if (c === 9) newEvent[4] = 7 // sf=0
            keySigs.push(newEvent)
            keySignatureToAdd.push(newEvent)
          }
        } else if (name === 'control_change' || name === 'patch_change') {
          const c = event[4] as number
          event[4] = channelsMap.get(c)! // channel
          const trMap = trackIdxMap.get(c)!
          // move the event to first track of the channel if its original track is empty
          let ti = trackIdx
          const noteTracks = channelNoteTracks.get(c)!
          if (noteTracks.length !== 0 && !noteTracks.includes(ti)) ti = noteTracks[0]
          event[3] = trMap.get(ti)!
          if (name === 'patch_change' && !patchChannels.includes(event[4] as number)) {
            patchChannels.push(event[4] as number)
          }
        }
      }
      evList = evList.filter((e) => !keySignatureToRemove.includes(e))
      evList.push(...keySignatureToAdd)
      trackToChannels = new Map()
      for (const [c, trMap] of trackIdxMap) {
        if (!channelsMap.has(c)) continue
        const mapped = channelsMap.get(c)!
        for (const trackIdx of trMap.values()) {
          if (!trackToChannels.has(trackIdx)) trackToChannels.set(trackIdx, [])
          const cs = trackToChannels.get(trackIdx)!
          if (!cs.includes(mapped)) cs.push(mapped)
        }
      }
    }

    if (addDefaultInstr) {
      for (const c of channels) {
        if (!patchChannels.includes(c) && trackIdxDict.has(c)) {
          evList.push(['patch_change', 0, 0, trackIdxDict.get(c)!, c, 0])
        }
      }
    }

    if (keySigs.length === 0 || keySigs.every((ks) => ks[4] === 7)) {
      // detect key signature or fix the default key signature
      const rootKey = MidiTokenizerV2.detectKeySignature(noteKeyHist)
      if (rootKey !== null) {
        const sf = MidiTokenizerV2.key2sf(rootKey, 0)
        if (keySigs.length === 0) {
          for (const [tr, cs] of trackToChannels) {
            if (remapTrackChannel && tr === 0) continue
            const drumOnly = cs.length === 1 && cs[0] === 9
            evList.push(['key_signature', 0, 0, tr, (drumOnly ? 0 : sf) + 7, 0])
          }
        } else {
          for (const keySig of keySigs) {
            const tr = keySig[3] as number
            const cs = trackToChannels.get(tr)
            if (cs !== undefined && cs.length === 1 && cs[0] === 9) continue
            keySig[4] = sf + 7
            keySig[5] = 0
          }
        }
      } else {
        // remove default key signature
        evList = evList.filter((e) => !keySigs.includes(e))
      }
    }

    const eventsNameOrder = new Map(
      ['time_signature', 'key_signature', 'set_tempo', 'patch_change', 'control_change', 'note'].map(
        (name, i) => [name, i],
      ),
    )
    const orderKey = (e: Ev) => [
      e[1] as number,
      e[2] as number,
      e[3] as number,
      eventsNameOrder.get(e[0] as string)!,
    ]
    const cmp = (a: Ev, b: Ev) => {
      const ka = orderKey(a)
      const kb = orderKey(b)
      for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
      return 0
    }
    evList.sort(cmp)

    // optimise setup: dedupe leading meta and zero its time
    const setupEvents = new Map<string, Ev>()
    let notesInSetup = false
    for (let i = 0; i < evList.length; i++) {
      const event = evList[i]
      const newEvent: Ev = [...event]
      if (event[0] !== 'note' && event[0] !== 'time_signature') {
        newEvent[1] = 0
        newEvent[2] = 0
      }
      let hasNext = false
      let hasPre = false
      if (i < evList.length - 1) {
        const nextEvent = evList[i + 1]
        hasNext =
          (event[1] as number) + (event[2] as number) ===
          (nextEvent[1] as number) + (nextEvent[2] as number)
      }
      if (notesInSetup && i > 0) {
        const preEvent = evList[i - 1]
        hasPre =
          (event[1] as number) + (event[2] as number) ===
          (preEvent[1] as number) + (preEvent[2] as number)
      }
      if ((event[0] === 'note' && !hasNext) || (notesInSetup && !hasPre)) {
        evList = [...setupEvents.values()].sort(cmp).concat(evList.slice(i))
        break
      }
      if (event[0] === 'note') notesInSetup = true
      const keyLen =
        event[0] === 'note' || event[0] === 'time_signature' || event[0] === 'key_signature'
          ? event.length - 2
          : event.length - 1
      const key = JSON.stringify([event[0], ...event.slice(3, keyLen)])
      setupEvents.set(key, newEvent)
    }

    let lastT1 = 0
    const midiSeq: number[][] = []
    for (const event of evList) {
      if (
        removeEmptyChannels &&
        (event[0] === 'control_change' || event[0] === 'patch_change') &&
        emptyChannels.includes(event[4] as number)
      ) {
        continue
      }
      const curT1 = event[1] as number
      event[1] = curT1 - lastT1
      const tokens = this.event2tokens(event)
      if (tokens.length === 0) continue
      midiSeq.push(tokens)
      lastT1 = curT1
    }

    if (addBosEos) {
      const bos = [this.bosId, ...Array(this.maxTokenSeq - 1).fill(this.padId)]
      const eos = [this.eosId, ...Array(this.maxTokenSeq - 1).fill(this.padId)]
      return [bos, ...midiSeq, eos]
    }
    return midiSeq
  }

  /** Token rows -> MIDI score at 480 ticks/beat (port of detokenize). */
  detokenize(midiSeq: number[][]): MidiScore {
    const ticksPerBeat = 480
    const tracksDict = new Map<number, ScoreEvent[]>()
    let t1 = 0
    for (const tokens of midiSeq) {
      if (!(tokens[0] in this.idEvents)) continue
      const event = this.tokens2event(tokens)
      if (event.length === 0) continue
      const name = event[0] as string
      t1 += event[1] as number
      const t = Math.floor((t1 * 16 + (event[2] as number)) * (ticksPerBeat / 16))
      const trackIdx = event[3] as number
      const eventNew: ScoreEvent = [name, t]
      if (name === 'note') {
        const [c, p, v, d] = event.slice(4) as number[]
        eventNew.push(Math.floor(d * (ticksPerBeat / 16)), c, p, v)
      } else if (name === 'control_change' || name === 'patch_change') {
        eventNew.push(...(event.slice(4) as number[]))
      } else if (name === 'set_tempo') {
        eventNew.push(MidiTokenizerV2.bpm2tempo(event[4] as number))
      } else if (name === 'time_signature') {
        const [nn, dd] = event.slice(4) as number[]
        eventNew.push(nn + 1, dd + 1, 24, 8) // usually cc, bb = 24, 8
      } else if (name === 'key_signature') {
        const [sf, mi] = event.slice(4) as number[]
        eventNew.push(sf - 7, mi)
      } else {
        continue // should not go here
      }
      if (!tracksDict.has(trackIdx)) tracksDict.set(trackIdx, [])
      tracksDict.get(trackIdx)!.push(eventNew)
    }
    const tracks = [...tracksDict.entries()].sort((a, b) => a[0] - b[0]).map(([, tr]) => tr)

    for (let i = 0; i < tracks.length; i++) {
      // to eliminate note overlap
      let track = [...tracks[i]].sort((a, b) => (a[1] as number) - (b[1] as number))
      const lastNoteT = new Map<string, number>()
      const zeroLenNotes = new Set<ScoreEvent>()
      for (let j = track.length - 1; j >= 0; j--) {
        const e = track[j]
        if (e[0] === 'note') {
          const t = e[1] as number
          let d = e[2] as number
          const c = e[3] as number
          const p = e[4] as number
          const key = `${c},${p}`
          const lastT = lastNoteT.get(key)
          if (lastT !== undefined) d = Math.min(d, Math.max(lastT - t, 0))
          lastNoteT.set(key, t)
          e[2] = d
          if (d === 0) zeroLenNotes.add(e)
        }
      }
      track = track.filter((e) => !zeroLenNotes.has(e))
      tracks[i] = track
    }
    return [ticksPerBeat, ...tracks]
  }
}
