import * as Tone from 'tone'
import type { Motif, Part, Sound } from '../types'
import { beatsPerBar } from '../core/theory'
import { createMasterChain, scheduleDrone, scheduleMotif } from './voice'
import { createDrumKit, createSmplrInstrument, createToneSynth } from './instruments'

const SAMPLE_RATE = 44100
const TAIL_SEC = 1.5 // let releases/sample tails ring out

/**
 * Render a motif offline with the same instrument path as live playback.
 * Everything renders through one Tone.OfflineContext: Tone synth parts bind to
 * it directly, smplr parts bind to its rawContext (smplr accepts any
 * BaseAudioContext), and .render() drives Tone's clock deterministically while
 * the raw graph renders alongside.
 */
export async function renderMotif(
  motif: Motif,
  tempo: number,
  opts: { drone?: boolean; sound: Sound; forceSound?: boolean },
): Promise<AudioBuffer> {
  const durationSec = (motif.bars * beatsPerBar(motif.timeSig) * 60) / tempo
  const totalSec = durationSec + TAIL_SEC

  const toneCtx = new Tone.OfflineContext(1, totalSec, SAMPLE_RATE)
  const raw = toneCtx.rawContext as OfflineAudioContext
  const { input } = createMasterChain(raw)

  const parts: Part[] =
    !opts.forceSound && motif.parts && motif.parts.length > 0
      ? motif.parts
      : [{ name: 'all', instrument: opts.sound }]
  const instruments = parts.map((p) =>
    p.instrument === 'synth'
      ? createToneSynth(toneCtx, input, p.preset)
      : p.instrument === 'drums'
        ? createDrumKit(toneCtx, input)
        : createSmplrInstrument(p.instrument, raw, input),
  )
  await Promise.all(instruments.map((i) => i.ready))

  scheduleMotif(instruments, motif, tempo, 0)
  if (opts.drone) scheduleDrone(raw, input, motif.key, durationSec, 0)

  const buffer = await toneCtx.render()
  const audioBuffer = buffer.get()
  if (!audioBuffer) throw new Error('offline render produced no audio')
  return audioBuffer
}
